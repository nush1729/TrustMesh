"use client";

import { useRef } from "react";

/// Bento-grid card with a mouse-tracking radial spotlight, in the spirit of
/// reactbits.dev's MagicBento — implemented with a CSS custom property
/// instead of three.js/WebGL so it stays dependency-light.
export function SpotlightCard({
  children,
  className = "",
}: {
  children: React.ReactNode;
  className?: string;
}) {
  const ref = useRef<HTMLDivElement>(null);

  function handleMouseMove(e: React.MouseEvent<HTMLDivElement>) {
    const el = ref.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    el.style.setProperty("--spot-x", `${e.clientX - rect.left}px`);
    el.style.setProperty("--spot-y", `${e.clientY - rect.top}px`);
  }

  return (
    <div
      ref={ref}
      onMouseMove={handleMouseMove}
      className={`group relative overflow-hidden rounded-xl border border-white/10 bg-ink-800 transition-colors hover:border-gold/40 ${className}`}
    >
      <div
        className="pointer-events-none absolute inset-0 opacity-0 transition-opacity duration-300 group-hover:opacity-100"
        style={{
          background:
            "radial-gradient(220px circle at var(--spot-x, 50%) var(--spot-y, 50%), rgba(245,197,24,0.12), transparent 70%)",
        }}
      />
      <div className="relative">{children}</div>
    </div>
  );
}
