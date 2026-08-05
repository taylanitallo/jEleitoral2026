/**
 * Onde a sessão do E2E é guardada.
 *
 * Módulo próprio, de uma linha, porque `playwright.config.ts` e o `setup`
 * precisam do mesmo caminho e o config não pode importar um arquivo de teste —
 * o Playwright carrega o config antes de montar o runner, e a importação
 * cruzada quebra na hora.
 */
export const ARQUIVO_SESSAO = 'e2e/.sessao/estado.json';
