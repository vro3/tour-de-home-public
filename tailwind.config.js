/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        background: '#090b10',
        card: '#121620',
        cardBorder: '#1e2638',
        neonCyan: '#00f0ff',
        neonGreen: '#00ff88',
        neonOrange: '#ff9900',
        neonRed: '#ff3344',
      },
      fontFamily: {
        mono: ['ui-monospace', 'SFMono-Regular', 'Menlo', 'Monaco', 'Consolas', 'monospace'],
      }
    },
  },
  plugins: [],
}
