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
      // NativeWind keeps only the first name, and a weight class can't change
      // the face on iOS. AppText/AppTextInput pick the real face from the
      // classes (design.tsx, "Font faces"); these are only the fallback for
      // anything that isn't one of them. mono is Inter, not Courier.
      // Colors by role. Each is a CSS variable set at the app root by
      // ThemeProvider (src/components/theme.tsx), because the accent is the
      // user's choice and changes at runtime. Write `text-ink`, `bg-surface`,
      // `bg-accent`, never a hex literal. global.css holds first-paint values.
      colors: {
        canvas: 'rgb(var(--canvas) / <alpha-value>)',
        surface: 'rgb(var(--surface) / <alpha-value>)',
        'surface-2': 'rgb(var(--surface-2) / <alpha-value>)',
        fill: 'rgb(var(--fill) / <alpha-value>)',
        raised: 'rgb(var(--raised) / <alpha-value>)',
        line: 'rgb(var(--line) / <alpha-value>)',
        'line-strong': 'rgb(var(--line-strong) / <alpha-value>)',
        hairline: 'rgb(var(--hairline) / <alpha-value>)',
        ink: 'rgb(var(--ink) / <alpha-value>)',
        'ink-2': 'rgb(var(--ink-2) / <alpha-value>)',
        'ink-3': 'rgb(var(--ink-3) / <alpha-value>)',
        accent: 'rgb(var(--accent) / <alpha-value>)',
        'accent-soft': 'rgb(var(--accent-soft) / <alpha-value>)',
        'on-accent': 'rgb(var(--on-accent) / <alpha-value>)',
        success: 'rgb(var(--success) / <alpha-value>)',
        'success-soft': 'rgb(var(--success-soft) / <alpha-value>)',
        warning: 'rgb(var(--warning) / <alpha-value>)',
        'warning-soft': 'rgb(var(--warning-soft) / <alpha-value>)',
        danger: 'rgb(var(--danger) / <alpha-value>)',
        'danger-soft': 'rgb(var(--danger-soft) / <alpha-value>)',
        'stage-learning': 'rgb(var(--stage-learning) / <alpha-value>)',
        'stage-daily': 'rgb(var(--stage-daily) / <alpha-value>)',
        'stage-weekly': 'rgb(var(--stage-weekly) / <alpha-value>)',
        'stage-monthly': 'rgb(var(--stage-monthly) / <alpha-value>)',
      },
      // Corner radius by role: cards 14, buttons and inputs 12, segmented
      // control tray 9 with 7 on the selected segment inside it.
      borderRadius: {
        card: '14px',
        btn: '12px',
        seg: '9px',
        'seg-inner': '7px',
      },
      fontFamily: {
        sans: ['Inter_400Regular'],
        serif: ['Literata_400Regular'],
        mono: ['Inter_400Regular'],
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
