module.exports = {
  root: true,
  parser: '@typescript-eslint/parser',
  parserOptions: { ecmaVersion: 2022, sourceType: 'module' },
  plugins: ['@typescript-eslint'],
  extends: ['eslint:recommended', 'plugin:@typescript-eslint/recommended', 'plugin:prettier/recommended'],
  env: { node: true, jest: true },
  ignorePatterns: ['dist/', 'node_modules/', 'coverage/', '.eslintrc.js'],
  rules: {
    '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
  },
  overrides: [
    {
      // DESIGN 6.1: repository ที่ inject มาใช้ connection หลัก — เรียกในทรานแซกชันแล้วหลุดออกนอกทรานแซกชันโดยไม่มี error
      // ไฟล์นี้เปลี่ยนสถานะทุกครั้งในทรานแซกชัน จึงห้ามแตะ this.*Repo ทั้งไฟล์ ต้องใช้ manager.getRepository() เท่านั้น
      files: ['src/modules/tickets/ticket-workflow.service.ts'],
      rules: {
        'no-restricted-syntax': [
          'error',
          {
            selector: "MemberExpression[object.type='ThisExpression'][property.name=/Repo(sitory)?$/]",
            message: 'ในทรานแซกชันใช้ manager.getRepository() เท่านั้น ห้ามใช้ repository ที่ inject มา (DESIGN 6.1)',
          },
        ],
      },
    },
  ],
};
