"use client";
import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { register } from "@/lib/api";
import { saveUser } from "@/lib/auth";

export default function RegisterPage() {
  const router = useRouter();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setLoading(true);
    try {
      const user = await register(name, email, password);
      saveUser(user);
      router.push("/dashboard");
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Registration failed");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center px-4 py-12">
      <div className="w-full max-w-md">
        {/* Logo */}
        <div className="text-center mb-10">
          <h1
            className="text-5xl font-bold tracking-tight mb-1"
            style={{
              fontFamily: "'Google Sans Display', sans-serif",
              background: "linear-gradient(135deg, var(--accent2), var(--neon3))",
              WebkitBackgroundClip: "text",
              WebkitTextFillColor: "transparent",
            }}
          >
            Cognify
          </h1>
          <p className="text-sm" style={{ color: "var(--text2)" }}>
            Adaptive JEE Mathematics
          </p>
        </div>

        <div className="card" style={{ padding: "36px" }}>
          <h2 className="text-xl font-bold mb-1" style={{ color: "var(--text)" }}>Create account</h2>
          <p className="text-sm mb-6" style={{ color: "var(--text2)" }}>Start adaptive practice in under 30 seconds.</p>

          {error && (
            <div
              className="mb-5 px-4 py-3 rounded-xl text-sm"
              style={{
                background: "rgba(255,101,132,0.08)",
                border: "1px solid rgba(255,101,132,0.25)",
                color: "var(--neon2)",
              }}
            >
              {error}
            </div>
          )}

          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label
                className="block text-xs font-semibold mb-2 uppercase tracking-wider"
                style={{ color: "var(--text2)" }}
              >
                Full name
              </label>
              <input
                className="input"
                type="text"
                placeholder="Arjun Sharma"
                value={name}
                onChange={(e) => setName(e.target.value)}
                required
              />
            </div>
            <div>
              <label
                className="block text-xs font-semibold mb-2 uppercase tracking-wider"
                style={{ color: "var(--text2)" }}
              >
                Email
              </label>
              <input
                className="input"
                type="email"
                placeholder="you@example.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
              />
            </div>
            <div>
              <label
                className="block text-xs font-semibold mb-2 uppercase tracking-wider"
                style={{ color: "var(--text2)" }}
              >
                Password
              </label>
              <input
                className="input"
                type="password"
                placeholder="••••••••"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                minLength={6}
              />
            </div>
            <button type="submit" className="btn-primary w-full mt-2" disabled={loading}>
              {loading ? (
                <>
                  <div className="w-4 h-4 rounded-full border-2 border-white/30 border-t-white animate-spin" />
                  Creating account…
                </>
              ) : (
                "Create Account →"
              )}
            </button>
          </form>

          <div
            className="flex items-center gap-3 my-5"
            style={{ color: "var(--text3)", fontSize: "12px" }}
          >
            <div className="flex-1 h-px" style={{ background: "var(--border)" }} />
            or
            <div className="flex-1 h-px" style={{ background: "var(--border)" }} />
          </div>

          <p className="text-center text-sm" style={{ color: "var(--text2)" }}>
            Have an account?{" "}
            <Link href="/login" className="font-semibold" style={{ color: "var(--accent2)" }}>
              Sign in
            </Link>
          </p>
        </div>

        {/* Trust grid */}
        <div className="grid grid-cols-2 gap-2 mt-4">
          {[
            { icon: "\uD83C\uDD13", label: "Always free to use" },
            { icon: "⚡", label: "Questions generated in real-time" },
            { icon: "🔒", label: "Your data stays private" },
            { icon: "📱", label: "Works on any device" },
          ].map((t) => (
            <div
              key={t.label}
              className="flex items-center gap-2 px-3 py-2.5 rounded-xl text-sm font-medium"
              style={{
                background: "var(--surface2)",
                border: "1px solid var(--border2)",
                color: "var(--text2)",
              }}
            >
              <span>{t.icon}</span>
              <span className="text-xs">{t.label}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
