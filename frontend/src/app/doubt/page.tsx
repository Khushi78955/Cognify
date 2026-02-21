"use client";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { getUser } from "@/lib/auth";
import DoubtChat from "@/components/DoubtChat";

export default function DoubtPage() {
  const router = useRouter();
  const [userId, setUserId] = useState<number | null>(null);

  useEffect(() => {
    const user = getUser();
    if (!user) { router.push("/login"); return; }
    setUserId(user.user_id);
  }, [router]);

  if (!userId) return null;

  return (
    <div className="min-h-screen p-4">
      {/* Nav */}
      <div className="max-w-2xl mx-auto mb-6">
        <div className="nav-glass flex items-center justify-between px-5 py-3">
          <Link
            href="/dashboard"
            className="text-sm font-medium transition-colors"
            style={{ color: "var(--text2)" }}
          >
            ← Dashboard
          </Link>
          <div className="flex items-center gap-2">
            <span
              className="text-lg font-bold"
              style={{
                fontFamily: "'Google Sans Display', sans-serif",
                background: "linear-gradient(135deg, var(--accent2), var(--neon3))",
                WebkitBackgroundClip: "text",
                WebkitTextFillColor: "transparent",
              }}
            >
              ✶ Doubt Solver
            </span>
            <span className="badge-teal badge">Gemini + SymPy</span>
          </div>
          <div className="w-24" />
        </div>
      </div>

      <div className="max-w-2xl mx-auto">
        {/* Intro card */}
        <div
          className="rounded-xl px-5 py-4 mb-4 flex items-start gap-3"
          style={{
            background: "rgba(67,232,216,0.05)",
            border: "1px solid rgba(67,232,216,0.15)",
          }}
        >
          <span className="text-2xl">🧠</span>
          <div>
            <p className="font-semibold text-sm" style={{ color: "var(--neon3)" }}>AI-Powered Step-by-Step Solutions</p>
            <p className="text-xs mt-0.5" style={{ color: "var(--text2)" }}>
              Describe any JEE Maths problem. Gemini solves it step-by-step, SymPy verifies the answer.
            </p>
          </div>
        </div>

        <div className="card">
          <DoubtChat userId={userId} />
        </div>
      </div>
    </div>
  );
}
