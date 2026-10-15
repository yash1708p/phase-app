/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        cream: { DEFAULT: '#FFF8F2', 100: '#FFFBF7', 200: '#FBEFE6' },
        blush: { 100: '#FDEDEC', 200: '#F9D9D7', 300: '#F3BDBA' },
        rose: { 300: '#EBA0A4', 400: '#E07A7F', 500: '#CC5E66', 600: '#A9434D', 700: '#86323B' },
        peach: { 100: '#FEF0E6', 200: '#FBDCC8', 300: '#F7C6A8', 400: '#EFA57D' },
        sage: { 100: '#E9F4EF', 200: '#CFE8DF', 400: '#7FB8A4', 600: '#4E8A75' },
        lilac: { 100: '#F1ECF8', 200: '#E0D5F0', 500: '#8D74B8' },
        ink: { DEFAULT: '#3D2C2E', soft: '#6E5A5C', faint: '#A8979A' },
      },
      fontFamily: {
        display: ['Fraunces', 'Georgia', 'serif'],
        sans: ['"DM Sans"', 'system-ui', '-apple-system', 'Segoe UI', 'Roboto', 'sans-serif'],
      },
      boxShadow: {
        soft: '0 1px 2px rgba(61,44,46,0.04), 0 8px 24px -8px rgba(169,67,77,0.14)',
        lift: '0 12px 32px -10px rgba(169,67,77,0.28)',
      },
      keyframes: {
        'fade-up': { from: { opacity: '0', transform: 'translateY(8px)' }, to: { opacity: '1', transform: 'none' } },
        'sheet-up': { from: { transform: 'translateY(100%)' }, to: { transform: 'none' } },
        pop: { '0%': { transform: 'scale(1)' }, '45%': { transform: 'scale(0.92)' }, '100%': { transform: 'scale(1)' } },
        shake: { '0%,100%': { transform: 'none' }, '25%': { transform: 'translateX(-6px)' }, '75%': { transform: 'translateX(6px)' } },
        breathe: { '0%,100%': { opacity: '0.55' }, '50%': { opacity: '1' } },
      },
      animation: {
        'fade-up': 'fade-up 0.35s ease-out both',
        'sheet-up': 'sheet-up 0.32s cubic-bezier(0.22, 1, 0.36, 1) both',
        pop: 'pop 0.22s ease-out',
        shake: 'shake 0.3s ease-in-out',
        breathe: 'breathe 1.6s ease-in-out infinite',
      },
    },
  },
  plugins: [],
};
