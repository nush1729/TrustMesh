import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./app/**/*.{ts,tsx}", "./components/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        gold: {
          DEFAULT: "#F5C518",
          soft: "#FFE082",
          dim: "#8a6d10",
        },
        ink: {
          950: "#000000",
          900: "#0a0a0a",
          800: "#111113",
          700: "#19191c",
          600: "#232326",
        },
        mist: "#9a9a9f",
      },
      backgroundImage: {
        "glow-gold": "radial-gradient(650px circle at 20% 0%, rgba(245,197,24,0.16), transparent 60%)",
        "glow-gold-soft": "radial-gradient(500px circle at 80% 100%, rgba(245,197,24,0.08), transparent 60%)",
      },
      keyframes: {
        blink: {
          "0%, 49%": { opacity: "1" },
          "50%, 100%": { opacity: "0" },
        },
        fadeUp: {
          "0%": { opacity: "0", transform: "translateY(12px)" },
          "100%": { opacity: "1", transform: "translateY(0)" },
        },
      },
      animation: {
        blink: "blink 1s step-start infinite",
        fadeUp: "fadeUp 0.6s ease-out forwards",
      },
    },
  },
  plugins: [],
};

export default config;
