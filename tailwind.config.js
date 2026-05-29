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
          DEFAULT: '#4A90D9',
          hover: '#3A7BC8',
          light: '#EBF3FC',
        },
        bg: {
          main: '#FFFFFF',
          secondary: '#F8F9FA',
          sidebar: '#F0F1F3',
        },
        text: {
          main: '#1F2937',
          secondary: '#6B7280',
          placeholder: '#9CA3AF',
        },
        border: {
          DEFAULT: '#E5E7EB',
          input: '#D1D5DB',
        },
        success: '#10B981',
        warning: '#F59E0B',
        danger: '#EF4444',
      },
      fontFamily: {
        sans: ['Microsoft YaHei', 'PingFang SC', 'sans-serif'],
      },
      fontSize: {
        'page-title': ['24px', { fontWeight: '600' }],
        'section-title': ['18px', { fontWeight: '500' }],
        'body': ['15px', { fontWeight: '400' }],
        'caption': ['13px', { fontWeight: '400' }],
      },
      spacing: {
        'sidebar': '200px',
      },
      borderRadius: {
        'card': '8px',
        'btn': '6px',
      },
    },
  },
  plugins: [],
}
