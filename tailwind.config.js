/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      colors: {
        juniper: {
          DEFAULT: '#9EEB47',
          dark: '#5A8F2E',
          darker: '#3D6B1A',
          light: 'rgba(158, 235, 71, 0.15)',
          glow: 'rgba(158, 235, 71, 0.6)',
        },
      },
    },
  },
  plugins: [],
};
