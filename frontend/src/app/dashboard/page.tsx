"use client";
import { useEffect, useState, useRef } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { getDashboard, DashboardResponse, SkillEntry } from "@/lib/api";
import { getUser, clearUser } from "@/lib/auth";
import TopicSelector from "@/components/TopicSelector";

function skillColor(skill: number): string {
  if (skill >= 1100) return "var(--neon3)";
  if (skill >= 1000) return "var(--gold)";
  return "var(--neon2)";
}

function skillLabel(skill: number) {
  if (skill >= 1100) return "Strong";
  if (skill >= 1000) return "Average";
  return "Weak";
}

function ReadinessRing({ score }: { score: number }) {
  const pct = Math.round(score * 100);
  const r = 40;
  const circ = 2 * Math.PI * r;
  const offset = circ - (pct / 100) * circ;
  const color = pct >= 70 ? "var(--neon3)" : pct >= 40 ? "var(--gold)" : "var(--neon2)";
  return (
    <div className="relative w-28 h-28 flex items-center justify-center">
      <svg className="absolute" width="112" height="112" viewBox="0 0 112 112">
        <circle cx="56" cy="56" r={r} stroke="rgba(120,100,255,0.1)" strokeWidth="10" fill="none" />
        <circle
          cx="56" cy="56" r={r}
          stroke={color}
          strokeWidth="10"
          fill="none"
          strokeDasharray={circ}
          strokeDashoffset={offset}
          strokeLinecap="round"
          transform="rotate(-90 56 56)"
          style={{ transition: "stroke-dashoffset 1s ease", filter: `drop-shadow(0 0 6px ${color})` }}
        />
      </svg>
      <div className="text-center">
        <div className="text-2xl font-extrabold" style={{ color, fontFamily: "'Google Sans Display', sans-serif" }}>{pct}%</div>
        <div className="text-xs" style={{ color: "var(--text3)" }}>Readiness</div>
      </div>
    </div>
  );
}

function SkillBar({ label, skill, max = 1400 }: { label: string; skill: number; max?: number }) {
  const barRef = useRef<HTMLDivElement>(null);
  const pct = Math.max(0, Math.min(100, ((skill - 800) / (max - 800)) * 100));
  const color = skillColor(skill);

  useEffect(() => {
    const el = barRef.current;
    if (!el) return;
    const obs = new IntersectionObserver(([entry]) => {
      if (entry.isIntersecting) {
        el.style.width = pct + "%";
        obs.disconnect();
      }
    }, { threshold: 0.3 });
    obs.observe(el);
    return () => obs.disconnect();
  }, [pct]);

  return (
    <div className="flex items-center gap-3 text-sm">
      <div className="w-44 text-right text-xs truncate" style={{ color: "var(--text2)" }}>{label}</div>
      <div className="skill-bar-track flex-1">
        <div
          ref={barRef}
          className="skill-bar-fill"
          style={{ width: "0%", background: color }}
        />
      </div>
      <div className="w-12 text-right font-mono text-xs font-bold" style={{ color }}>
        {Math.round(skill)}
      </div>
    </div>
  );
}

export default function DashboardPage() {
  const router = useRouter();
  const [data, setData] = useState<DashboardResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [showTopics, setShowTopics] = useState(false);
  const [userName, setUserName] = useState("");
  const [userId, setUserId] = useState<number | null>(null);

  useEffect(() => {
    const user = getUser();
    if (!user) { router.push("/login"); return; }
    setUserName(user.name);
    setUserId(user.user_id);
    getDashboard(user.user_id)
      .then(setData)
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, [router]);

  function logout() { clearUser(); router.push("/login"); }

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-center space-y-4">
          <div className="spin-ring mx-auto" />
          <p className="text-sm" style={{ color: "var(--text2)" }}>Loading your dashboard…</p>
        </div>
      </div>
    );
  }

  const readiness = data?.readiness_score ?? 0.5;
  const skills: SkillEntry[] = data?.skill_vector ?? [];
  const attempts = data?.recent_attempts ?? [];
  const weakTopics = skills.filter((s) => s.skill < 1000);
  const strongTopics = skills.filter((s) => s.skill >= 1100);

  const defaultTopics = [
    { id: "integration_by_parts", label: "Integration by Parts" },
    { id: "limits", label: "Limits" },
    { id: "quadratic_equations", label: "Quadratic Equations" },
    { id: "basic_probability", label: "Probability" },
    { id: "complex_numbers_basics", label: "Complex Numbers" },
    { id: "differentiation_basics", label: "Differentiation" },
  ];

  const quickTopics = weakTopics.length > 0
    ? weakTopics.slice(0, 6).map((s) => ({
        id: s.concept,
        label: s.concept.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase()),
        isWeak: true,
      }))
    : defaultTopics.map((t) => ({ ...t, isWeak: false }));

  return (
    <div className="min-h-screen">
      {/* ── Navbar ── */}
      <nav className="sticky top-0 z-50 py-3 px-4">
        <div className="max-w-5xl mx-auto">
          <div className="nav-glass flex items-center justify-between px-5 py-3">
            <div>
              <span
                className="text-xl font-bold"
                style={{
                  fontFamily: "'Google Sans Display', sans-serif",
                  background: "linear-gradient(135deg, var(--accent2), var(--neon3))",
                  WebkitBackgroundClip: "text",
                  WebkitTextFillColor: "transparent",
                }}
              >
                Cognify
              </span>
              <span
                className="ml-2 text-xs hidden sm:inline"
                style={{ color: "var(--text3)" }}
              >
                Adaptive JEE Mathematics
              </span>
            </div>
            <div className="flex items-center gap-3">
              <Link href="/doubt" className="btn-ghost text-xs px-3 py-1.5">
                ✦ Doubt AI
              </Link>
              <span className="text-sm hidden sm:block" style={{ color: "var(--text2)" }}>
                {userName}
              </span>
              <button
                onClick={logout}
                className="text-xs transition-colors"
                style={{ color: "var(--text3)" }}
                onMouseOver={(e) => (e.currentTarget.style.color = "var(--neon2)")}
                onMouseOut={(e) => (e.currentTarget.style.color = "var(--text3)")}
              >
                Logout
              </button>
            </div>
          </div>
        </div>
      </nav>

      <main className="max-w-5xl mx-auto p-4 space-y-5 pb-16">
        {error && (
          <div
            className="px-4 py-3 rounded-xl text-sm"
            style={{
              background: "rgba(251,191,36,0.08)",
              border: "1px solid rgba(251,191,36,0.2)",
              color: "var(--gold)",
            }}
          >
            {error} — showing default view.
          </div>
        )}

        {/* ── Stats row ── */}
        <div
          className="grid grid-cols-2 sm:grid-cols-4 gap-px overflow-hidden rounded-2xl"
          style={{ background: "var(--border2)", border: "1px solid var(--border2)" }}
        >
          {[
            { label: "Readiness", node: <ReadinessRing score={readiness} /> },
            {
              label: null,
              node: (
                <div className="grid grid-cols-2 gap-4">
                  <StatBox label="Topics" value={skills.length > 0 ? skills.length.toString() : "—"} color="var(--accent2)" />
                  <StatBox label="Attempts" value={attempts.length > 0 ? attempts.length.toString() : "—"} color="var(--accent2)" />
                  <StatBox label="Weak" value={weakTopics.length.toString()} color="var(--neon2)" />
                  <StatBox label="Strong" value={strongTopics.length.toString()} color="var(--neon3)" />
                </div>
              ),
              colSpan: true,
            },
          ].map((item, i) => (
            <div
              key={i}
              className={`flex flex-col items-center justify-center p-6 ${(item as { colSpan?: boolean }).colSpan ? "col-span-2 sm:col-span-3 items-start" : ""}`}
              style={{ background: "var(--surface)" }}
            >
              {item.label && (
                <p className="text-xs mb-3" style={{ color: "var(--text3)" }}>{item.label}</p>
              )}
              {item.node}
            </div>
          ))}
        </div>

        {/* ── Practice a Topic ── */}
        <div className="card">
          <div className="flex items-center justify-between mb-4">
            <div>
              <div className="section-tag"><span className="bar" />Adaptive Practice</div>
              <h2 className="font-bold text-base" style={{ color: "var(--text)" }}>
                {weakTopics.length > 0 ? "⚠ Needs work" : "Practice a Topic"}
              </h2>
            </div>
            <button
              onClick={() => setShowTopics(!showTopics)}
              className="text-xs font-semibold transition-colors"
              style={{ color: "var(--accent2)" }}
            >
              {showTopics ? "Hide ↑" : "Browse all →"}
            </button>
          </div>

          {!showTopics && (
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
              {quickTopics.map((t) => (
                <Link
                  key={t.id}
                  href={`/practice/${t.id}`}
                  className="px-3 py-3 rounded-xl text-sm font-medium text-center transition-all duration-200 hover:scale-[1.02]"
                  style={{
                    background: t.isWeak ? "rgba(255,101,132,0.08)" : "var(--surface2)",
                    border: `1px solid ${t.isWeak ? "rgba(255,101,132,0.25)" : "var(--border)"}`,
                    color: t.isWeak ? "var(--neon2)" : "var(--text2)",
                  }}
                  onMouseOver={(e) => {
                    const el = e.currentTarget;
                    el.style.borderColor = t.isWeak ? "var(--neon2)" : "var(--accent)";
                    el.style.color = t.isWeak ? "var(--neon2)" : "var(--accent2)";
                    el.style.boxShadow = t.isWeak ? "0 0 12px rgba(255,101,132,0.2)" : "0 0 12px var(--glow)";
                  }}
                  onMouseOut={(e) => {
                    const el = e.currentTarget;
                    el.style.borderColor = t.isWeak ? "rgba(255,101,132,0.25)" : "var(--border)";
                    el.style.color = t.isWeak ? "var(--neon2)" : "var(--text2)";
                    el.style.boxShadow = "none";
                  }}
                >
                  {t.isWeak && <span className="mr-1 text-xs">⚠</span>}
                  {t.label}
                </Link>
              ))}
            </div>
          )}
          {showTopics && <TopicSelector />}
        </div>

        {/* ── Skill Vector Bars ── */}
        {skills.length > 0 && (
          <div className="card">
            <div className="section-tag"><span className="bar" />Skill Vector</div>
            <h2 className="font-bold mb-1" style={{ color: "var(--text)" }}>ELO per Concept</h2>
            <p className="text-xs mb-5" style={{ color: "var(--text3)" }}>Baseline: 1000 · Target: 1400</p>
            <div className="space-y-3">
              {skills.map((s) => (
                <SkillBar
                  key={s.concept}
                  label={s.concept.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase())}
                  skill={s.skill}
                />
              ))}
            </div>
          </div>
        )}

        {/* ── All practised topics grid ── */}
        {skills.length > 0 && (
          <div className="card">
            <h2 className="font-bold mb-4" style={{ color: "var(--text)" }}>All Practised Topics</h2>
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-2">
              {skills.map((s) => {
                const color = skillColor(s.skill);
                return (
                  <Link
                    key={s.concept}
                    href={`/practice/${s.concept}`}
                    className="px-3 py-2.5 rounded-xl text-sm transition-all duration-200 hover:scale-[1.02]"
                    style={{
                      background: "var(--surface2)",
                      border: `1px solid var(--border)`,
                      color: "var(--text)",
                    }}
                    onMouseOver={(e) => {
                      e.currentTarget.style.borderColor = color;
                      e.currentTarget.style.boxShadow = `0 0 12px ${color}33`;
                    }}
                    onMouseOut={(e) => {
                      e.currentTarget.style.borderColor = "var(--border)";
                      e.currentTarget.style.boxShadow = "none";
                    }}
                  >
                    <div className="font-medium truncate text-xs">
                      {s.concept.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase())}
                    </div>
                    <div className="flex items-center justify-between mt-1.5">
                      <span className="text-xs" style={{ color: "var(--text3)" }}>{skillLabel(s.skill)}</span>
                      <span className="text-xs font-mono font-bold" style={{ color }}>{Math.round(s.skill)}</span>
                    </div>
                  </Link>
                );
              })}
            </div>
          </div>
        )}

        {/* ── Recent Attempts ── */}
        {attempts.length > 0 && (
          <div className="card">
            <div className="section-tag"><span className="bar" />History</div>
            <h2 className="font-bold mb-4" style={{ color: "var(--text)" }}>Recent Attempts</h2>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr
                    className="text-xs border-b"
                    style={{ color: "var(--text3)", borderColor: "var(--border2)" }}
                  >
                    <th className="text-left pb-3 pr-4">Topic</th>
                    <th className="text-center pb-3 pr-4">Result</th>
                    <th className="text-center pb-3 pr-4">CMS</th>
                    <th className="text-right pb-3">When</th>
                  </tr>
                </thead>
                <tbody>
                  {attempts.map((a, i) => (
                    <tr
                      key={i}
                      className="transition-colors"
                      style={{ borderBottom: "1px solid var(--border2)" }}
                      onMouseOver={(e) => (e.currentTarget.style.background = "var(--surface2)")}
                      onMouseOut={(e) => (e.currentTarget.style.background = "transparent")}
                    >
                      <td className="py-2.5 pr-4" style={{ color: "var(--text2)" }}>
                        {a.concept.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase())}
                      </td>
                      <td className="py-2.5 pr-4 text-center">
                        {a.is_correct ? (
                          <span className="font-bold" style={{ color: "var(--neon3)" }}>✓</span>
                        ) : (
                          <span className="font-bold" style={{ color: "var(--neon2)" }}>✗</span>
                        )}
                      </td>
                      <td className="py-2.5 pr-4 text-center text-xs font-mono" style={{ color: "var(--text2)" }}>
                        {(a.cms * 100).toFixed(0)}%
                      </td>
                      <td className="py-2.5 text-right text-xs" style={{ color: "var(--text3)" }}>
                        {new Date(a.created_at).toLocaleDateString()}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </main>
    </div>
  );
}

function StatBox({
  label,
  value,
  color = "var(--accent2)",
}: {
  label: string;
  value: string;
  color?: string;
}) {
  return (
    <div>
      <div
        className="text-2xl font-extrabold"
        style={{ color, fontFamily: "'Google Sans Display', sans-serif" }}
      >
        {value}
      </div>
      <div className="text-xs mt-0.5" style={{ color: "var(--text3)" }}>{label}</div>
    </div>
  );
}
