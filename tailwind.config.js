/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        primary: {
          DEFAULT: '#6366F1',
          hover: '#4F46E5',
          light: '#EEF2FF',
        },
        bg: {
          main: '#F8FAFC',
          secondary: '#F1F5F9',
          sidebar: '#EBEDF3',
        },
        text: {
          main: '#1E293B',
          secondary: '#64748B',
          placeholder: '#94A3B8',
        },
        border: {
          DEFAULT: '#E2E8F0',
          input: '#CBD5E1',
        },
        success: '#10B981',
        warning: '#F59E0B',
        danger: '#EF4444',
      },
      fontFamily: {
        sans: ['Inter', 'Microsoft YaHei', 'PingFang SC', 'system-ui', 'sans-serif'],
      },
      fontSize: {
        'page-title': ['28px', { fontWeight: '600', letterSpacing: '-0.02em' }],
        'section-title': ['16px', { fontWeight: '500' }],
        'body': ['15px', { fontWeight: '400', lineHeight: '1.75' }],
        'caption': ['13px', { fontWeight: '400' }],
      },
      spacing: {
        'sidebar': '220px',
      },
      borderRadius: {
        'card': '12px',
        'btn': '10px',
      },
      boxShadow: {
        'card': '0 1px 3px rgba(0,0,0,0.04), 0 1px 2px rgba(0,0,0,0.03)',
        'card-hover': '0 4px 12px rgba(0,0,0,0.06), 0 2px 4px rgba(0,0,0,0.04)',
        'panel': '0 0 0 1px rgba(0,0,0,0.04), 0 2px 8px rgba(0,0,0,0.04)',
        'glow': '0 0 0 3px rgba(99,102,241,0.12)',
      },
      transitionDuration: {
        '200': '200ms',
      },
    },
  },
  plugins: [],
}
