"use client";
import { useEffect, useRef, useState } from "react";
import { Question, AnswerResponse, submitAnswer, getHint } from "@/lib/api";
import MathText from "@/components/MathText";

interface Props {
  question: Question;
  userId: number;
  index: number;
  total: number;
  onResult: (res: AnswerResponse) => void;
}

const DIFF_LABELS: Record<number, string> = {
  1: "Easy",
  2: "Medium-Easy",
  3: "Medium",
  4: "Hard",
  5: "JEE Advanced",
};
const DIFF_STYLES: Record<number, { bg: string; color: string; border: string }> = {
  1: { bg: "rgba(67,232,216,0.08)", color: "var(--neon3)", border: "rgba(67,232,216,0.2)" },
  2: { bg: "rgba(67,232,216,0.06)", color: "var(--neon3)", border: "rgba(67,232,216,0.15)" },
  3: { bg: "rgba(251,191,36,0.08)", color: "var(--gold)", border: "rgba(251,191,36,0.2)" },
  4: { bg: "rgba(255,101,132,0.08)", color: "var(--neon2)", border: "rgba(255,101,132,0.2)" },
  5: { bg: "rgba(255,101,132,0.12)", color: "var(--neon2)", border: "rgba(255,101,132,0.3)" },
};
const DEFAULT_DIFF = { bg: "rgba(124,111,255,0.08)", color: "var(--accent2)", border: "rgba(124,111,255,0.2)" };

export default function QuestionCard({ question, userId, index, total, onResult }: Props) {
  const [selectedOption, setSelectedOption] = useState("");
  const [userAnswer, setUserAnswer] = useState("");
  const [retries, setRetries] = useState(0);
  const [localIncorrect, setLocalIncorrect] = useState(false);
  const [hintUsed, setHintUsed] = useState(false);
  const [hint, setHint] = useState<string | null>(null);
  const [hintLoading, setHintLoading] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [result, setResult] = useState<AnswerResponse | null>(null);
  const startRef = useRef(Date.now());
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const isMCQ = question.question_type === "mcq";
  const diffStyle = DIFF_STYLES[question.difficulty] ?? DEFAULT_DIFF;

  useEffect(() => {
    setSelectedOption(""); setUserAnswer(""); setRetries(0);
    setLocalIncorrect(false); setHintUsed(false); setHint(null);
    setHintLoading(false); setElapsed(0); setSubmitting(false);
    setSubmitted(false); setResult(null);
    startRef.current = Date.now();
    timerRef.current = setInterval(() => {
      setElapsed(Math.floor((Date.now() - startRef.current) / 1000));
    }, 1000);
    return () => { if (timerRef.current) clearInterval(timerRef.current); };
  }, [question.id]);

  function gradeLocally(answer: string): boolean {
    if (isMCQ) {
      return answer.toUpperCase() === (question.correct_option || "").toUpperCase();
    }
    try {
      const uv = parseFloat(answer);
      const cv = parseFloat(question.correct_answer || "");
      if (!isNaN(uv) && !isNaN(cv)) return Math.abs(uv - cv) < 0.01;
    } catch { /* fall through */ }
    return answer.trim().toLowerCase() === (question.correct_answer || "").trim().toLowerCase();
  }

  async function handleSubmit() {
    const answer = isMCQ ? selectedOption : userAnswer.trim();
    if (!answer || submitting) return;
    const isCorrect = gradeLocally(answer);
    if (!isCorrect && retries < 1) {
      setLocalIncorrect(true); setRetries(1); return;
    }
    if (timerRef.current) clearInterval(timerRef.current);
    setSubmitting(true);
    const timeTaken = Math.floor((Date.now() - startRef.current) / 1000);
    try {
      const res = await submitAnswer(userId, question.id, answer, timeTaken, retries, hintUsed);
      setResult(res); setSubmitted(true);
    } catch {
      const fallback: AnswerResponse = {
        cms: isCorrect ? (retries === 0 ? 0.85 : 0.55) : 0,
        old_skill: 1000, new_skill: 1000, skill_delta: 0, remediation: null,
        message: isCorrect ? "Correct!" : "Incorrect.",
        is_correct: isCorrect,
        correct_answer: question.correct_answer || "",
        explanation: isCorrect ? "Correct!" : `The correct answer is ${isMCQ ? question.correct_option : question.correct_answer}.`,
      };
      setResult(fallback); setSubmitted(true);
    } finally {
      setSubmitting(false);
    }
  }

  const mm = String(Math.floor(elapsed / 60)).padStart(2, "0");
  const ss = String(elapsed % 60).padStart(2, "0");

  return (
    <div className="card space-y-5">
      {/* ── Header row ── */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="text-xs font-semibold" style={{ color: "var(--text3)" }}>
            {index + 1} / {total}
          </span>
          <span
            className="px-2 py-0.5 rounded-full text-xs font-bold"
            style={{
              background: "rgba(124,111,255,0.1)",
              border: "1px solid rgba(124,111,255,0.2)",
              color: "var(--accent2)",
            }}
          >
            {isMCQ ? "MCQ" : "Numerical"}
          </span>
        </div>
        <div className="flex items-center gap-2">
          <span
            className="px-2.5 py-0.5 rounded-full text-xs font-bold"
            style={{
              background: diffStyle.bg,
              border: `1px solid ${diffStyle.border}`,
              color: diffStyle.color,
            }}
          >
            {DIFF_LABELS[question.difficulty] ?? `Level ${question.difficulty}`}
          </span>
          <div
            className="flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-mono font-semibold"
            style={{
              background: "var(--surface2)",
              border: "1px solid var(--border)",
              color: "var(--text2)",
            }}
          >
            <div className="pulse-dot" style={{ width: 5, height: 5 }} />
            {mm}:{ss}
          </div>
        </div>
      </div>

      {/* ── Subtopic tags ── */}
      <div className="flex flex-wrap gap-1.5">
        {question.subtopics.map((s) => (
          <span key={s} className="badge text-xs">
            {s.replace(/_/g, " ")}
          </span>
        ))}
      </div>

      {/* ── Question text ── */}
      <div
        className="rounded-xl p-4 text-base leading-relaxed"
        style={{
          background: "rgba(0,0,0,0.2)",
          border: "1px solid var(--border2)",
          color: "var(--text)",
        }}
      >
        <MathText text={question.text} />
      </div>

      {!submitted ? (
        <>
          {/* ── Hint ── */}
          <div className="space-y-2">
            <label className="flex items-center gap-2.5 cursor-pointer select-none w-fit">
              <div
                onClick={async () => {
                  if (!hintUsed) {
                    setHintUsed(true);
                    if (!hint) {
                      setHintLoading(true);
                      try {
                        const res = await getHint(question.id);
                        setHint(res.hint);
                      } catch {
                        setHint("Think about the key formula for this topic and apply it step by step.");
                      } finally {
                        setHintLoading(false);
                      }
                    }
                  } else {
                    setHintUsed(false);
                  }
                }}
                className="w-10 h-5 rounded-full relative cursor-pointer transition-colors"
                style={{ background: hintUsed ? "var(--gold)" : "var(--surface2)", border: "1px solid var(--border)" }}
              >
                <div
                  className="absolute top-0.5 w-4 h-4 bg-white rounded-full shadow transition-transform"
                  style={{ transform: hintUsed ? "translateX(20px)" : "translateX(2px)" }}
                />
              </div>
              <span className="text-sm" style={{ color: hintUsed ? "var(--gold)" : "var(--text3)" }}>
                {hintUsed ? "✦ Hint used (reduces score)" : "Use hint"}
              </span>
            </label>
            {hintUsed && (
              <div
                className="rounded-xl px-4 py-3 text-sm"
                style={{
                  background: "rgba(251,191,36,0.06)",
                  border: "1px solid rgba(251,191,36,0.2)",
                }}
              >
                {hintLoading ? (
                  <div className="flex items-center gap-2" style={{ color: "var(--gold)" }}>
                    <div className="w-3.5 h-3.5 border-2 rounded-full animate-spin" style={{ borderColor: "rgba(251,191,36,0.3)", borderTopColor: "var(--gold)" }} />
                    Generating hint…
                  </div>
                ) : hint ? (
                  <div style={{ color: "var(--text2)" }}>
                    <span className="font-semibold mr-1" style={{ color: "var(--gold)" }}>Hint:</span>
                    <MathText text={hint} />
                  </div>
                ) : null}
              </div>
            )}
          </div>

          {/* ── Answer input ── */}
          {!localIncorrect ? (
            <>
              {isMCQ ? (
                <div className="space-y-2">
                  <label className="text-xs font-semibold uppercase tracking-wider" style={{ color: "var(--text3)" }}>
                    Select the correct option
                  </label>
                  <div className="space-y-2">
                    {(["A", "B", "C", "D"] as const).map((opt) => {
                      const optText = question.options?.[opt] ?? "";
                      if (!optText) return null;
                      const isSelected = selectedOption === opt;
                      return (
                        <button
                          key={opt}
                          type="button"
                          onClick={() => setSelectedOption(opt)}
                          className={`q-option w-full text-left${isSelected ? " selected" : ""}`}
                        >
                          <span className={`opt-letter${isSelected ? " selected" : ""}`}>{opt}</span>
                          <span className="text-sm leading-relaxed">
                            <MathText text={optText} />
                          </span>
                        </button>
                      );
                    })}
                  </div>
                </div>
              ) : (
                <div className="space-y-2">
                  <label className="text-xs font-semibold uppercase tracking-wider" style={{ color: "var(--text3)" }}>
                    Your Answer (enter a number)
                  </label>
                  <input
                    type="number"
                    value={userAnswer}
                    onChange={(e) => setUserAnswer(e.target.value)}
                    onKeyDown={(e) => e.key === "Enter" && handleSubmit()}
                    placeholder="e.g. 42 or 3.5"
                    className="input text-lg font-mono [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                  />
                </div>
              )}

              <button
                onClick={handleSubmit}
                disabled={isMCQ ? !selectedOption || submitting : !userAnswer.trim() || submitting}
                className="btn-primary w-full"
              >
                {submitting ? (
                  <>
                    <div className="w-4 h-4 rounded-full border-2 border-white/30 border-t-white animate-spin" />
                    Submitting…
                  </>
                ) : (
                  "Submit Answer →"
                )}
              </button>
            </>
          ) : (
            /* Retry prompt */
            <div className="space-y-3">
              <div
                className="flex items-center gap-2 px-4 py-3 rounded-xl font-semibold text-sm"
                style={{
                  background: "rgba(255,101,132,0.08)",
                  border: "1px solid rgba(255,101,132,0.25)",
                  color: "var(--neon2)",
                }}
              >
                <span>✗</span>
                <span>Incorrect — one more try!</span>
              </div>
              <button
                onClick={() => { setLocalIncorrect(false); setSelectedOption(""); setUserAnswer(""); }}
                className="btn-ghost w-full"
              >
                Try again →
              </button>
            </div>
          )}
        </>
      ) : result ? (
        /* ── Result panel ── */
        <div className="space-y-4">
          {/* Result banner */}
          <div
            className="flex items-center gap-2 px-4 py-3 rounded-xl font-semibold text-sm"
            style={{
              background: result.is_correct ? "rgba(67,232,216,0.08)" : "rgba(255,101,132,0.08)",
              border: `1px solid ${result.is_correct ? "rgba(67,232,216,0.25)" : "rgba(255,101,132,0.25)"}`,
              color: result.is_correct ? "var(--neon3)" : "var(--neon2)",
            }}
          >
            <span className="text-lg">{result.is_correct ? "✓" : "✗"}</span>
            {result.is_correct ? "Correct!" : "Incorrect"}
            {result.skill_delta !== 0 && (
              <span
                className="ml-auto font-mono font-bold"
                style={{ color: result.is_correct && result.skill_delta > 0 ? "var(--neon3)" : "var(--neon2)" }}
              >
                {result.is_correct && result.skill_delta > 0 ? "+" : "−"}{Math.abs(result.skill_delta)} ELO
              </span>
            )}
          </div>

          {/* Your answer */}
          <div
            className="rounded-xl p-3 space-y-1"
            style={{ background: "var(--surface2)", border: "1px solid var(--border)" }}
          >
            <p className="text-xs font-semibold uppercase tracking-wider" style={{ color: "var(--text3)" }}>Your answer</p>
            <p className="text-sm" style={{ color: "var(--text2)" }}>{isMCQ ? selectedOption : userAnswer}</p>
          </div>

          {/* Correct answer */}
          {result.correct_answer && (
            <div
              className="rounded-xl p-3 space-y-1"
              style={{
                background: "rgba(67,232,216,0.05)",
                border: "1px solid rgba(67,232,216,0.2)",
              }}
            >
              <p className="text-xs font-semibold uppercase tracking-wider" style={{ color: "var(--neon3)" }}>Correct answer</p>
              <div className="text-sm leading-relaxed" style={{ color: "var(--text)" }}>
                <MathText text={result.correct_answer} />
              </div>
            </div>
          )}

          {/* Explanation */}
          {result.explanation && (
            <div
              className="rounded-xl p-3 space-y-1"
              style={{
                background: "rgba(124,111,255,0.06)",
                border: "1px solid rgba(124,111,255,0.18)",
              }}
            >
              <p className="text-xs font-semibold uppercase tracking-wider" style={{ color: "var(--accent2)" }}>Explanation</p>
              <div className="text-sm leading-relaxed" style={{ color: "var(--text2)" }}>
                <MathText text={result.explanation} />
              </div>
            </div>
          )}

          {/* Remediation */}
          {result.remediation && (
            <div
              className="rounded-xl p-3 space-y-2"
              style={{
                background: "rgba(251,191,36,0.05)",
                border: "1px solid rgba(251,191,36,0.2)",
              }}
            >
              <p className="text-xs font-semibold uppercase tracking-wider" style={{ color: "var(--gold)" }}>
                📚 Lesson to review
                {result.remediation.weak_prereq && (
                  <span className="ml-2 normal-case font-normal" style={{ color: "rgba(251,191,36,0.6)" }}>
                    — {result.remediation.weak_prereq.replace(/_/g, " ")}
                  </span>
                )}
              </p>
              <div className="text-sm leading-relaxed" style={{ color: "var(--text2)" }}>
                <MathText text={result.remediation.lesson} />
              </div>
              {result.remediation.guided_questions?.length > 0 && (
                <div className="mt-2 space-y-1">
                  <p className="text-xs font-medium" style={{ color: "rgba(251,191,36,0.6)" }}>Practice these:</p>
                  {result.remediation.guided_questions.map((q, i) => (
                    <div
                      key={i}
                      className="text-xs rounded-lg px-3 py-2"
                      style={{ background: "var(--surface2)", color: "var(--text2)" }}
                    >
                      <MathText text={q.text} />
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* CMS */}
          <div
            className="flex items-center justify-between text-xs px-1"
            style={{ color: "var(--text3)" }}
          >
            <span>
              CMS:{" "}
              <span className="font-mono font-semibold" style={{ color: "var(--accent2)" }}>
                {(result.cms * 100).toFixed(0)}%
              </span>
            </span>
            <span>{result.message}</span>
          </div>

          <button onClick={() => onResult(result)} className="btn-primary w-full">
            Next Question →
          </button>
        </div>
      ) : null}
    </div>
  );
}
