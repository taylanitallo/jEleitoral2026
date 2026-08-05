import { expect, test as setup } from '@playwright/test';
import { existsSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { ARQUIVO_SESSAO } from './sessao.js';

/**
 * Entra uma vez e guarda a sessão para todos os testes.
 *
 * Sem isto o E2E estava **inteiro quebrado, sem que ninguém soubesse**: o
 * middleware redireciona qualquer rota protegida para `/entrar`, e os oito
 * testes existentes procuravam elementos numa tela de login. Nunca rodaram
 * verdes; nunca foram ao CI. Um teste que não roda é pior que teste nenhum,
 * porque dá a impressão de cobertura.
 *
 * As credenciais vêm do ambiente e nunca do código. Sem elas o `setup` falha
 * com uma mensagem que diz o que fazer — e o `playwright.config.ts` marca a
 * suíte inteira como pulada, em vez de despejar oito falhas idênticas que
 * escondem as de verdade.
 */
setup('autenticar', async ({ page }) => {
  const email = process.env['EMAIL_E2E'];
  const senha = process.env['SENHA_E2E'];

  /*
   * PULA, não falha.
   *
   * O `testIgnore` do config já descarta as specs sem credenciais, mas o setup
   * não é uma spec e rodava assim mesmo — derrubando o job inteiro com uma
   * falha que não é defeito de código, só ambiente sem segredo configurado. Um
   * CI que fica vermelho por configuração ausente é um CI que se aprende a
   * ignorar.
   */
  if (!email || !senha) {
    // `setup.skip(true, ...)` interrompe o teste lançando; o `return` existe
    // para o compilador, que não sabe disso e não estreitaria os tipos abaixo.
    setup.skip(true, 'Defina EMAIL_E2E e SENHA_E2E (conta de HOMOLOGAÇÃO — o E2E escreve dados).');
    return;
  }

  await page.goto('/entrar');
  await page.getByLabel(/e-?mail/i).fill(email);
  await page.getByLabel(/senha/i).fill(senha);
  await page.getByRole('button', { name: /entrar/i }).click();

  /*
   * Espera a navegação sair de `/entrar`, e não um elemento do painel.
   *
   * Perfis diferentes caem em telas diferentes, e o coordenador não vê o mesmo
   * que o entrevistador. Amarrar o setup a um elemento específico o quebraria
   * quando alguém trocasse o perfil da conta de teste — uma falha que aponta
   * para o lugar errado.
   */
  await page.waitForURL((url) => !url.pathname.startsWith('/entrar'), { timeout: 30_000 });
  await expect(page).not.toHaveURL(/\/entrar/);

  if (!existsSync(dirname(ARQUIVO_SESSAO))) {
    mkdirSync(dirname(ARQUIVO_SESSAO), { recursive: true });
  }
  await page.context().storageState({ path: ARQUIVO_SESSAO });
});
