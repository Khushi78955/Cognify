"""
Google Gemini client.

Free tier (as of 2025):
  - gemini-2.0-flash : 1500 RPD, 15 RPM free tier (AI Studio key required)
  - text-embedding-004: free with quota

Used for:
  1. classify_question()    → subtopics + difficulty (ingestion-time)
  2. generate_lesson()      → 60-second micro-lesson (remediation)
  3. solve_doubt()          → step-by-step solution JSON (doubt resolution)
  4. get_embedding()        → 768-dim vector (indexing + retrieval)
"""

import json
import re
import time
import base64

import google.generativeai as genai

from app.config import settings

# Lazy initialization
_model = None
_embed_model = "models/gemini-embedding-001"
_cached_model_name: str | None = None


def _fix_json_escapes(s: str) -> str:
    r"""Fix unescaped backslashes from LaTeX in Gemini JSON output before json.loads.

    Handles two cases:
    - Correctly escaped pair \\X (keep as-is) e.g. \\dfrac stays \\dfrac
    - Lone backslash before non-JSON-special char (double it) e.g. \dfrac -> \\dfrac
    """
    # Alt 1: valid JSON escape sequences — keep unchanged
    # Alt 2: lone backslash + any char — double the backslash
    return re.sub(
        r'\\(\\|["\\/bfnrtu]|u[0-9a-fA-F]{4})|(\\)(.)',
        lambda m: m.group(0) if m.group(1) is not None else '\\\\' + m.group(3),
        s
    )


def _get_model():
    global _model, _cached_model_name
    if _model is None or _cached_model_name != settings.gemini_model:
        if not settings.gemini_api_key:
            raise RuntimeError("GEMINI_API_KEY not set")
        genai.configure(api_key=settings.gemini_api_key)
        _model = genai.GenerativeModel(settings.gemini_model)
        _cached_model_name = settings.gemini_model
        print(f"[Gemini] Using model: {settings.gemini_model}")
    return _model


def _call_with_retry(prompt: str, max_retries: int = 3) -> str:
    """Call Gemini with simple exponential-backoff retry on transient errors."""
    for attempt in range(max_retries):
        try:
            model = _get_model()
            response = model.generate_content(
                prompt,
                request_options={"timeout": 20},  # 20s hard timeout per call
            )
            return response.text.strip()
        except Exception as e:
            if attempt == max_retries - 1:
                raise
            wait = 2 ** attempt  # 1 s, 2 s …
            print(f"[Gemini] attempt {attempt + 1} failed ({e}), retrying in {wait}s")
            time.sleep(wait)


def get_embedding(text: str) -> list[float]:
    """
    Return 768-dim embedding for the given text using gemini-embedding-001
    with Matryoshka truncation to 768 dims (matches Pinecone index).
    """
    if not settings.gemini_api_key:
        # Return zero vector for testing without API key
        return [0.0] * 768

    genai.configure(api_key=settings.gemini_api_key)
    result = genai.embed_content(
        model=_embed_model,
        content=text,
        task_type="retrieval_document",
        output_dimensionality=768,
    )
    return result["embedding"]


def classify_question(question_text: str) -> dict:
    """
    Classify a question into type (MCQ/numerical), subtopics, difficulty,
    and extract correct answer.

    Returns:
        {
            "question_type": "mcq" | "numerical",
            "subtopics": ["integration_by_parts"],
            "difficulty": 3,
            "options": {"A": "...", "B": "...", "C": "...", "D": "..."},  # MCQ only, else null
            "correct_option": "B",  # MCQ only, else null
            "correct_answer": "42"  # numerical string, else the option letter for MCQ
        }
    """
    prompt = f"""You are a JEE Mathematics expert. Analyse the following question.

Question: {question_text}

Determine:
1. Is it MCQ (multiple choice) or numerical (integer/decimal answer)?
   If it is a proof, derivation, explanation, "show that", "prove that", "describe",
   "explain", "justify", "define", "discuss", "verify", "write", "state", "derive",
   "deduce", or ANY open-ended/subjective question — return {{"skip": true}} immediately.
2. The relevant JEE subtopics in snake_case (e.g. integration_by_parts).
3. Difficulty 1-5 (1=easy, 5=JEE Advanced).
4. If MCQ: extract options A/B/C/D and the correct option letter.
5. If numerical: solve and provide the exact numeric answer.

Return ONLY valid JSON:
{{
  "question_type": "mcq or numerical",
  "subtopics": ["<concept_key>"],
  "difficulty": <1-5>,
  "options": {{"A": "...", "B": "...", "C": "...", "D": "..."}} or null,
  "correct_option": "B" or null,
  "correct_answer": "42" or null
}}

If the question is subjective/proof/open-ended, return ONLY: {{"skip": true}}
If MCQ and options are not present in the question text, generate plausible JEE-style options.
Only the JSON — no explanation."""

    try:
        model = _get_model()
        response = model.generate_content(prompt)
        raw = response.text.strip()
        if "```" in raw:
            parts = raw.split("```")
            raw = parts[1].strip()
            if raw.lower().startswith("json"):
                raw = raw[4:].strip()
        start = raw.find("{")
        end = raw.rfind("}") + 1
        if start != -1 and end > start:
            raw = raw[start:end]
        result = json.loads(_fix_json_escapes(raw))
        # Normalise
        result.setdefault("question_type", "numerical")
        result.setdefault("subtopics", ["unknown"])
        result.setdefault("difficulty", 3)
        result.setdefault("options", None)
        result.setdefault("correct_option", None)
        result.setdefault("correct_answer", None)
        return result
    except Exception as e:
        print(f"[Gemini] classify_question error: {e}")
        return {
            "question_type": "numerical",
            "subtopics": ["unknown"],
            "difficulty": 3,
            "options": None,
            "correct_option": None,
            "correct_answer": None,
        }


def batch_classify_questions(questions: list[str], topic: str) -> list[dict]:
    """
    Classify a batch of questions via Gemini, chunked to avoid 504 timeouts.

    Sends at most CHUNK_SIZE questions per API call to keep prompts small.
    Falls back to default {subtopics:[topic], difficulty:3} on any failure.
    """
    if not questions:
        return []

    CHUNK_SIZE = 8  # keep prompts small — larger batches cause 504 timeouts

    default = {
        "question_type": "numerical",
        "subtopics": [topic],
        "difficulty": 3,
        "options": None,
        "correct_option": None,
        "correct_answer": None,
    }

    def _classify_chunk(chunk: list[str]) -> list[dict]:
        numbered = "\n".join(f"{i+1}. {q[:280]}" for i, q in enumerate(chunk))
        prompt = f"""You are a JEE Mathematics expert. Classify each question below.

Topic context: {topic.replace("_", " ")}

Questions:
{numbered}

Return ONLY a JSON array of {len(chunk)} objects, one per question, in order.
Each object must have: "question_type" ("mcq"/"numerical"), "subtopics" (array),
"difficulty" (1-5), "options" (object or null), "correct_option" (letter or null),
"correct_answer" (string or null).

CRITICAL: If a question is subjective, open-ended, or requires a written response — including
"show that", "prove that", "verify", "demonstrate", "explain", "describe", "discuss",
"define", "justify", "derive", "deduce", "write", "state", "give reasons", "comment" —
set ONLY {{"skip": true}} in that object. These have no definite numerical/MCQ answer
and must NOT be stored.
No explanation. Only valid JSON array."""

        try:
            # Only 1 retry for classify — avoid wasting 7s on repeated 504s
            raw = _call_with_retry(prompt, max_retries=2)
            if "```" in raw:
                parts = raw.split("```")
                raw = parts[1].strip()
                if raw.lower().startswith("json"):
                    raw = raw[4:].strip()
            start = raw.find("[")
            end = raw.rfind("]") + 1
            if start == -1 or end <= start:
                return [{**default} for _ in chunk]
            results = json.loads(_fix_json_escapes(raw[start:end]))
            if not isinstance(results, list):
                return [{**default} for _ in chunk]
            out = []
            for r in results[:len(chunk)]:
                if not isinstance(r, dict):
                    out.append({**default})
                    continue
                r.setdefault("question_type", "numerical")
                subtopics = r.get("subtopics") or [topic]
                if subtopics == ["unknown"] or not subtopics:
                    subtopics = [topic]
                r["subtopics"] = subtopics
                r.setdefault("difficulty", 3)
                r.setdefault("options", None)
                r.setdefault("correct_option", None)
                r.setdefault("correct_answer", None)
                out.append(r)
            while len(out) < len(chunk):
                out.append({**default})
            return out
        except Exception as e:
            print(f"[Gemini] batch_classify_questions error: {e}")
            return [{**default} for _ in chunk]

    # Process chunks and aggregate
    all_results: list[dict] = []
    for i in range(0, len(questions), CHUNK_SIZE):
        chunk = questions[i : i + CHUNK_SIZE]
        all_results.extend(_classify_chunk(chunk))
    return all_results


def generate_lesson(concept: str, learner_context: str = "") -> str:
    """
    Generate a 60-second micro-lesson for the given concept.

    Returns plain-paragraph explanation with LaTeX math in $...$ delimiters.
    NO markdown formatting (no ##, no **, no bullet dashes).
    """
    concept_label = concept.replace("_", " ")
    context_block = (
        f"\nLearner context (tailor your explanation accordingly): {learner_context}"
        if learner_context else ""
    )
    prompt = f"""You are a JEE Maths expert tutor speaking directly to your student.{context_block}
Your student is struggling with: {concept_label}

Write a concise 60-second explanation addressing them as \"you\" (not \"the student\").
Use PLAIN PARAGRAPHS (no markdown, no ### headings, no **bold**, no bullet lists). Use blank lines to separate sections.

Cover:
1. Core idea (2-3 sentences)
2. Key formula or rule
3. One worked example with step-by-step reasoning

Math rules:
- Wrap ALL math in $...$ for inline or $$...$$ for display math on its own line
- Use $^n C_r$ for combinations, $^n P_r$ for permutations
- Use $\\dfrac{{a}}{{b}}$ for fractions
- NEVER use ### headings, **bold**, or - bullet syntax"""

    try:
        return _call_with_retry(prompt)
    except Exception as e:
        print(f"[Gemini] generate_lesson error: {e}")
        return f"Review your notes on {concept_label} and try similar problems to build understanding."


def solve_doubt_with_image(
    image_base64: str,
    mime_type: str = "image/jpeg",
    student_attempt: str = "",
) -> dict:
    """
    Solve a doubt from an image (screenshot/photo of a question).

    Uses Gemini Vision to both read the question from the image and solve it.
    Returns same structure as solve_doubt().
    """
    attempt_section = (
        f"\nStudent's attempt: {student_attempt}" if student_attempt else ""
    )

    solve_prompt = (
        f"You are a JEE Maths expert. Look at the question in the image and solve it step-by-step.{attempt_section}\n\n"
        "Return ONLY valid JSON with this exact structure:\n"
        "{\n"
        '  "steps": ["Step 1: ...", "Step 2: ...", "..."],\n'
        '  "final_answer": "<wrap all math in $...$ inline or $$...$$ display>",\n'
        '  "sympy_expr": "<sympy-compatible Python expression or empty string>"\n'
        "}\n\n"
        "IMPORTANT: ALL math in steps and final_answer MUST be wrapped in $...$ or $$...$$. "
        "Be precise. Each step must be clear and numbered."
    )

    try:
        model = _get_model()
        image_bytes = base64.b64decode(image_base64)
        response = model.generate_content([
            {"mime_type": mime_type, "data": image_bytes},
            solve_prompt,
        ])
        raw = response.text.strip()
        if "```" in raw:
            parts = raw.split("```")
            raw = parts[1].strip()
            if raw.lower().startswith("json"):
                raw = raw[4:].strip()
        start = raw.find("{")
        end = raw.rfind("}") + 1
        if start != -1 and end > start:
            raw = raw[start:end]
        return json.loads(_fix_json_escapes(raw))
    except Exception as e:
        print(f"[Gemini] solve_doubt_with_image error: {e}")
        return {
            "steps": [f"[Error processing image: {e}]"],
            "final_answer": "",
            "sympy_expr": "",
        }


def solve_doubt(question_text: str, student_attempt: str = "") -> dict:
    """
    Generate a step-by-step solution with a verifiable final answer.

    Returns:
        {
            "steps": ["Step 1: ...", "Step 2: ..."],
            "final_answer": "...",
            "sympy_expr": "..."  # optional, for sympy verification
        }
    """
    attempt_section = (
        f"\nStudent's attempt: {student_attempt}" if student_attempt else ""
    )

    prompt = f"""You are a JEE Maths expert. Solve the following problem step-by-step.{attempt_section}

Problem: {question_text}

Return ONLY valid JSON with this exact structure:
{{
  "steps": ["Step 1: ...", "Step 2: ...", "..."],
  "final_answer": "<the final answer — ALWAYS wrap any mathematical expression in $...$ for inline math or $$...$$ for display math, e.g. '$x = \\frac{{1}}{{2}}$' or '$$P(A) = \\frac{{n(A)}}{{n(S)}}$$'>",
  "sympy_expr": "<sympy-compatible Python expression for the final answer, or empty string>"
}}

IMPORTANT: ALL mathematical expressions — in both steps and final_answer — MUST be wrapped in $...$ (inline) or $$...$$ (block). Never output raw LaTeX without $ delimiters.
Be precise. Each step must be clear and numbered."""

    try:
        raw = _call_with_retry(prompt)
        # Strip markdown code fences if present
        if "```" in raw:
            parts = raw.split("```")
            raw = parts[1].strip()
            if raw.lower().startswith("json"):
                raw = raw[4:].strip()
        start = raw.find("{")
        end = raw.rfind("}") + 1
        if start != -1 and end > start:
            raw = raw[start:end]
        return json.loads(_fix_json_escapes(raw))
    except Exception as e:
        print(f"[Gemini] solve_doubt error: {e}")
        return {
            "steps": ["[Error generating solution]"],
            "final_answer": "",
            "sympy_expr": "",
        }


def generate_hint(question_text: str, learner_context: str = "") -> str:
    """
    Generate a helpful hint for a JEE maths question WITHOUT giving away the answer.
    Returns a single hint string (plain text + KaTeX-wrapped math).
    """
    context_block = (
        f"\nLearner context: {learner_context}" if learner_context else ""
    )
    prompt = f"""You are a JEE Mathematics tutor speaking directly to your student.{context_block}
Your student needs a hint for this problem:

{question_text}

Give ONE clear, helpful hint addressing them as \"you\" that guides them toward the solution without giving away the final answer.
Focus on the key concept, formula, or first step they should use.

Rules:
- ALWAYS wrap any mathematical expression in $...$ for inline math or $$...$$ for display math.
- Use $$...$$ (display math) for standalone formulas like binomial coefficients, fractions, or combinations — NOT inline $...$.
- Use $^nC_r$ notation for combinations (e.g. $^8C_2$) and $^nP_r$ for permutations (e.g. $^8P_2$) — never use \\binom or \\dbinom.
- Use \\dfrac instead of \\frac for fractions so they render readable.
- Limit to 2-3 sentences.
- Do NOT reveal the final numerical answer.
- Return only the hint text, no preamble."""

    try:
        return _call_with_retry(prompt)
    except Exception as e:
        print(f"[Gemini] generate_hint error: {e}")
        return "Think about the key formula or identity relevant to this topic and try applying it step by step."


def generate_questions_for_topic(topic: str, n: int = 5, learner_context: str = "") -> list[dict]:
    """
    Generate n JEE-level MCQ and numerical questions for a topic.
    Called as fallback when Pinecone + Tavily both return nothing.

    Returns list of dicts with full MCQ/numerical structure.
    """
    context_block = (
        f"\nLearner context (target difficulty accordingly): {learner_context}"
        if learner_context else ""
    )
    prompt = f"""You are an expert JEE Mathematics problem setter.{context_block}
Generate exactly {n} JEE-style practice questions for: **{topic.replace('_', ' ')}**.

Mix of MCQ (multiple choice) and numerical (integer answer) types, as in JEE Mains/Advanced.

Return ONLY a JSON array, each object:
{{
  "text": "<question with math in $...$ LaTeX>",
  "question_type": "mcq" or "numerical",
  "options": {{"A": "...", "B": "...", "C": "...", "D": "..."}} or null,
  "correct_option": "B" or null,
  "correct_answer": "42" or null,
  "difficulty": <1-5>,
  "subtopics": ["<snake_case_concept>"]
}}

Rules:
- MCQ: exactly 4 options, one correct_option letter, correct_answer = null
- numerical: options = null, correct_option = null, correct_answer = integer/decimal string
- Use $...$ inline math, $$...$$ display math
- Use $^nC_r$ for combinations, $\\dfrac{{a}}{{b}}$ for fractions
- Authentic JEE style, no trivial questions
- No extra text outside JSON array"""

    try:
        raw = _call_with_retry(prompt)
        if "```" in raw:
            parts = raw.split("```")
            raw = parts[1].strip()
            if raw.lower().startswith("json"):
                raw = raw[4:].strip()
        start = raw.find("[")
        end = raw.rfind("]") + 1
        if start == -1 or end == 0:
            return []
        return json.loads(_fix_json_escapes(raw[start:end]))[:n]
    except json.JSONDecodeError as e:
        print(f"[Gemini] generate_questions_for_topic JSON error: {e}")
        print(f"[Gemini] raw (first 300): {raw[:300]!r}")
        return []
    except Exception as e:
        print(f"[Gemini] generate_questions_for_topic error: {e}")
        return []
