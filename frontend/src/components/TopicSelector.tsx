"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { TOPICS, CATEGORIES, topicsByCategory } from "@/lib/topics";

const CATEGORY_ICONS: Record<string, string> = {
  "Sets & Functions": "𝒇",
  "Algebra": "𝑥²",
  "Matrices": "[ ]",
  "Trigonometry": "sin",
  "Coordinate Geometry": "📐",
  "Calculus": "∫",
  "Vectors & 3D": "→",
};

const CATEGORY_ACCENT: Record<string, { bg: string; border: string; color: string }> = {
  "Sets & Functions": { bg: "rgba(139,92,246,0.1)", border: "rgba(139,92,246,0.25)", color: "#a78bfa" },
  "Algebra":          { bg: "rgba(99,102,241,0.1)", border: "rgba(99,102,241,0.25)", color: "#818cf8" },
  "Matrices":         { bg: "rgba(6,182,212,0.1)",  border: "rgba(6,182,212,0.25)",  color: "#22d3ee" },
  "Trigonometry":     { bg: "rgba(16,185,129,0.1)", border: "rgba(16,185,129,0.25)", color: "#34d399" },
  "Coordinate Geometry": { bg: "rgba(251,191,36,0.1)", border: "rgba(251,191,36,0.2)", color: "#fbbf24" },
  "Calculus":         { bg: "rgba(168,85,247,0.1)", border: "rgba(168,85,247,0.25)", color: "#c084fc" },
  "Vectors & 3D":     { bg: "rgba(67,232,216,0.1)", border: "rgba(67,232,216,0.2)",  color: "#43e8d8" },
};

const DEFAULT_ACCENT = { bg: "rgba(124,111,255,0.1)", border: "rgba(124,111,255,0.2)", color: "var(--accent2)" };

export default function TopicSelector() {
  const router = useRouter();
  const [activeCategory, setActiveCategory] = useState<string | null>(null);

  function selectTopic(id: string) {
    router.push(`/practice/${id}`);
  }

  return (
    <div>
      <p className="text-xs mb-4" style={{ color: "var(--text3)" }}>
        Select a category then pick a topic to start adaptive practice
      </p>

      <div
        className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-px overflow-hidden rounded-xl"
        style={{ background: "var(--border2)", border: "1px solid var(--border2)" }}
      >
        {CATEGORIES.map((cat) => {
          const topics = topicsByCategory(cat);
          const isActive = activeCategory === cat;
          const accent = CATEGORY_ACCENT[cat] ?? DEFAULT_ACCENT;

          return (
            <div
              key={cat}
              className="overflow-hidden"
              style={{ background: "var(--surface)" }}
            >
              {/* Category header */}
              <button
                onClick={() => setActiveCategory(isActive ? null : cat)}
                className="w-full text-left p-4 transition-all duration-200 relative overflow-hidden"
                style={{
                  background: isActive ? accent.bg : "transparent",
                }}
                onMouseOver={(e) => { if (!isActive) e.currentTarget.style.background = `${accent.bg}80`; }}
                onMouseOut={(e) => { if (!isActive) e.currentTarget.style.background = "transparent"; }}
              >
                {/* Top accent bar on active */}
                {isActive && (
                  <div
                    className="absolute top-0 left-0 right-0 h-0.5"
                    style={{ background: `linear-gradient(90deg, ${accent.color}, transparent)` }}
                  />
                )}
                <div
                  className="inline-flex items-center justify-center w-10 h-10 rounded-xl text-xl mb-3"
                  style={{
                    background: accent.bg,
                    border: `1px solid ${accent.border}`,
                    color: accent.color,
                  }}
                >
                  {CATEGORY_ICONS[cat] ?? "📚"}
                </div>
                <div className="flex items-center justify-between">
                  <div>
                    <div className="font-semibold text-sm" style={{ color: "var(--text)" }}>{cat}</div>
                    <div className="text-xs mt-0.5" style={{ color: "var(--text3)" }}>{topics.length} topics</div>
                  </div>
                  <span
                    className="text-xs transition-transform duration-200"
                    style={{
                      color: accent.color,
                      transform: isActive ? "rotate(90deg)" : "rotate(0deg)",
                    }}
                  >
                    →
                  </span>
                </div>
              </button>

              {/* Topic list */}
              {isActive && (
                <div
                  className="border-t"
                  style={{ borderColor: accent.border }}
                >
                  {topics.map((t) => (
                    <button
                      key={t.id}
                      onClick={() => selectTopic(t.id)}
                      className="w-full text-left px-4 py-2.5 text-sm flex items-center justify-between transition-all duration-150 group"
                      style={{ color: "var(--text2)", borderBottom: "1px solid var(--border2)" }}
                      onMouseOver={(e) => {
                        e.currentTarget.style.background = accent.bg;
                        e.currentTarget.style.color = accent.color;
                      }}
                      onMouseOut={(e) => {
                        e.currentTarget.style.background = "transparent";
                        e.currentTarget.style.color = "var(--text2)";
                      }}
                    >
                      <span>{t.label}</span>
                      <span className="text-xs" style={{ color: "var(--text3)" }}>→</span>
                    </button>
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
