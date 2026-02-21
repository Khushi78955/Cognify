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

    # Hard pass: ends with "?" → likely interrogative
    if t.endswith("?"):
        return True

    # Hard pass: starts with action verbs common in JEE problems
    action_starts = (
        "find ", "evaluate ", "evaluate:", "calculate ", "compute ",
        "solve ", "prove ", "show ", "determine ", "if ", "let ",
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

    # Default: reject if it doesn't contain any math-problem indicators
    problem_indicators = (
        "find", "evaluate", "calculate", "compute", "solve", "prove",
        "determine", "integral", "differentiate", "limit", "value of",
        "show that", "if f(", "if g(", "let f", "let g",
    )
    return any(p in t_lower for p in problem_indicators)



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
                include_raw_content=False,  # summary content is enough + faster
            )
            for result in results.get("results", []):
                url = result.get("url", "")
                # Use full content if available, fall back to snippet
                content = result.get("content", "") or result.get("snippet", "")
                extracted = _extract_questions_from_text(content, url)
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
    Heuristic extraction of question-like sentences from raw text content.
    Splits on both newlines and sentence boundaries for richer extraction.
    """
    import re

    questions = []

    # Split on lines first, then also on sentence boundaries within long lines
    raw_lines = content.split("\n")
    candidates: list[str] = []
    for line in raw_lines:
        line = line.strip()
        if not line:
            continue
        if len(line) > 200:
            parts = re.split(r'(?<=[.?])\s+', line)
            candidates.extend([p.strip() for p in parts if p.strip()])
        else:
            candidates.append(line)

    math_indicators = [
        "∫", "∑", "∏", "√", "→", "≤", "≥", "≠", "∞",
        "$", "^2", "^3", "lim(", "lim_", "dx", "dy", "dz",
        "sin(", "cos(", "tan(", "cot(", "sec(", "log(", "ln(", "f(x)",
        "matrix", "determinant", "vector",
        "eccentricity", "foci", "focus", "ellipse", "parabola", "hyperbola",
        "chord", "tangent", "asymptote", "directrix",
        "integral", "derivative", "differentia", "integra",
        "polynomial", "quadratic", "roots", "coefficient",
        "complex number", "modulus", "argument",
        "probability", "binomial", "permutation", "combination",
        "progression", "sequence", "series",
    ]

    question_starters = (
        "find", "evaluate", "calculate", "compute", "prove", "show", "determine",
        "if ", "let ", "for ", "given", "solve", "integrate", "differentiate",
        "a ", "an ", "the ", "two ", "three ", "suppose", "consider", "from ",
        "which", "what", "how", "when", "using", "without", "in a ", "p(",
    )

    junk_phrases = (
        "the document contains", "this document", "pdf includes", "pdf contains",
        "detailing various", "includes different types", "collection of",
        "set of questions", "click here", "download", "subscribe",
        "all rights reserved", "the following questions",
    )

    seen: set[str] = set()
    for cand in candidates:
        cand = cand.strip()
        if len(cand) < 20 or len(cand) > 600:
            continue
        lower = cand.lower()
        if any(p in lower for p in junk_phrases):
            continue
        key = lower[:60]
        if key in seen:
            continue
        if cand.endswith("?"):
            seen.add(key)
            questions.append({"text": cand, "source_url": source_url})
            continue
        if any(lower.startswith(s) for s in question_starters):
            seen.add(key)
            questions.append({"text": cand, "source_url": source_url})
            continue
        if any(ind in cand for ind in math_indicators):
            seen.add(key)
            questions.append({"text": cand, "source_url": source_url})

    return questions
