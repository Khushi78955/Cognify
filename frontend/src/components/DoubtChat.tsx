"use client";
import { useState, useRef, useCallback, useEffect } from "react";
import { solveDoubt, DoubtResponse } from "@/lib/api";
import MathText from "@/components/MathText";

interface Props {
  userId: number;
}

export default function DoubtChat({ userId }: Props) {
  const [question, setQuestion] = useState("");
  const [result, setResult] = useState<DoubtResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  // Image state
  const [imagePreview, setImagePreview] = useState<string | null>(null);   // data URL for <img>
  const [imageBase64, setImageBase64] = useState<string | null>(null);     // pure base64
  const [imageMime, setImageMime] = useState<string>("image/jpeg");
  const fileInputRef = useRef<HTMLInputElement>(null);

  const loadImageFile = useCallback((file: File) => {
    const mime = file.type || "image/jpeg";
    const reader = new FileReader();
    reader.onload = (e) => {
      const dataUrl = e.target?.result as string;
      setImagePreview(dataUrl);
      // Strip data:<mime>;base64, prefix to get raw base64
      const b64 = dataUrl.split(",")[1];
      setImageBase64(b64);
      setImageMime(mime);
    };
    reader.readAsDataURL(file);
  }, []);

  // Global paste listener — catches Ctrl+V / Cmd+V anywhere on the page
  useEffect(() => {
    function onPaste(e: ClipboardEvent) {
      const items = e.clipboardData?.items;
      if (!items) return;
      for (const item of Array.from(items)) {
        if (item.type.startsWith("image/")) {
          const file = item.getAsFile();
          if (file) { loadImageFile(file); e.preventDefault(); }
          break;
        }
      }
    }
    document.addEventListener("paste", onPaste);
    return () => document.removeEventListener("paste", onPaste);
  }, [loadImageFile]);

  const clearImage = () => {
    setImagePreview(null);
    setImageBase64(null);
    setImageMime("image/jpeg");
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  const canSubmit = !loading && (!!question.trim() || !!imageBase64);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!canSubmit) return;
    setLoading(true);
    setError("");
    setResult(null);
    try {
      const res = await solveDoubt(
        userId,
        question.trim(),
        imageBase64 ?? undefined,
        imageMime,
      );
      setResult(res);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Failed to solve doubt");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="space-y-5">
      {/* Input form */}
      <form onSubmit={handleSubmit} className="space-y-4">

        {/* Image upload area */}
        <div className="space-y-1.5">
          <div className="flex items-center justify-between">
            <label className="text-xs font-semibold uppercase tracking-wider" style={{ color: "var(--text3)" }}>
              Question image{" "}
              <span className="normal-case font-normal" style={{ color: "rgba(255,255,255,0.2)" }}>
                (optional — paste or upload)
              </span>
            </label>
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              className="text-xs font-semibold transition-colors"
              style={{ color: "var(--accent2)" }}
            >
              + Upload
            </button>
          </div>
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            className="hidden"
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) loadImageFile(file);
            }}
          />
          {imagePreview ? (
            <div
              className="relative rounded-xl overflow-hidden"
              style={{ border: "1px solid var(--border)", background: "var(--surface2)" }}
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={imagePreview}
                alt="Question screenshot"
                className="w-full max-h-64 object-contain p-2"
              />
              <button
                type="button"
                onClick={clearImage}
                className="absolute top-2 right-2 w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold transition-colors"
                style={{
                  background: "var(--surface)",
                  border: "1px solid var(--border)",
                  color: "var(--text3)",
                }}
                title="Remove image"
              >
                ✕
              </button>
            </div>
          ) : (
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              className="w-full h-24 rounded-xl text-sm transition-all flex flex-col items-center justify-center gap-1.5"
              style={{
                border: "1px dashed var(--border)",
                background: "rgba(255,255,255,0.015)",
                color: "var(--text3)",
              }}
              onMouseOver={(e) => { (e.currentTarget as HTMLElement).style.borderColor = "var(--accent)"; }}
              onMouseOut={(e) => { (e.currentTarget as HTMLElement).style.borderColor = "var(--border)"; }}
            >
              <span className="text-xl">📷</span>
              <span>Click to upload or paste (Ctrl+V / ⌘V)</span>
            </button>
          )}
        </div>

        {/* Text question */}
        <div className="space-y-1.5">
          <label className="text-xs font-semibold uppercase tracking-wider" style={{ color: "var(--text3)" }}>
            {imageBase64 ? "Add context (optional)" : "Type your question"}
          </label>
          <textarea
            className="input resize-none h-24"
            placeholder={
              imageBase64
                ? "e.g. I'm stuck on part (b) specifically…"
                : "e.g. Find ∫ x·eˣ dx using integration by parts"
            }
            value={question}
            onChange={(e) => setQuestion(e.target.value)}
          />
        </div>

        <button type="submit" className="btn-primary w-full" disabled={!canSubmit}>
          {loading ? (
            <>
              <div className="w-4 h-4 border-2 rounded-full animate-spin" style={{ borderColor: "rgba(255,255,255,0.3)", borderTopColor: "white" }} />
              {imageBase64 ? "Reading image & solving…" : "Solving…"}
            </>
          ) : (
            "Solve with AI ✦"
          )}
        </button>
      </form>

      {error && (
        <div
          className="px-4 py-3 rounded-xl text-sm"
          style={{
            background: "rgba(255,101,132,0.08)",
            border: "1px solid rgba(255,101,132,0.25)",
            color: "var(--neon2)",
          }}
        >
          {error}
        </div>
      )}

      {/* Result */}
      {result && (
        <div className="space-y-4">
          <div className="card space-y-4">
            {/* Header */}
            <div className="flex items-center justify-between">
              <h3 className="font-semibold text-sm" style={{ color: "var(--text)" }}>
                Step-by-step solution
              </h3>
              <div className="flex items-center gap-2">
                {result.model_used === "aryabhata-1.0" ? (
                  <span
                    className="px-2 py-0.5 rounded-full text-xs font-bold"
                    style={{
                      background: "rgba(251,146,60,0.1)",
                      border: "1px solid rgba(251,146,60,0.25)",
                      color: "#fb923c",
                    }}
                  >
                    ⚡ Aryabhata 1.0
                  </span>
                ) : (
                  <span
                    className="px-2 py-0.5 rounded-full text-xs font-bold"
                    style={{
                      background: "rgba(124,111,255,0.1)",
                      border: "1px solid rgba(124,111,255,0.2)",
                      color: "var(--accent2)",
                    }}
                  >
                    ✦ Gemini
                  </span>
                )}
                {result.sympy_verified ? (
                  <span
                    className="px-2 py-0.5 rounded-full text-xs font-bold"
                    style={{
                      background: "rgba(67,232,216,0.08)",
                      border: "1px solid rgba(67,232,216,0.2)",
                      color: "var(--neon3)",
                    }}
                  >
                    ✓ Verified
                  </span>
                ) : (
                  <span
                    className="px-2 py-0.5 rounded-full text-xs"
                    style={{ background: "var(--surface2)", color: "var(--text3)" }}
                  >
                    Unverified
                  </span>
                )}
              </div>
            </div>

            {/* Steps */}
            <ol className="space-y-3">
              {result.steps.map((step, i) => (
                <li key={i} className="flex gap-3">
                  <span
                    className="flex-shrink-0 w-6 h-6 rounded-full text-xs font-bold flex items-center justify-center mt-0.5"
                    style={{
                      background: "rgba(124,111,255,0.1)",
                      border: "1px solid rgba(124,111,255,0.2)",
                      color: "var(--accent2)",
                    }}
                  >
                    {i + 1}
                  </span>
                  <p className="text-sm leading-relaxed" style={{ color: "var(--text2)" }}>
                    <MathText text={step} />
                  </p>
                </li>
              ))}
            </ol>

            {/* Final answer */}
            <div
              className="pt-3 mt-1 space-y-1"
              style={{ borderTop: "1px solid var(--border2)" }}
            >
              <p className="text-xs font-semibold uppercase tracking-wider" style={{ color: "var(--text3)" }}>
                Final Answer
              </p>
              <p className="font-semibold text-lg" style={{ color: "var(--neon3)" }}>
                <MathText text={result.final_answer} />
              </p>
            </div>
          </div>

          <button
            onClick={() => { setResult(null); setQuestion(""); clearImage(); }}
            className="btn-ghost w-full"
          >
            Ask another question
          </button>
        </div>
      )}
    </div>
  );
}
