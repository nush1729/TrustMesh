"use client";

import { useEffect, useState } from "react";

/// Typewriter reveal, in the spirit of reactbits.dev's TextType — types out
/// `text`, leaves a blinking cursor. No external animation library needed
/// for this one; a plain interval is enough and keeps the bundle light.
export function TextType({
  text,
  className,
  speedMs = 35,
  startDelayMs = 200,
}: {
  text: string;
  className?: string;
  speedMs?: number;
  startDelayMs?: number;
}) {
  const [shown, setShown] = useState("");
  const [done, setDone] = useState(false);

  useEffect(() => {
    let i = 0;
    let interval: ReturnType<typeof setInterval>;
    const start = setTimeout(() => {
      interval = setInterval(() => {
        i += 1;
        setShown(text.slice(0, i));
        if (i >= text.length) {
          clearInterval(interval);
          setDone(true);
        }
      }, speedMs);
    }, startDelayMs);

    return () => {
      clearTimeout(start);
      clearInterval(interval);
    };
  }, [text, speedMs, startDelayMs]);

  return (
    <span className={className}>
      {shown}
      <span className={`inline-block w-[3px] translate-y-[2px] bg-current ${done ? "animate-blink" : ""}`}>
        &nbsp;
      </span>
    </span>
  );
}
