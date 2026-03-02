/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,jsx}'],
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        conectiva: {
          50: '#edf8ff',
          100: '#d6eeff',
          200: '#b5e3ff',
          300: '#83d3ff',
          400: '#48b9ff',
          500: '#0693e3',   // Cor principal da marca
          600: '#0080d4',
          700: '#0066ab',
          800: '#00568d',
          900: '#064874',
          950: '#042d4d',
        },
      },
    },
  },
  plugins: [],
};
