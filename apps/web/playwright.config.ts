import { defineConfig, devices } from '@playwright/test';

/**
 * Configuração do E2E.
 *
 * Dois perfis de dispositivo de propósito: o coordenador usa desktop, o
 * entrevistador usa celular em campo — e o formulário de campo se comporta
 * diferente nos dois. Testar só em desktop deixaria de fora exatamente o
 * cenário que mais importa.
 */
export default defineConfig({
  testDir: './e2e',
  fullyParallel: true,
  forbidOnly: Boolean(process.env['CI']),
  retries: process.env['CI'] ? 2 : 0,
  reporter: process.env['CI'] ? [['github'], ['html', { open: 'never' }]] : 'list',

  use: {
    baseURL: process.env['URL_WEB'] ?? 'http://localhost:3000',
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    locale: 'pt-BR',
    timezoneId: 'America/Sao_Paulo',
  },

  projects: [
    { name: 'desktop', use: { ...devices['Desktop Chrome'] } },
    {
      name: 'campo',
      use: {
        ...devices['Pixel 7'],
        // O formulário de campo pede geolocalização assim que abre. Sem
        // conceder, o teste ficaria preso no diálogo do navegador.
        permissions: ['geolocation'],
        geolocation: { latitude: -23.5505, longitude: -46.6333 },
      },
    },
  ],

  webServer: {
    command: 'pnpm --filter @jeleitoral/web dev',
    url: 'http://localhost:3000',
    reuseExistingServer: !process.env['CI'],
    timeout: 120_000,
  },
});
