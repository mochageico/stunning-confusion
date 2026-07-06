/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    './App.tsx',
    './index.ts',
    './src/**/*.{js,jsx,ts,tsx}',
  ],
  presets: [require('nativewind/preset')],
  theme: {
    extend: {
      fontFamily: {
        sans: ['Inter_400Regular', 'Inter_500Medium', 'Inter_600SemiBold', 'Inter_700Bold'],
        serif: ['PlayfairDisplay_400Regular', 'PlayfairDisplay_500Medium', 'PlayfairDisplay_600SemiBold', 'PlayfairDisplay_700Bold'],
      },
      keyframes: {
        fadeIn: {
          '0%': { opacity: 0, transform: [{ translateY: 4 }] },
          '100%': { opacity: 1, transform: [{ translateY: 0 }] },
        },
        fadeOut: {
          '0%': { opacity: 1, transform: [{ translateY: 0 }] },
          '100%': { opacity: 0, transform: [{ translateY: 4 }] },
        },
        listenWave: {
          '0%': { height: '10%' },
          '100%': { height: '100%' },
        },
      },
      animation: {
        'fade-in': 'fadeIn 0.25s cubic-bezier(0.16, 1, 0.3, 1) forwards',
        'fade-out': 'fadeOut 0.2s ease-out forwards',
        'listen-wave': 'listenWave 1s ease-in-out infinite alternate',
      },
    },
  },
  plugins: [],
};
