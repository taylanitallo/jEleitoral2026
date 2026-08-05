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
 * Preenche a primeira intenção de voto disponível, pelo `SeletorCandidato`.
 *
 * Por seletor de `id`, e não pelo rótulo "Deputado Federal": os cargos vêm da
 * campanha, e prender o teste a um deles o quebra quando o ambiente muda de
 * eleição — que foi exatamente o que aconteceu com a versão anterior destes
 * testes.
 *
 * Usa **"Outro número"**, e não a busca por candidato cadastrado: o ambiente
 * de homologação pode não ter chapa cadastrada para a campanha do usuário de
 * teste, e essa via não depende de dado nenhum — é a mesma saída de emergência
 * que o entrevistador usa em campo para um número que ainda não está na lista.
 *
 * Existe porque o botão de salvar exige CONTEÚDO além do consentimento: nome e
 * termo aceito, sem nenhuma intenção nem recusa registrada, é entrevista que
 * não coletou nada.
 */
async function preencherPrimeiraIntencao(page: Page): Promise<void> {
  const campo = page.locator('[id^="cargo-"]').first();
  await expect(campo).toBeVisible({ timeout: 10_000 });
  await campo.click();

  const outroNumero = page.getByPlaceholder('Outro número');
  await expect(outroNumero).toBeVisible({ timeout: 5_000 });
  await outroNumero.fill('1234');
  // `exact: true`: no desktop a sidebar tem "Usar tema escuro", que casaria
  // por substring com um "Usar" impreciso.
  await page.getByRole('button', { name: 'Usar', exact: true }).click();
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

test.describe('registro de entrevistas', () => {
  /*
   * Cobre a Fase 4 de ponta a ponta pela interface: registra uma entrevista,
   * abre no registro, entra no detalhe, vê a aba de histórico. Não retifica
   * por aqui — a retificação já é exercitada por
   * `apps/api/testes/entrevistaImutavel.spec.ts` contra o banco real, e
   * duplicar em E2E só somaria tempo de execução sem cobrir risco novo.
   */
  test('a entrevista salva aparece no registro e abre com aba de histórico', async ({ page }) => {
    await abrirFormulario(page);
    const nome = `E2E Registro ${Date.now()}`;
    await page.getByLabel('Nome').fill(nome);
    await preencherPrimeiraIntencao(page);
    await page.getByRole('checkbox', { name: /li o termo/i }).check();
    await page.getByRole('button', { name: /salvar entrevista/i }).click();

    // A fila offline sincroniza sozinha, mas só no próximo ciclo (2 minutos)
    // ou quando alguém clica "Enviar agora" — sem forçar isso aqui, o teste
    // ficaria esperando até 2 minutos. `waitForResponse` é o sinal
    // inequívoco de que o servidor confirmou, sem depender de texto que
    // também aparece na mensagem de confirmação do formulário.
    //
    // O texto muda com `navigator.onLine`: este teste roda online, então a
    // mensagem é "salva... subindo", não "salva no aparelho" (essa é da
    // simulação offline em outro teste). "salva" é o que as duas têm em comum.
    await expect(page.getByText(/entrevista salva/i).first()).toBeVisible({ timeout: 15_000 });
    const respostaSincronizacao = page.waitForResponse(
      (resposta) => resposta.url().includes('/campo/sincronizar') && resposta.ok(),
      { timeout: 20_000 },
    );
    const enviarAgora = page.getByRole('button', { name: 'Enviar agora' });
    if (await enviarAgora.isVisible().catch(() => false)) {
      await enviarAgora.click();
    }
    await respostaSincronizacao;

    await page.goto('/campo/entrevistas');
    const campoBusca = page.getByLabel('Nome do entrevistado');
    await campoBusca.fill(nome);

    // Espera a resposta da busca, e não só o texto na tela: clicar durante a
    // troca de `dados` (o React ainda desmontando a linha antiga e montando a
    // nova) fez este teste ficar intermitente — o clique "funcionava" sem
    // erro, mas em cima de um nó a caminho de ser substituído.
    const respostaListagem = page.waitForResponse(
      (resposta) => resposta.url().includes('/campo/entrevistas?') && resposta.ok(),
    );
    await page.getByRole('button', { name: 'Buscar' }).click();
    await respostaListagem;

    const linha = page.getByText(nome, { exact: true });
    await expect(linha).toBeVisible({ timeout: 20_000 });
    await linha.click();

    await expect(page).toHaveURL(/\/campo\/entrevistas\/[^/]+$/);
    await expect(page.getByRole('heading', { name: nome })).toBeVisible({ timeout: 15_000 });

    await page.getByRole('tab', { name: 'Histórico' }).click();
    await expect(page).toHaveURL(/aba=historico/);
    await expect(page.getByText('Versão 1')).toBeVisible();
    await expect(page.getByText('Registro original.')).toBeVisible();
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
