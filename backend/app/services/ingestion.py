"""
Question ingestion pipeline.

Flow (triggered only when Pinecone cache is insufficient):
  1. Generate search queries for the topic
  2. Fetch top URLs via Tavily
  3. Parse HTML to extract question text
  4. Deduplicate by SHA-256 hash
  5. Classify via Gemini (subtopics + difficulty)
  6. Compute embedding via Gemini
  7. Upsert into Pinecone + Postgres
"""

import hashlib

import requests
from bs4 import BeautifulSoup
from tavily import TavilyClient

from app.config import settings
from app.services.gemini_client import batch_classify_questions, get_embedding
from app.services.pinecone_client import upsert_question


def _is_actual_question(text: str) -> bool:
    """
    Return True only if the text looks like a real maths problem.
    Rejects declarative sentences, descriptions, and explanatory statements.
    """
    t = text.strip()
    t_lower = t.lower()

    # Hard reject: proof / show-that / verify questions have no definite answer
    # and are completely unsuitable for JEE practice with numerical input.
    proof_starts = (
        "show that", "show:", "prove that", "prove:", "verify that", "verify:",
        "demonstrate that", "hence prove", "hence show", "hence verify",
        "using the above", "using the result",
    )
    if any(t_lower.startswith(p) for p in proof_starts):
        return False
    # Also reject mid-sentence proof wording (e.g. "Find x and hence show that")
    if "hence show that" in t_lower or "hence prove that" in t_lower:
        return False

    # Reject hashtag/social media strings (#jee #maths etc.)
    words = t_lower.split()
    if not words:
        return False
    hashtag_ratio = sum(1 for w in words if w.startswith('#')) / len(words)
    if hashtag_ratio > 0.4:
        return False

    # Reject very short strings that sneak through
    if len(t) < 30:
        return False

    # Hard pass: ends with "?" → likely interrogative
    if t.endswith("?"):
        return True

    # Hard pass: starts with action verbs common in JEE problems
    action_starts = (
        "find ", "evaluate ", "evaluate:", "calculate ", "compute ",
        "solve ", "determine ", "if ", "let ",
        "given ", "the value of", "for what", "how many", "how much",
        "which of the", "the integral", "integrate ", "differentiate ",
        "simplify ", "expand ", "factorise ", "factorize ",
    )
    for s in action_starts:
        if t_lower.startswith(s):
            return True

    # Hard pass: contains explicit question-number prefix (Q1., Q2., **Question)
    import re as _re
    if _re.match(r"^\*{0,2}(q(?:uestion)?\s*\d+[.:]|\d+[.)]\s)", t_lower):
        return True

    # Hard pass: contains math formula-like content AND a question word
    has_math = any(c in t for c in ("∫", "∑", "∏", "√", "$", "^", "dx", "dy"))
    question_words = ("find", "evaluate", "calculate", "compute", "value", "integral")
    if has_math and any(w in t_lower for w in question_words):
        return True

    # Soft reject: looks like a plain declarative statement
    # (ends with period and starts with "The", "When", "This", "A ", "An ", etc.)
    declarative_starts = (
        "the proof", "the concept", "the formula", "the rule", "the method",
        "when applying", "when using", "this method", "this formula",
        "in mathematics", "in calculus", "integration by parts is",
        "integration is", "a function", "an integral", "the technique",
        "the process", "note that", "recall that",
    )
    if any(t_lower.startswith(d) for d in declarative_starts):
        return False

    # Reject context-dependent fragments — sub-questions that need prior setup
    # e.g. "If now a ball is drawn..." — "now" signals continuation
    fragment_patterns = (
        "if now ", "then the probability", "then find", "then what",
        "now find", "also find", "hence find", "hence determine",
        "what is the probability that this", "the probability that this drawn",
    )
    if any(t_lower.startswith(p) or p in t_lower[:60] for p in fragment_patterns):
        return False

    # Default: reject if it doesn't contain any math-problem indicators
    problem_indicators = (
        "find", "evaluate", "calculate", "compute", "solve", "prove",
        "determine", "integral", "differentiate", "limit", "value of",
        "show that", "if f(", "if g(", "let f", "let g",
        "probability", "how many", "how much", "selected", "chosen",
        "drawn", "tossed", "rolled", "picked", "at random",
    )
    return any(p in t_lower for p in problem_indicators)


def ingest_topic(topic: str, n: int = 10) -> list[dict]:
    """
    Ingest up to `n` new questions for the given topic from the web.

    Returns a list of ingested question dicts.
    """
    if not settings.tavily_api_key:
        print("[Ingestion] TAVILY_API_KEY not set — skipping web ingestion.")
        return []

    queries = _build_queries(topic)
    raw_questions = []

    tavily = TavilyClient(api_key=settings.tavily_api_key)

    for query in queries:
        try:
            results = tavily.search(
                query=query,
                max_results=5,
                include_raw_content=True,  # get full page text for better question extraction
            )
            for result in results.get("results", []):
                url = result.get("url", "")
                # Prefer raw_content (full page text) → content (summary) → snippet
                content = (
                    result.get("raw_content") or
                    result.get("content") or
                    result.get("snippet", "")
                )
                extracted = _extract_questions_from_text(content, url)
                print(f"[Ingestion] {url[:60]} → extracted {len(extracted)} candidates")
                raw_questions.extend(extracted)
                if len(raw_questions) >= n * 2:
                    break
        except Exception as e:
            print(f"[Ingestion] Tavily search error for '{query}': {e}")

    ingested = []
    seen_hashes = set()
    # Phase 1: deduplicate and collect candidates (no Gemini calls yet)
    candidates = []
    for q in raw_questions:
        text = q["text"].strip()
        if len(text) < 20:
            continue
        # Reject article descriptions before expensive Gemini calls
        text_lower = text.lower()
        if any(p in text_lower for p in (
            "the document", "this document", "pdf includes", "pdf contains",
            "detailing various", "series of", "includes different types",
            "jee main and advanced exam", "practice questions for",
        )):
            continue

        # Reject plain declarative statements — must look like an actual problem
        if not _is_actual_question(text):
            continue

        text_hash = hashlib.sha256(text.encode()).hexdigest()
        if text_hash in seen_hashes:
            continue
        seen_hashes.add(text_hash)
        candidates.append({"text": text, "text_hash": text_hash, "source_url": q.get("source_url", "")})
        if len(candidates) >= n:
            break

    if not candidates:
        print(f"[Ingestion] No candidates found for topic: {topic}")
        return []

    # Phase 2: batch classify all candidates in ONE Gemini API call (avoids 10-RPM limit)
    texts = [c["text"] for c in candidates]
    classifications = batch_classify_questions(texts, topic)

    # Phase 3: embed and upsert each candidate
    import json as _json
    for candidate, classification in zip(candidates, classifications):
        # Skip proof/show-that questions flagged by Gemini
        if classification.get("skip"):
            print(f"[Ingestion] Skipping proof question: {candidate['text'][:80]}")
            continue

        text = candidate["text"]
        text_hash = candidate["text_hash"]

        # Embed with Gemini
        embedding = get_embedding(text)

        question_id = f"Q_{text_hash[:16]}"

        # Serialize options dict → JSON string for Pinecone (flat metadata required)
        options = classification.get("options")
        options_str = _json.dumps(options) if options else None

        subtopics = classification.get("subtopics") or [topic]
        if subtopics == ["unknown"] or not subtopics:
            subtopics = [topic]
        # Always ensure the requesting topic is in subtopics for Pinecone filter match
        if topic not in subtopics:
            subtopics = [topic] + subtopics

        metadata = {
            "question_id": question_id,
            "text": text[:500],  # Pinecone metadata size limit
            "question_type": classification.get("question_type", "numerical"),
            "options": options_str or "",       # empty string = no options (Pinecone needs strings)
            "correct_option": classification.get("correct_option") or "",
            "correct_answer": classification.get("correct_answer") or "",
            "subtopics": subtopics,
            "difficulty": classification.get("difficulty", 3),
            "source_url": candidate.get("source_url", ""),
            "text_hash": text_hash,
        }

        # Upsert into Pinecone
        upsert_question(question_id, embedding, metadata)

        ingested.append(metadata)

    print(f"[Ingestion] Ingested {len(ingested)} questions for topic: {topic}")
    return ingested


def _build_queries(topic: str) -> list[str]:
    """Generate search query variants for the given topic."""
    readable = topic.replace("_", " ")
    return [
        f"{readable} JEE Mains problems with solutions",
        f"{readable} JEE Advanced practice questions",
        f"solved {readable} problems for JEE Mathematics",
    ]


def _extract_questions_from_text(content: str, source_url: str) -> list[dict]:
    """
    Extract complete, self-contained question texts from raw web content.

    Strategy:
    - Split into paragraphs (blank-line separated blocks)
    - Within each block, identify question lines
    - Prepend up to 3 preceding context lines so sub-questions get their setup
    - Strip markdown artifacts (**, *** bold markers, :**, answer blanks)
    - Reject obvious fragments / navigation / junk
    """
    import re

    def _clean(text: str) -> str:
        """Strip markdown/HTML artifacts from scraped text."""
        # Remove heading markers (# ## ### etc.)
        text = re.sub(r'^#{1,6}\s*', '', text.strip())
        # Remove numbered list prefix at start: "3. " or "Q3. " etc.
        text = re.sub(r'^\*{0,2}(?:Q(?:uestion)?\s*)?\d+[.)]\s+', '', text)
        # Remove bold markers (**text** or ***text***)
        text = re.sub(r'\*{2,3}(.*?)\*{2,3}', r'\1', text)
        # Remove leftover asterisks / answer blanks like :** or :__
        text = re.sub(r':\*+\.?$', '.', text.rstrip())
        text = re.sub(r':_{2,}\.?$', '.', text.rstrip())
        # Collapse multiple spaces
        text = re.sub(r'  +', ' ', text)
        return text.strip()

    MATH_INDICATORS = [
        "∫", "∑", "∏", "√", "→", "≤", "≥", "≠", "∞",
        "$", "^2", "^3", "lim(", "lim_", "dx", "dy", "dz",
        "sin(", "cos(", "tan(", "cot(", "sec(", "log(", "ln(", "f(x)",
        "matrix", "determinant", "vector",
        "eccentricity", "ellipse", "parabola", "hyperbola",
        "chord", "tangent", "integral", "derivative", "differentia",
        "polynomial", "quadratic", "roots",
        "complex number", "modulus", "probability", "binomial",
        "permutation", "combination", "progression", "sequence",
    ]

    QUESTION_STARTERS = (
        "find ", "evaluate ", "calculate ", "compute ", "prove ", "show ",
        "determine ", "solve ", "integrate ", "differentiate ",
        "if ", "let ", "given ", "suppose ", "consider ",
        "for what", "how many", "how much", "which of",
        "what is", "what are", "in a ", "p(", "from a ",
    )

    # Lines that look like setup/context (contain numbers + container words)
    CONTEXT_KEYWORDS = (
        "contains", "consist", "bag", "box", "urn", "jar", "group",
        "set of", "collection", "total", "digits", "letters",
        "numbers from", "integers", "balls", "cards", "coins",
        "students", "persons", "committee",
    )

    JUNK_PHRASES = (
        "click here", "download", "subscribe", "all rights reserved",
        "the document contains", "this document", "pdf includes",
        "pdf contains", "detailing various", "click to", "see also",
        "previous year", "next question", "answer key", "solution:",
        "copyright", "privacy policy", "terms of use",
    )

    questions: list[dict] = []
    seen: set[str] = set()

    # Pre-process: if content is a wall of text (few newlines), split by question markers
    # so that "**Question 2:** If four numbers..." becomes its own line
    if content.count('\n') < 5 and len(content) > 200:
        # Split on patterns like: **Question 3:** | Q.1 | 1. | 2. (numbered items)
        content = re.sub(
            r'(?<=[.!?])\s+(?='  # after sentence end, before...
            r'(?:\*{0,2}(?:Q(?:uestion)?\s*\.?\s*\d+[.:)]|\d+[.)])))',
            r'\n\n',
            content
        )
        # Also split on **bold** question starters mid-sentence
        content = re.sub(r'\*{1,2}(Q(?:uestion)?\s*\d+[.:])', r'\n\n\1', content)
        # Split on numeric list patterns embedded in text: " 3. If..."
        content = re.sub(r'(?<=\s)(\d{1,2}[.)]) (?=[A-Z])', r'\n\n\1 ', content)

    # Split into paragraphs (2+ newlines = paragraph break)
    paragraphs = re.split(r'\n{2,}', content)

    for para in paragraphs:
        # Split paragraph into individual lines
        lines = [l.strip() for l in para.split('\n') if l.strip()]
        if not lines:
            continue

        for i, line in enumerate(lines):
            lower = line.lower()

            # Skip obvious junk
            if any(j in lower for j in JUNK_PHRASES):
                continue
            if len(line) < 30 or len(line) > 1200:
                continue
            # Reject hashtag/social media lines
            words = line.split()
            if words and sum(1 for w in words if w.startswith('#')) / len(words) > 0.4:
                continue

            is_question = (
                line.endswith("?")
                or any(lower.startswith(s) for s in QUESTION_STARTERS)
                or re.match(r'^\*{0,2}(q(?:uestion)?\s*\d+[.:\)]|\d+[.)]\s)', lower)
                or any(ind in line for ind in MATH_INDICATORS)
            )
            if not is_question:
                continue

            # Gather context: look back up to 3 lines in the same paragraph
            # for setup sentences (containing numbers, container words, etc.)
            context_lines = []
            for j in range(max(0, i - 3), i):
                prev = lines[j].strip()
                prev_lower = prev.lower()
                # Include if it looks like problem setup (not a heading or nav)
                if (
                    len(prev) > 15
                    and not any(j2 in prev_lower for j2 in JUNK_PHRASES)
                    and (
                        any(c in prev_lower for c in CONTEXT_KEYWORDS)
                        or re.search(r'\d', prev)   # contains a number
                        or prev.endswith(",")        # continuation
                    )
                ):
                    context_lines.append(prev)

            # Build full question text
            full_text = " ".join(context_lines + [line]).strip() if context_lines else line

            # Clean markdown artifacts
            full_text = _clean(full_text)

            # Skip if still too short after combining
            if len(full_text) < 30:
                continue

            # Dedup by first 80 chars
            key = full_text.lower()[:80]
            if key in seen:
                continue
            seen.add(key)

            questions.append({"text": full_text, "source_url": source_url})

    return questions

