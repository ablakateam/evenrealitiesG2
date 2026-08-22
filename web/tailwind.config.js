/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  darkMode: 'class',
  theme: {
    extend: {
      screens: {
        // Explicit mobile-first ladder. `xs` catches the iPhone SE / mini
        // class (320-374px) where two-up grids stop fitting.
        xs: '375px',
      },
      spacing: {
        // Safe-area insets as first-class spacing tokens so components can
        // say `pt-safe-top` instead of hand-rolling env() in a style attr.
        'safe-top': 'env(safe-area-inset-top, 0px)',
        'safe-bottom': 'env(safe-area-inset-bottom, 0px)',
        'safe-left': 'env(safe-area-inset-left, 0px)',
        'safe-right': 'env(safe-area-inset-right, 0px)',
        // Minimum comfortable touch target (Apple HIG).
        touch: '44px',
      },
      minHeight: { touch: '44px' },
      minWidth: { touch: '44px' },
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
        // Three roles, deliberately distinct.
        //   display — Martian Mono. Wide and engineered; carries titles,
        //             eyebrows and stat values. Used sparingly.
        //   mono    — JetBrains Mono. Every label, number and status string.
        //   sans    — Inter. Prose only, where monospace hurts reading.
        display: ['"Martian Mono"', 'ui-monospace', 'monospace'],
        mono: ['"JetBrains Mono"', 'ui-monospace', 'SFMono-Regular', 'monospace'],
        sans: ['Inter', 'system-ui', '-apple-system', 'sans-serif'],
      },
      keyframes: {
        // The signature: a phosphor trace travelling a card's outline, the
        // same gesture the glasses use for a live voice trace.
        trace: { to: { '--trace-angle': '360deg' } },
        // Cards settle in on load rather than appearing all at once.
        rise: {
          from: { opacity: '0', transform: 'translateY(6px)' },
          to: { opacity: '1', transform: 'translateY(0)' },
        },
        // A status dot that means "live" should look alive.
        breathe: {
          '0%, 100%': { opacity: '1', boxShadow: '0 0 0 0 rgba(57,255,106,.45)' },
          '50%': { opacity: '.72', boxShadow: '0 0 0 4px rgba(57,255,106,0)' },
        },
        // Caret for the "console" prompt in the sidebar.
        blink: { '0%, 45%': { opacity: '1' }, '55%, 100%': { opacity: '0' } },
      },
      animation: {
        trace: 'trace 4s linear infinite',
        rise: 'rise .38s cubic-bezier(.22,.8,.3,1) both',
        breathe: 'breathe 2.4s ease-in-out infinite',
        blink: 'blink 1.15s steps(1) infinite',
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
