/** @type {import('tailwindcss').Config} */
export default {
  content: ['./src/**/*.{astro,html,js,jsx,md,mdx,svelte,ts,tsx,vue}'],
  theme: {
    extend: {
      colors: {
        // Brand kolorów z obecnej strony freshmarket.eu (zielony)
        brand: {
          50:  '#f1f8f1',
          100: '#dceedb',
          200: '#bbddb9',
          300: '#92c590',
          400: '#6daa6a',
          500: '#4f8e4d',
          600: '#3a703a',
          700: '#2d5a2e', // główny zielony
          800: '#264a26',
          900: '#1f3c20',
        },
        accent: {
          // Pomarańczowy CTA "Register now"
          500: '#e57e25',
          600: '#d36a14',
        },
      },
      fontFamily: {
        sans: ['Inter', 'system-ui', 'sans-serif'],
        display: ['"Plus Jakarta Sans"', 'Inter', 'sans-serif'],
      },
    },
  },
  plugins: [],
};
