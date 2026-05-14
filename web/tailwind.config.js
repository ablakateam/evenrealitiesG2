/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        // VOX dark palette — mirrors Even Hub's near-black + the G2 phosphor green
        bg: {
          DEFAULT: '#0a0b0d', // app background
          raised: '#121316', // cards / raised surfaces
          inset: '#1a1c20', // inputs / inset wells
        },
        line: {
          DEFAULT: '#26282d', // hairline borders
          strong: '#34373d',
        },
        ink: {
          DEFAULT: '#e8e9eb', // primary text
          muted: '#9aa0a6', // secondary text
          faint: '#5f646b', // tertiary / placeholders
        },
        phos: {
          // G2 phosphor green accent
          DEFAULT: '#39ff6a',
          dim: '#2bcc54',
          glow: 'rgba(57, 255, 106, 0.15)',
        },
        warn: '#ffb340',
        danger: '#ff5a5a',
      },
      fontFamily: {
        sans: ['Inter', 'system-ui', '-apple-system', 'sans-serif'],
        mono: ['"JetBrains Mono"', 'ui-monospace', 'SFMono-Regular', 'monospace'],
      },
      borderRadius: {
        card: '12px',
      },
      boxShadow: {
        glow: '0 0 0 1px rgba(57, 255, 106, 0.3), 0 0 24px rgba(57, 255, 106, 0.12)',
      },
    },
  },
  plugins: [],
};
