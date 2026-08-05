import { defineConfig, devices } from '@playwright/test';
import { ARQUIVO_SESSAO } from './e2e/sessao.js';

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
  /*
   * Serial, e não paralelo.
   *
   * Todos os contextos partem do mesmo `storageState`, ou seja, do mesmo token
   * de renovação — e o Supabase rotaciona o refresh token a cada uso. Em
   * paralelo, o primeiro worker que renova invalida a sessão dos outros, que
   * passam a receber um token sem claims e caem em "seu acesso não está
   * vinculado a nenhuma campanha". A falha é intermitente e aponta para o lugar
   * errado; foi observada, não suposta.
   */
  fullyParallel: false,
  workers: 1,
  forbidOnly: Boolean(process.env['CI']),
  retries: process.env['CI'] ? 2 : 0,
  reporter: process.env['CI'] ? [['github'], ['html', { open: 'never' }]] : 'list',

  use: {
    // Porta 3100, a mesma do `dev`. Apontar para 3000 era o defeito que
    // fazia o E2E rodar contra outro sistema Jeos na mesma máquina — e
    // falhar com uma mensagem que não existe neste projeto.
    baseURL: process.env['URL_WEB'] ?? 'http://localhost:3100',
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    locale: 'pt-BR',
    timezoneId: 'America/Sao_Paulo',
  },

  /*
   * Sem credenciais, a suíte inteira é ignorada.
   *
   * Toda rota deste sistema é protegida: sem sessão, o middleware devolve a
   * tela de login e cada teste falha procurando um elemento que não está lá.
   * Oito falhas idênticas escondem as de verdade e ensinam a ignorar o
   * relatório. Pular com motivo declarado é honesto; falhar em massa não é.
   */
  testIgnore: process.env['EMAIL_E2E'] ? [] : ['**/*.spec.ts'],

  projects: [
    { name: 'autenticar', testMatch: /autenticar\.setup\.ts/ },
    {
      name: 'desktop',
      use: { ...devices['Desktop Chrome'], storageState: ARQUIVO_SESSAO },
      dependencies: ['autenticar'],
    },
    {
      name: 'campo',
      use: {
        ...devices['Pixel 7'],
        // O formulário de campo pede geolocalização assim que abre. Sem
        // conceder, o teste ficaria preso no diálogo do navegador.
        permissions: ['geolocation'],
        geolocation: { latitude: -23.5505, longitude: -46.6333 },
        storageState: ARQUIVO_SESSAO,
      },
      dependencies: ['autenticar'],
    },
  ],

  webServer: {
    command: 'pnpm --filter @jeleitoral/web dev',
    url: 'http://localhost:3100',
    reuseExistingServer: !process.env['CI'],
    timeout: 120_000,
  },
});
