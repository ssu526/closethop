/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        ink: "#24201d",
        linen: "#f6f1e8",
        paper: "#ffffff",
        clay: "#a8593b",
        sage: "#78806a",
        stone: "#d9d0c2"
      },
      fontFamily: {
        display: ["Instrument Sans", "Avenir Next", "Avenir", "Helvetica Neue", "ui-sans-serif", "system-ui", "sans-serif"],
        sans: ["Instrument Sans", "Avenir Next", "Avenir", "Helvetica Neue", "ui-sans-serif", "system-ui", "sans-serif"]
      },
      boxShadow: {
        card: "0 18px 50px rgba(55, 45, 36, 0.10)"
      }
    }
  },
  plugins: []
};
