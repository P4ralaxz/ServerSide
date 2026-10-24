// lint ของหน้าเว็บ — ใช้ parser/plugin ชุดเดียวกับ backend (ติดตั้งที่ root)
module.exports = {
  root: true,
  parser: '@typescript-eslint/parser',
  parserOptions: { ecmaVersion: 2022, sourceType: 'module', ecmaFeatures: { jsx: true } },
  plugins: ['@typescript-eslint'],
  extends: ['eslint:recommended', 'plugin:@typescript-eslint/recommended', 'plugin:prettier/recommended'],
  env: { browser: true, es2022: true },
  ignorePatterns: [
    'dist/',
    'node_modules/',
    'test-results/',
    'playwright-report/',
    '.eslintrc.cjs',
    'src/api/schema.gen.ts',
  ],
  rules: {
    '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
  },
  overrides: [
    {
      // UI-PLAN 2 ข้อ 1: หน้าจอไม่มีกฎทางธุรกิจ — ปุ่มมาจาก actions / can_report ที่ API ส่งมาเท่านั้น
      // การแปลงสถานะเป็นข้อความ สี และกลุ่ม อยู่ที่ ui/status.ts ที่เดียว · role ใช้เลือกหน้าแรกใน routes.tsx เท่านั้น
      // ถ้า pages/ เทียบ .status / .role เอง วันหนึ่งหน้าจอจะโชว์ปุ่มที่ API ตอบ 403/409
      files: ['src/pages/**/*.{ts,tsx}'],
      rules: {
        'no-restricted-syntax': [
          'error',
          // ครอบทั้ง t.status === … และ me?.role === … (optional chain ห่อด้วย ChainExpression)
          ...[
            'BinaryExpression[operator=/^[!=]==?$/] > MemberExpression[property.name=/^(status|role)$/]',
            'BinaryExpression[operator=/^[!=]==?$/] > ChainExpression > MemberExpression[property.name=/^(status|role)$/]',
          ].map((selector) => ({
            selector,
            message:
              'ห้ามเทียบ .status / .role ใน pages/ — ใช้ actions จาก API หรือฟังก์ชันใน ui/status.ts (UI-PLAN 2 ข้อ 1)',
          })),
          ...[
            'SwitchStatement > MemberExpression.discriminant[property.name=/^(status|role)$/]',
            'SwitchStatement > ChainExpression.discriminant > MemberExpression[property.name=/^(status|role)$/]',
          ].map((selector) => ({
            selector,
            message: 'ห้าม switch ตาม .status / .role ใน pages/ — ใช้ฟังก์ชันใน ui/status.ts (UI-PLAN 2 ข้อ 1)',
          })),
        ],
      },
    },
    {
      files: ['e2e/**/*.ts', 'playwright.config.ts', 'vite.config.ts'],
      env: { node: true, browser: false },
    },
  ],
};
