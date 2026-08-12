/** @type {import('tailwindcss').Config} */
//
// Signal Desk design tokens (design.md §3, §4).
// Phase 0: only the colour palette + font families are wired. Component-level
// design (rows, panels, status track, etc.) lands in later phases.
//
export default {
  content: ['./index.html', './src/**/*.{js,jsx}'],
  theme: {
    extend: {
      colors: {
        // Surfaces
        paper: '#F4F1EA',          // --bg
        surface: '#FBFAF6',        // --surface
        'surface-strong': '#FFFFFF',
        ink: '#171717',            // --ink
        'ink-muted': '#68645D',    // --ink-muted
        line: '#D8D3C8',           // --line
        'line-strong': '#AFA99D',  // --line-strong

        // Accents
        accent: '#E4572E',         // --accent
        'accent-soft': '#F6D8CE',  // --accent-soft

        // Status / semantic
        success: '#2E6B4E',
        'success-soft': '#DCEBE1',
        warning: '#9A6718',
        'warning-soft': '#F1E4C8',
        danger: '#A33A32',
        'danger-soft': '#F0D8D5',
        low: '#77736B',            // --low (priority low)
      },
      fontFamily: {
        sans: ['Inter', 'ui-sans-serif', 'system-ui', 'sans-serif'],
        mono: ['"IBM Plex Mono"', 'ui-monospace', 'SFMono-Regular', 'Menlo', 'monospace'],
      },
      fontSize: {
        // Type scale (design.md §4)
        display: ['32px', { lineHeight: '38px', fontWeight: '700' }],
        title: ['24px', { lineHeight: '30px', fontWeight: '700' }],
        section: ['16px', { lineHeight: '22px', fontWeight: '700' }],
        body: ['14px', { lineHeight: '21px', fontWeight: '400' }],
        small: ['12px', { lineHeight: '17px', fontWeight: '500' }],
        micro: ['11px', { lineHeight: '14px', fontWeight: '600' }],
      },
    },
  },
  plugins: [],
};
