import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // Os testes de `e2e/` são do Playwright e importam `@playwright/test`;
    // executá-los sob o Vitest falharia na importação. Cada corredor tem o seu
    // diretório.
    include: ['{app,componentes,lib}/**/*.spec.ts'],
  },
  resolve: {
    alias: { '@': new URL('.', import.meta.url).pathname },
  },
});
