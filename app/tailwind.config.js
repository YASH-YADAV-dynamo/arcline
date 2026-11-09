/** @type {import('tailwindcss').Config} */
// Colors are CSS variables (src/index.css) so light/dark switch with one class on <html>.
const v = (name) => `rgb(var(--${name}) / <alpha-value>)`
export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        bg: v('bg'), panel: v('panel'), panel2: v('panel2'), line: v('line'),
        ink: v('ink'), muted: v('muted'), faint: v('faint'),
        accent: v('accent'), up: v('up'), down: v('down'), warn: v('warn'), onaccent: v('onaccent'),
      },
      fontFamily: { sans: ['Geist', 'system-ui', 'sans-serif'], mono: ['"Geist Mono"', 'ui-monospace', 'monospace'] },
      // One motion curve for the whole app: weighted, decelerating into place. Plain `transition`
      // picks it up, so no element ships a browser default curve.
      transitionTimingFunction: { DEFAULT: 'cubic-bezier(0.22, 1, 0.36, 1)', base: 'cubic-bezier(0.22, 1, 0.36, 1)' },
      transitionDuration: { DEFAULT: '200ms' },
    },
  },
  plugins: [],
}
