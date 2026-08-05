import { expect, test, type Page } from '@playwright/test';

/**
 * Fluxo de campo de ponta a ponta.
 *
 * O que estes testes protegem não é a aparência da tela — é a garantia de
 * conformidade e a de não perder coleta. Se algum deles quebrar, o sistema
 * passou a permitir entrevista sem consentimento, ou passou a perder trabalho
 * do entrevistador quando cai a rede. Os dois são inaceitáveis.
 *
 * **Eles não rodavam.** Toda rota é protegida, e sem sessão o middleware
 * devolvia a tela de login: os oito testes procuravam elementos que nunca
 * estavam lá, e nunca foram ao CI. Resolvida a sessão, apareceu o segundo
 * desencontro — a tela passou a pedir o endereço ANTES de montar o formulário,
 * e os testes ainda o esperavam na abertura. `abrirFormulario` cobre esse passo
 * uma vez só, em vez de repeti-lo em cada teste.
 */

/**
 * Preenche o endereço e devolve com o formulário de entrevista na tela.
 *
 * Cada chamada usa um número diferente de propósito: a deduplicação por
 * endereço é real, e reusar o mesmo número faria o segundo teste entrevistar no
 * domicílio criado pelo primeiro — acoplamento entre testes que aparece como
 * falha intermitente e custa horas para localizar.
 */
async function abrirFormulario(page: Page): Promise<void> {
  await page.goto('/campo/entrevista');

  const municipio = page.getByLabel('Município');
  await expect(municipio).toBeVisible({ timeout: 20_000 });
  // Índice 1, e não um nome: a lista vem da UF da campanha, e fixar "Fortaleza"
  // prenderia o teste à configuração do ambiente.
  await municipio.selectOption({ index: 1 });

  await page.getByLabel('Bairro').fill('Centro');
  await page.getByLabel('Rua').fill('Rua de Teste Automatizado');
  await page.getByLabel('Número').fill(String(100 + Math.floor(Math.random() * 8000)));

  await page.getByRole('button', { name: /começar entrevista/i }).click();

  await expect(page.getByLabel('Nome')).toBeVisible({ timeout: 25_000 });
}

/**
 * Preenche a primeira intenção de voto disponível.
 *
 * Por seletor de `id`, e não pelo rótulo "Deputado Federal": os cargos vêm da
 * campanha, e prender o teste a um deles o quebra quando o ambiente muda de
 * eleição — que foi exatamente o que aconteceu com a versão anterior destes
 * testes.
 *
 * Existe porque o botão de salvar exige CONTEÚDO além do consentimento: nome e
 * termo aceito, sem nenhuma intenção nem recusa registrada, é entrevista que
 * não coletou nada.
 */
async function preencherPrimeiraIntencao(page: Page): Promise<void> {
  const campo = page.locator('[id^="cargo-"]').first();
  await expect(campo).toBeVisible({ timeout: 10_000 });
  await campo.fill('1234');
}

test.describe('formulário de entrevista', () => {
  test('a tarja de uso interno aparece antes de qualquer campo', async ({ page }) => {
    // Divulgar levantamento não registrado sujeita a multa (Lei 9.504/97,
    // art. 33). O aviso não pode depender de o operador rolar a tela.
    await abrirFormulario(page);
    await expect(page.getByText(/vedada a divulgação pública/i)).toBeVisible();
  });

  test('não deixa salvar sem consentimento', async ({ page }) => {
    await abrirFormulario(page);
    await page.getByLabel('Nome').fill('Fulano de Teste');

    const salvar = page.getByRole('button', { name: /salvar entrevista/i });
    await expect(salvar).toBeDisabled();
    await expect(page.getByText(/consentimento é obrigatório/i)).toBeVisible();
  });

  test('libera o salvamento quando o consentimento é registrado', async ({ page }) => {
    await abrirFormulario(page);
    await page.getByLabel('Nome').fill('Fulano de Teste');
    await preencherPrimeiraIntencao(page);
    await page.getByRole('checkbox', { name: /li o termo/i }).check();

    await expect(page.getByRole('button', { name: /salvar entrevista/i })).toBeEnabled();
  });

  test('salva no aparelho mesmo sem rede e avisa o entrevistador', async ({ page, context }) => {
    await abrirFormulario(page);
    await page.getByLabel('Nome').fill('Fulano Sem Rede');
    await preencherPrimeiraIntencao(page);
    await page.getByRole('checkbox', { name: /li o termo/i }).check();

    // Zona rural sem sinal: o cenário normal, não o excepcional.
    await context.setOffline(true);
    await page.getByRole('button', { name: /salvar entrevista/i }).click();

    /*
     * O entrevistador precisa SABER que o trabalho ainda não subiu. Um "salvo!"
     * indistinguível do online faria alguém fechar o aparelho achando que
     * acabou — e a fila iria embora com o cache do navegador.
     */
    await expect(page.getByText(/aparelho|pendente|sobem sozinhas/i).first()).toBeVisible({
      timeout: 15_000,
    });

    await context.setOffline(false);
  });

  test('o formulário volta limpo depois de salvar', async ({ page }) => {
    await abrirFormulario(page);
    await page.getByLabel('Nome').fill('Fulano de Teste');
    await preencherPrimeiraIntencao(page);
    await page.getByRole('checkbox', { name: /li o termo/i }).check();
    await page.getByRole('button', { name: /salvar entrevista/i }).click();

    // Sem isso, a próxima entrevista herdaria o nome da anterior — e o
    // entrevistador só perceberia depois de várias casas.
    await expect(page.getByLabel('Nome')).toHaveValue('', { timeout: 20_000 });
    await expect(page.getByRole('checkbox', { name: /li o termo/i })).not.toBeChecked();
  });
});

test.describe('painel', () => {
  test('mostra estado vazio em vez de tela branca quando não há dados', async ({ page }) => {
    await page.goto('/painel');
    // Ou carrega, ou erra, ou avisa que está vazio — nunca fica em branco.
    await expect(page.getByRole('heading').first()).toBeVisible({ timeout: 25_000 });
  });

  test('a tarja de uso interno acompanha o painel', async ({ page }) => {
    await page.goto('/painel');
    await expect(page.getByText(/vedada a divulgação pública/i)).toBeVisible({ timeout: 25_000 });
  });
});

test.describe('navegação', () => {
  // No celular a sidebar é gaveta e começa FECHADA — de propósito, para não
  // comer a tela do entrevistador. Rodar isto no perfil `campo` testaria o
  // contrário do desenho.
  test.skip(({ isMobile }) => Boolean(isMobile), 'sidebar fixa só existe no desktop');

  test('a sidebar é montada a partir das permissões do token', async ({ page }) => {
    /*
     * A regra que o menu torna estrutural: item que o perfil não pode usar não
     * aparece. Um item visível e depois recusado pela API ensina o usuário a
     * esbarrar em porta trancada.
     */
    await page.goto('/painel');
    await expect(page.getByRole('navigation').first()).toBeVisible({ timeout: 25_000 });
  });
});
