/** @type {import('tailwindcss').Config} */
export default {
  darkMode: 'class',
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        ink: {
          950: '#0d0c0a',
          900: '#141310',
          800: '#1c1a16',
          700: '#26231d',
          600: '#332f27',
        },
        cream: {
          50: '#fbf8f1',
          100: '#f4efe3',
          200: '#e6dfcd',
          300: '#cfc6ae',
        },
        saffron: {
          300: '#f7cf8a',
          400: '#f0b757',
          500: '#e39c2a',
          600: '#c07d18',
          700: '#9a6212',
        },
      },
      fontFamily: {
        display: ['"Playfair Display"', 'Georgia', 'serif'],
        sans: ['"DM Sans"', 'system-ui', '-apple-system', 'sans-serif'],
      },
      boxShadow: {
        soft: '0 18px 44px -24px rgba(0,0,0,0.55)',
        lift: '0 24px 60px -28px rgba(0,0,0,0.6)',
      },
      borderRadius: { xl: '0.9rem', '2xl': '1.25rem' },
    },
  },
  plugins: [],
};
