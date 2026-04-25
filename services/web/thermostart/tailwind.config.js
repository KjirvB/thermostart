/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    "./templates/v2/**/*.html",
    "./static/js/v2/**/*.js",
  ],
  // Block colour classes are picked from a string built at runtime
  // (`'ts-block-' + key`), so Tailwind cannot see them in the source.
  safelist: [
    "ts-block-home", "ts-block-not_home", "ts-block-comfort",
    "ts-block-anti_freeze", "ts-block-pause",
  ],
  theme: {
    extend: {
      colors: {
        ts: {
          bg: "#0f172a",
          surface: "#111827",
          card: "#1f2937",
          border: "#334155",
          accent: "#f97316",
          accent2: "#fb923c",
          good: "#10b981",
          warn: "#f59e0b",
          bad: "#ef4444",
          muted: "#94a3b8",
          home: "#10b981",
          not_home: "#3b82f6",
          comfort: "#f97316",
          anti_freeze: "#0ea5e9",
          pause: "#6b7280",
        },
      },
      fontFamily: {
        sans: ["Inter", "system-ui", "-apple-system", "Segoe UI", "Roboto", "sans-serif"],
      },
      gridTemplateColumns: {
        "week": "auto repeat(7, minmax(0, 1fr))",
      },
    },
  },
  plugins: [],
};
