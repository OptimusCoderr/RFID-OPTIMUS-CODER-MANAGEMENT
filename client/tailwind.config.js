/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{js,ts,jsx,tsx}"],
  darkMode: "class",
  theme: {
    extend: {
      colors: {
        // Terminal/matrix green — the app's single brand color, used for
        // every primary action, link, focus ring, and active nav state.
        brand: {
          50: "#f0fdf4",
          100: "#dcfce7",
          200: "#bbf7d0",
          300: "#86efac",
          400: "#4ade80",
          500: "#22c55e",
          600: "#16a34a",
          700: "#15803d",
          800: "#166534",
          900: "#14532d",
          950: "#052e16",
        },
        // Near-black, faintly green-tinted surfaces for dark mode — used
        // instead of Tailwind's slate scale wherever a surface (not just an
        // accent) needs to read as "black," per the cryptographic-terminal
        // look. Secondary chrome (dividers, muted text) still uses slate;
        // this is only for the handful of large background surfaces.
        ink: {
          800: "#141b17",
          900: "#0c100e",
          950: "#070907",
        },
      },
      fontFamily: {
        mono: [
          "JetBrains Mono",
          "ui-monospace",
          "SFMono-Regular",
          "Menlo",
          "Consolas",
          "Liberation Mono",
          "monospace",
        ],
      },
      boxShadow: {
        glow: "0 0 0 1px rgba(34, 197, 94, 0.15), 0 0 24px -8px rgba(34, 197, 94, 0.35)",
      },
      backgroundImage: {
        "grid-light": "linear-gradient(rgba(20, 83, 45, 0.05) 1px, transparent 1px), linear-gradient(90deg, rgba(20, 83, 45, 0.05) 1px, transparent 1px)",
        "grid-dark": "linear-gradient(rgba(34, 197, 94, 0.07) 1px, transparent 1px), linear-gradient(90deg, rgba(34, 197, 94, 0.07) 1px, transparent 1px)",
      },
      backgroundSize: {
        grid: "28px 28px",
      },
    },
  },
  plugins: [],
};
