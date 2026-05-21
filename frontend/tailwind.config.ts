import type { Config } from "tailwindcss";

const config: Config = {
  content: [
    "./pages/**/*.{js,ts,jsx,tsx,mdx}",
    "./components/**/*.{js,ts,jsx,tsx,mdx}",
    "./app/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      colors: {
        background: "var(--background)",
        foreground: "var(--foreground)",
        parchment: "#f5f4ed",
        ivory: "#faf9f5",
        "warm-sand": "#e8e6dc",
        "warm-silver": "#b0aea5",
        "charcoal-warm": "#4d4c48",
        "olive-gray": "#5e5d59",
        "stone-gray": "#87867f",
        "dark-warm": "#3d3d3a",
        "dark-surface": "#30302e",
        "near-black": "#141413",
        "border-cream": "#f0eee6",
        "border-warm": "#e8e6dc",
        "ring-warm": "#d1cfc5",
        "ring-deep": "#c2c0b6",
        terracotta: {
          DEFAULT: "#c96442",
          soft: "#d97757",
        },
        "error-crimson": "#b53333",
        "focus-blue": "#3898ec",
        // Landing page (dark / "library at night") palette.
        bg: "#0a0805",
        "bg-2": "#0f0c09",
        card: "#16110c",
        "card-2": "#1a1410",
        text: "#ede4d3",
        "text-2": "#a89d8a",
        "text-3": "#766c5a",
        accent: "#c08552",
        "accent-2": "#d8a373",
        "accent-soft": "rgba(192,133,82,0.12)",
        border: "rgba(255,255,255,0.06)",
        "border-strong": "rgba(255,255,255,0.10)",
      },
      fontFamily: {
        serif: [
          "var(--font-serif)",
          "var(--font-arabic)",
          "Georgia",
          "serif",
        ],
        sans: [
          "var(--font-arabic)",
          "var(--font-manrope)",
          "system-ui",
          "sans-serif",
        ],
        mono: ["ui-monospace", "SFMono-Regular", "Menlo", "monospace"],
        fraunces: ["var(--font-fraunces)", "Georgia", "serif"],
        amiri: ["var(--font-amiri)", "var(--font-arabic)", "serif"],
        geist: ["var(--font-geist)", "var(--font-manrope)", "system-ui", "sans-serif"],
      },
      keyframes: {
        "cursor-blink": {
          "0%, 100%": { opacity: "1" },
          "50%": { opacity: "0" },
        },
      },
      animation: {
        "cursor-blink": "cursor-blink 1.1s ease-in-out infinite",
      },
      borderRadius: {
        sm: "4px",
        DEFAULT: "8px",
        md: "8px",
        lg: "12px",
        xl: "16px",
        "2xl": "24px",
        "3xl": "32px",
      },
      boxShadow: {
        "ring-warm": "0 0 0 1px #d1cfc5",
        "ring-deep": "0 0 0 1px #c2c0b6",
        "ring-cream": "0 0 0 1px #f0eee6",
        whisper: "0 4px 24px rgba(0,0,0,0.05)",
      },
    },
  },
  plugins: [],
};
export default config;
