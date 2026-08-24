"use client";

import { useEffect, useRef, useState } from "react";

const SCRAMBLE_CHARS = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789!@#$%&*";

/// Scramble-to-reveal text effect (reactbits.dev's DecryptedText pattern):
/// characters cycle through random glyphs and lock into the real text one
/// at a time, left to right, triggered when the element scrolls into view.
export function DecryptedText({
  text,
  className,
  as: Tag = "span",
}: {
  text: string;
  className?: string;
  as?: keyof React.JSX.IntrinsicElements;
}) {
  const ref = useRef<HTMLElement | null>(null);
  const [display, setDisplay] = useState(text.replace(/[^\s]/g, " "));
  const [triggered, setTriggered] = useState(false);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;

    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setTriggered(true);
          observer.disconnect();
        }
      },
      { threshold: 0.4 }
    );
    observer.observe(el);

    // Fallback so the heading can never get stuck permanently blank if the
    // observer doesn't fire for some reason.
    const fallback = setTimeout(() => setTriggered(true), 1500);

    return () => {
      observer.disconnect();
      clearTimeout(fallback);
    };
  }, []);

  useEffect(() => {
    if (!triggered) return;
    let frame = 0;
    const totalFrames = text.length * 3;
    const interval = setInterval(() => {
      frame += 1;
      const revealCount = Math.floor((frame / totalFrames) * text.length);
      const next = text
        .split("")
        .map((ch, i) => {
          if (ch === " ") return " ";
          if (i < revealCount) return ch;
          return SCRAMBLE_CHARS[Math.floor(Math.random() * SCRAMBLE_CHARS.length)];
        })
        .join("");
      setDisplay(next);
      if (revealCount >= text.length) {
        setDisplay(text);
        clearInterval(interval);
      }
    }, 30);
    return () => clearInterval(interval);
  }, [triggered, text]);

  return (
    // @ts-expect-error -- dynamic tag ref typing
    <Tag ref={ref} className={className}>
      {display}
    </Tag>
  );
}
