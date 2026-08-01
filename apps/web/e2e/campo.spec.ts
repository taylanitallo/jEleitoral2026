import { expect, test } from '@playwright/test';

/**
 * Fluxo de campo de ponta a ponta.
 *
 * O que estes testes protegem não é a aparência da tela — é a garantia de
 * conformidade e a de não perder coleta. Se algum deles quebrar, o sistema
 * passou a permitir entrevista sem consentimento, ou passou a perder trabalho
 * do entrevistador quando cai a rede. Os dois são inaceitáveis.
 */

test.describe('formulário de entrevista', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/campo/entrevista');
  });

  test('a tarja de uso interno aparece antes de qualquer campo', async ({ page }) => {
    // Divulgar levantamento não registrado sujeita a multa (Lei 9.504/97,
    // art. 33). O aviso não pode depender de o operador rolar a tela.
    await expect(page.getByText(/vedada a divulgação pública/i)).toBeVisible();
  });

  test('não deixa salvar sem consentimento', async ({ page }) => {
    await page.getByLabel('Nome').fill('Fulano de Teste');
    await page.getByLabel('Deputado Federal').fill('1234');

    const salvar = page.getByRole('button', { name: /salvar entrevista/i });
    await expect(salvar).toBeDisabled();
    await expect(page.getByText(/consentimento é obrigatório/i)).toBeVisible();
  });

  test('libera o salvamento quando o consentimento é registrado', async ({ page }) => {
    await page.getByLabel('Nome').fill('Fulano de Teste');
    await page.getByLabel('Deputado Federal').fill('1234');
    await page.getByRole('checkbox', { name: /li o termo/i }).check();

    await expect(page.getByRole('button', { name: /salvar entrevista/i })).toBeEnabled();
  });

  test('aceita recusa em responder como conteúdo válido', async ({ page }) => {
    // Recusa é informação, não entrevista incompleta.
    await page.getByLabel('Nome').fill('Fulano de Teste');
    await page.getByRole('checkbox', { name: /preferiu não responder/i }).check();
    await page.getByRole('checkbox', { name: /li o termo/i }).check();

    await expect(page.getByRole('button', { name: /salvar entrevista/i })).toBeEnabled();
  });

  test('salva no aparelho mesmo sem rede e avisa o entrevistador', async ({ page, context }) => {
    await page.getByLabel('Nome').fill('Fulano Sem Rede');
    await page.getByLabel('Deputado Federal').fill('1234');
    await page.getByRole('checkbox', { name: /li o termo/i }).check();

    // Zona rural sem sinal: o cenário normal, não o excepcional.
    await context.setOffline(true);
    await page.getByRole('button', { name: /salvar entrevista/i }).click();

    await expect(page.getByText(/salva no aparelho/i)).toBeVisible();
    // A fila precisa anunciar o pendente — o entrevistador tem que saber que o
    // trabalho dele ainda não subiu.
    await expect(page.getByText(/sobem sozinhas|sobe sozinha/i)).toBeVisible();
  });

  test('o formulário volta limpo depois de salvar', async ({ page }) => {
    await page.getByLabel('Nome').fill('Fulano de Teste');
    await page.getByLabel('Deputado Federal').fill('1234');
    await page.getByRole('checkbox', { name: /li o termo/i }).check();
    await page.getByRole('button', { name: /salvar entrevista/i }).click();

    // Sem isso, a próxima entrevista herdaria o nome da anterior — e o
    // entrevistador só perceberia depois de várias casas.
    await expect(page.getByLabel('Nome')).toHaveValue('');
    await expect(page.getByRole('checkbox', { name: /li o termo/i })).not.toBeChecked();
  });
});

test.describe('painel', () => {
  test('mostra estado vazio em vez de tela branca quando não há dados', async ({ page }) => {
    await page.goto('/painel');
    // Ou carrega, ou erra, ou avisa que está vazio — nunca fica em branco.
    await expect(
      page
        .getByText(/nenhum eleitor mapeado|não foi possível carregar|calculando o recorte/i)
        .first(),
    ).toBeVisible({ timeout: 15_000 });
  });

  test('a tarja de uso interno acompanha o painel', async ({ page }) => {
    await page.goto('/painel');
    await expect(page.getByText(/vedada a divulgação pública/i)).toBeVisible();
  });
});
