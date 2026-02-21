import type { Config } from 'tailwindcss'

const config: Config = {
  content: [
    './src/pages/**/*.{js,ts,jsx,tsx,mdx}',
    './src/components/**/*.{js,ts,jsx,tsx,mdx}',
    './src/app/**/*.{js,ts,jsx,tsx,mdx}',
  ],
  theme: {
    extend: {
      fontFamily: {
        sans: ['Google Sans', 'ui-sans-serif', 'system-ui', 'sans-serif'],
        display: ['Google Sans Display', 'ui-sans-serif', 'sans-serif'],
        mono: ['Google Sans Mono', 'ui-monospace', 'monospace'],
      },
      colors: {
        brand: {
          50:  '#f0eeff',
          100: '#e0d9ff',
          300: '#c4b5fd',
          400: '#a78bfa',
          500: '#7c6fff',
          600: '#6c63ff',
          700: '#5b4eff',
          900: '#1a1050',
        },
        neon: '#43e8d8',
        coral: '#ff6584',
        gold: '#fbbf24',
      },
      backgroundImage: {
        'gradient-accent': 'linear-gradient(135deg, #6c63ff, #a78bfa)',
        'gradient-teal': 'linear-gradient(135deg, #43e8d8, #6c63ff)',
      },
      boxShadow: {
        glow: '0 0 24px rgba(124,111,255,0.3)',
        'glow-lg': '0 0 50px rgba(124,111,255,0.35)',
        teal: '0 0 24px rgba(67,232,216,0.25)',
      },
      animation: {
        'float': 'float 6s ease-in-out infinite',
        'shimmer': 'shimmer 3s linear infinite',
      },
      keyframes: {
        float: {
          '0%,100%': { transform: 'translateY(0)' },
          '50%': { transform: 'translateY(-10px)' },
        },
        shimmer: {
          '0%': { backgroundPosition: '0% 50%' },
          '100%': { backgroundPosition: '200% 50%' },
        },
      },
    },
  },
  plugins: [],
}

export default config
