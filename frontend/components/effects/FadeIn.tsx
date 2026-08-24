"use client";

import { useEffect, useRef, useState } from "react";

/// Scroll-triggered fade-up reveal, applied to whole sections/cards.
export function FadeIn({
  children,
  className = "",
  delayMs = 0,
}: {
  children: React.ReactNode;
  className?: string;
  delayMs?: number;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;

    const reveal = () => setTimeout(() => setVisible(true), delayMs);

    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          reveal();
          observer.disconnect();
        }
      },
      { threshold: 0.15 }
    );
    observer.observe(el);

    // Fallback: if the observer never fires (e.g. element already in the
    // initial viewport on some devices, or an environment quirk), don't
    // leave the content permanently invisible.
    const fallback = setTimeout(reveal, 1500);

    return () => {
      observer.disconnect();
      clearTimeout(fallback);
    };
  }, [delayMs]);

  return (
    <div ref={ref} className={`${visible ? "animate-fadeUp" : "opacity-0"} ${className}`}>
      {children}
    </div>
  );
}
