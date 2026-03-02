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
          500: '#0693e3',   // Azul principal da marca
          600: '#0080d4',
          700: '#0066ab',
          800: '#00568d',
          900: '#064874',
          950: '#042d4d',
        },
        dourado: {
          50: '#fffbeb',
          100: '#fef3c7',
          200: '#fde68a',
          300: '#fcd34d',
          400: '#fcb900',   // Amarelo/dourado da marca
          500: '#eab308',
          600: '#ca8a04',
          700: '#a16207',
          800: '#854d0e',
          900: '#713f12',
          950: '#422006',
        },
      },
    },
  },
  plugins: [],
};
