/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      // ========== 颜色（三级区域 + 语义状态色） ==========
      colors: {
        primary: {
          DEFAULT: '#6366F1',
          hover: '#4F46E5',
          light: '#EEF2FF',
        },
        bg: {
          main: '#F8FAFC',      // 页面底色（左菜单/右面板）
          secondary: '#F1F5F9', // 辅助区底色
          sidebar: '#EBEDF3',   // 左菜单底色（最暗）
          surface: '#FFFFFF',   // 卡片/编辑器白底（仅中央区用）
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
      // ========== 字号（6级语义化） ==========
      // 区域规则：
      //   左菜单 = text-sm (13px)
      //   右面板 = text-xs (12px), 徽章 text-xxs (10px)
      //   中央编辑器 = text-base (15px)
      //   对话框/表单 = text-sm (13px)
      fontSize: {
        'xxs':  ['10px', { lineHeight: '14px' }],           // 徽章/极小标签
        'xs':   ['12px', { lineHeight: '18px' }],            // 正文辅助/列表项
        'sm':   ['13px', { lineHeight: '20px' }],            // 说明文字/提示
        'base': ['15px', { lineHeight: '1.75', fontWeight: '400' }], // 正文阅读
        'lg':   ['18px', { lineHeight: '28px', fontWeight: '500' }], // 区块标题
        'xl':   ['28px', { lineHeight: '36px', fontWeight: '600', letterSpacing: '-0.02em' }], // 页面标题
      },
      // ========== 间距（4pt 网格） ==========
      // 值: 4/8/12/16/20/24/32 = tailwind scale 1/2/3/4/5/6/8
      // 右面板 = gap-1.5(6px, 紧凑)
      // 编辑器 = gap-4(16px, 舒适)
      // 左菜单 = gap-3(12px, 宽松)
      spacing: {
        'sidebar': '140px',
        'sidebar-collapsed': '48px',
      },
      // ========== 圆角（3档） ==========
      borderRadius: {
        'sm': '6px',    // 输入框/小控件
        'card': '12px',  // 卡片
        'btn': '10px',   // 按钮/标签
      },
      // ========== 阴影（2档） ==========
      boxShadow: {
        'card': '0 1px 3px rgba(0,0,0,0.04), 0 1px 2px rgba(0,0,0,0.03)',
        'glow': '0 0 0 3px rgba(99,102,241,0.12)',
      },
      // ========== 字体 ==========
      fontFamily: {
        sans: ['Inter', 'Microsoft YaHei', 'PingFang SC', 'system-ui', 'sans-serif'],
      },
      // ========== 动效 ==========
      transitionDuration: {
        'DEFAULT': '150ms',
      },
    },
  },
  plugins: [],
}
