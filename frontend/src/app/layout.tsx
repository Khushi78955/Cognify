import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Cognify — Adaptive JEE Maths",
  description: "AI-powered adaptive learning for JEE Mathematics",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" data-theme="dark">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link
          href="https://fonts.googleapis.com/css2?family=Google+Sans:wght@400;500;600;700&family=Google+Sans+Display:wght@400;700&family=Google+Sans+Mono&display=swap"
          rel="stylesheet"
        />
      </head>
      <body className="min-h-screen">
        <div className="noise-overlay" aria-hidden />
        <div className="orb-bg orb-bg-1" aria-hidden />
        <div className="orb-bg orb-bg-2" aria-hidden />
        <div className="relative z-10">{children}</div>
      </body>
    </html>
  );
}
