"use client";
import { useEffect, useState, useRef } from "react";
import { useParams, useRouter } from "next/navigation";
import { startPractice, AnswerResponse, Question } from "@/lib/api";
import { getUser } from "@/lib/auth";
import QuestionCard from "@/components/QuestionCard";
import Link from "next/link";

interface Result extends AnswerResponse {
  questionIndex: number;
}

export default function PracticePage() {
  const params = useParams();
  const router = useRouter();
  const topic = params.topic as string;

  const [questions, setQuestions] = useState<Question[]>([]);
  const [current, setCurrent] = useState(0);
  const [results, setResults] = useState<Result[]>([]);
  const [loading, setLoading] = useState(true);
  const [fetchingMore, setFetchingMore] = useState(false);
  const [error, setError] = useState("");
  const [done, setDone] = useState(false);
  const [exhausted, setExhausted] = useState(false);
  const [ingesting, setIngesting] = useState(false);
  const [pollCount, setPollCount] = useState(0);
  const [userId, setUserId] = useState<number | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const stopPolling = () => {
    if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null; }
  };

  const loadQuestions = async (uid: number, isPolling = false) => {
    try {
      const res = await startPractice(uid, topic, 5);

      if (res.status === "exhausted") {
        setExhausted(true);
        setLoading(false);
        stopPolling();
        return;
      }

      if (res.status === "loading" || res.questions_count === 0) {
        // Background ingest is running — start/keep polling
        setIngesting(true);
        if (!pollRef.current) {
          pollRef.current = setInterval(() => {
            setPollCount((c) => c + 1);
          }, 3000);
        }
        setLoading(false);
        return;
      }

      // status === "ready" — we have questions
      stopPolling();
      setIngesting(false);
      setQuestions(res.questions);
      setLoading(false);
    } catch (e: unknown) {
      // On ANY error (network, timeout, server down) — never show error screen.
      // Instead, start/continue polling so the user sees the "Sourcing Questions…"
      // screen and we retry automatically every 3s.
      const msg = e instanceof Error ? e.message : "";
      const isServerError = msg.includes("Cannot reach") || msg.includes("timed out") || msg.includes("HTTP 5");
      if (!isPolling || isServerError) {
        setIngesting(true);
        setLoading(false);
        if (!pollRef.current) {
          pollRef.current = setInterval(() => setPollCount((c) => c + 1), 3000);
        }
      }
      // Only show error for non-server issues after user has been practicing
      if (!isServerError && questions.length > 0) {
        setError(msg || "Something went wrong");
      }
    }
  };

  useEffect(() => {
    const user = getUser();
    if (!user) { router.push("/login"); return; }
    setUserId(user.user_id);
    loadQuestions(user.user_id);
    return () => stopPolling();
  }, [topic, router]);

  // Triggered by the interval counter
  useEffect(() => {
    if (pollCount === 0 || !ingesting) return;
    const user = getUser();
    if (user) loadQuestions(user.user_id, true);
  }, [pollCount]);

  async function handleResult(res: AnswerResponse) {
    const updatedResults = [...results, { ...res, questionIndex: current }];
    setResults(updatedResults);
    const nextIndex = current + 1;

    if (nextIndex < questions.length) {
      setCurrent(nextIndex);
    } else {
      const user = getUser();
      if (!user) { setDone(true); return; }
      setFetchingMore(true);
      try {
        const more = await startPractice(user.user_id, topic, 5);
        if (more.status === "exhausted") {
          setExhausted(true);
          setDone(true);
        } else if (more.questions && more.questions.length > 0) {
          setQuestions(more.questions);
          setCurrent(0);
        } else {
          setDone(true);
        }
      } catch {
        setDone(true);
      } finally {
        setFetchingMore(false);
      }
    }
  }

  const topicLabel = topic.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());

  // ── Initial loading ──
  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-center space-y-4">
          <div className="spin-ring mx-auto" />
          <p className="text-sm font-medium" style={{ color: "var(--text2)" }}>Fetching questions for {topicLabel}…</p>
          <p className="text-xs" style={{ color: "var(--text3)" }}>First visit may take a few seconds</p>
        </div>
      </div>
    );
  }

  // ── Background ingest in progress — polling ──
  if (ingesting && questions.length === 0) {
    return (
      <div className="min-h-screen flex items-center justify-center p-4">
        <div className="card max-w-md w-full text-center space-y-5" style={{ padding: "40px" }}>
          <div className="text-5xl">🔍</div>
          <h2
            className="text-xl font-bold"
            style={{
              fontFamily: "'Google Sans Display', sans-serif",
              background: "linear-gradient(135deg, var(--accent2), var(--neon3))",
              WebkitBackgroundClip: "text",
              WebkitTextFillColor: "transparent",
            }}
          >
            Sourcing Questions…
          </h2>
          <p className="text-sm leading-relaxed" style={{ color: "var(--text2)" }}>
            We&apos;re hunting for the best{" "}
            <span className="font-semibold" style={{ color: "var(--accent2)" }}>{topicLabel}</span>{" "}
            problems from the web just for you.
          </p>
          <p className="text-xs" style={{ color: "var(--text3)" }}>This takes about 15–20 seconds. Hang tight!</p>
          <div className="flex justify-center gap-2 pt-1">
            {[0, 1, 2].map((i) => (
              <div
                key={i}
                className="bounce-dot"
                style={{ animationDelay: `${i * 0.15}s` }}
              />
            ))}
          </div>
          <p className="text-xs" style={{ color: "var(--text3)" }}>Auto-refreshing every 3s…</p>
          <Link href="/dashboard" className="btn-ghost text-sm inline-flex">
            ← Back to dashboard
          </Link>
        </div>
      </div>
    );
  }

  // ── Error ──
  if (error) {
    return (
      <div className="min-h-screen flex items-center justify-center p-4">
        <div className="card max-w-md text-center space-y-4">
          <p className="text-sm" style={{ color: "var(--neon2)" }}>{error}</p>
          <Link href="/dashboard" className="btn-ghost">← Back to dashboard</Link>
        </div>
      </div>
    );
  }

  // ── Topic exhausted — user has seen all available questions ──
  if (exhausted && !done) {
    return (
      <div className="min-h-screen flex items-center justify-center p-4">
        <div className="card max-w-md w-full text-center space-y-5" style={{ padding: "40px" }}>
          <div className="text-6xl">🏆</div>
          <h2
            className="text-2xl font-bold"
            style={{ fontFamily: "'Google Sans Display', sans-serif", color: "var(--text)" }}
          >
            You&apos;re a Legend!
          </h2>
          <p className="font-semibold" style={{ color: "var(--accent2)" }}>{topicLabel}</p>
          <p className="text-sm leading-relaxed" style={{ color: "var(--text2)" }}>
            You&apos;ve conquered every available question for this topic.
            Our AI is continuously sourcing harder problems — check back soon!
          </p>
          <div
            className="rounded-xl p-4 text-sm space-y-1 text-left"
            style={{ background: "var(--surface2)", border: "1px solid var(--border)" }}
          >
            <p style={{ color: "var(--text2)" }}>
              ✅ <span className="font-semibold" style={{ color: "var(--text)" }}>{results.length}</span> questions answered
            </p>
            <p style={{ color: "var(--text2)" }}>
              🎯 <span className="font-semibold" style={{ color: "var(--text)" }}>{results.filter(r => r.is_correct).length}</span> correct
            </p>
          </div>
          <div className="flex gap-3">
            <Link href="/dashboard" className="btn-primary flex-1 text-center">
              Pick another topic
            </Link>
            <button
              onClick={() => { setExhausted(false); setLoading(true); const u = getUser(); if (u) loadQuestions(u.user_id); }}
              className="btn-ghost flex-1"
            >
              Check for new ↻
            </button>
          </div>
        </div>
      </div>
    );
  }

  // ── Session summary ──
  if (done) {
    const correct = results.filter((r) => r.is_correct).length;
    const avgCms = results.length > 0 ? results.reduce((s, r) => s + r.cms, 0) / results.length : 0;
    const lastSkill = results[results.length - 1]?.new_skill ?? 1000;
    const emoji = exhausted ? "🏆" : correct === results.length ? "🎉" : correct === 0 ? "📚" : "💪";
    return (
      <div className="min-h-screen flex items-center justify-center p-4">
        <div className="w-full max-w-md space-y-4">
          <div className="card text-center space-y-4" style={{ padding: "36px" }}>
            <div className="text-4xl">{emoji}</div>
            <h2
              className="text-2xl font-bold"
              style={{ fontFamily: "'Google Sans Display', sans-serif", color: "var(--text)" }}
            >
              {exhausted ? "Topic Mastered!" : "Session Complete"}
            </h2>
            <p className="text-sm" style={{ color: "var(--text3)" }}>{topicLabel}</p>
            {exhausted && (
              <p className="text-sm" style={{ color: "var(--accent2)" }}>You&apos;ve seen every question for this topic 🎖️</p>
            )}

            <div
              className="grid grid-cols-3 gap-3 mt-2"
              style={{
                background: "var(--surface2)",
                border: "1px solid var(--border)",
                borderRadius: "var(--r)",
                padding: "16px",
              }}
            >
              <StatBox label="Score" value={`${correct}/${results.length}`} />
              <StatBox label="Avg CMS" value={`${(avgCms * 100).toFixed(0)}%`} />
              <StatBox label="ELO" value={Math.round(lastSkill).toString()} />
            </div>

            {results.some((r) => r.remediation) && (
              <div
                className="rounded-xl p-4 text-left mt-2"
                style={{
                  background: "rgba(251,191,36,0.06)",
                  border: "1px solid rgba(251,191,36,0.2)",
                }}
              >
                <p className="text-xs font-semibold mb-2" style={{ color: "var(--gold)" }}>📖 Remediation tip</p>
                <p className="text-sm leading-relaxed" style={{ color: "var(--text2)" }}>
                  {results.find((r) => r.remediation)!.remediation!.lesson}
                </p>
              </div>
            )}
          </div>

          <div className="flex gap-3">
            {!exhausted && (
              <button
                onClick={() => {
                  setCurrent(0); setResults([]); setDone(false); setLoading(true);
                  const user = getUser();
                  if (user) loadQuestions(user.user_id);
                }}
                className="btn-primary flex-1"
              >
                Practice again
              </button>
            )}
            <Link href="/dashboard" className="btn-ghost flex-1 text-center">
              Dashboard
            </Link>
          </div>
        </div>
      </div>
    );
  }

  // ── Active question ──
  return (
    <div className="min-h-screen p-4 flex flex-col">
      {/* Nav */}
      <div className="flex items-center justify-between mb-4 max-w-2xl mx-auto w-full">
        <Link
          href="/dashboard"
          className="text-sm font-medium transition-colors"
          style={{ color: "var(--text3)" }}
          onMouseOver={(e) => (e.currentTarget.style.color = "var(--text2)")}
          onMouseOut={(e) => (e.currentTarget.style.color = "var(--text3)")}
        >
          ← Dashboard
        </Link>
        <span className="text-sm font-semibold" style={{ color: "var(--text2)" }}>{topicLabel}</span>
        <div className="flex items-center gap-3">
          {results.length > 0 && (
            <button
              onClick={() => setDone(true)}
              className="text-xs transition-colors"
              style={{ color: "var(--text3)" }}
              onMouseOver={(e) => (e.currentTarget.style.color = "var(--text2)")}
              onMouseOut={(e) => (e.currentTarget.style.color = "var(--text3)")}
            >
              Finish
            </button>
          )}
          {userId && (
            <Link
              href="/doubt"
              className="text-xs font-semibold transition-colors"
              style={{ color: "var(--accent2)" }}
            >
              Ask doubt
            </Link>
          )}
        </div>
      </div>

      {/* Progress bar */}
      <div className="max-w-2xl mx-auto w-full mb-5">
        <div
          className="h-1.5 rounded-full overflow-hidden"
          style={{ background: "var(--surface2)", border: "1px solid var(--border2)" }}
        >
          <div
            className="h-full rounded-full transition-all duration-500"
            style={{
              width: results.length > 0 ? `${Math.min((results.length % 10) * 10, 100)}%` : "0%",
              background: "linear-gradient(90deg, var(--neon), var(--accent2))",
              boxShadow: "0 0 8px var(--glow)",
            }}
          />
        </div>
        <div className="flex justify-between text-xs mt-1" style={{ color: "var(--text3)" }}>
          <span>{results.length} answered</span>
          <span>{results.filter((r) => r.is_correct).length} correct</span>
        </div>
      </div>

      {/* Loading next batch overlay */}
      {fetchingMore ? (
        <div className="max-w-2xl mx-auto w-full flex-1 flex items-center justify-center">
          <div className="text-center space-y-3">
            <div className="spin-ring mx-auto" />
            <p className="text-sm" style={{ color: "var(--text3)" }}>Loading next question…</p>
          </div>
        </div>
      ) : (
        <div className="max-w-2xl mx-auto w-full flex-1">
          {userId && questions[current] && (
            <QuestionCard
              key={`${questions[current].id}-${current}-${results.length}`}
              question={questions[current]}
              userId={userId}
              index={results.length}
              total={results.length + questions.length - current}
              onResult={handleResult}
            />
          )}
        </div>
      )}
    </div>
  );
}

function StatBox({ label, value }: { label: string; value: string }) {
  return (
    <div className="text-center">
      <div
        className="text-xl font-bold"
        style={{ color: "var(--accent2)", fontFamily: "'Google Sans Display', sans-serif" }}
      >
        {value}
      </div>
      <div className="text-xs mt-0.5" style={{ color: "var(--text3)" }}>{label}</div>
    </div>
  );
}

