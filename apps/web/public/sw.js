/*
 * Service worker do jEleitoral.
 *
 * Existe por um motivo só, e ele é concreto: sem service worker, o app é
 * baixado do servidor a cada visita. O entrevistador que chega no distrito sem
 * sinal e abre o aplicativo vê a tela de erro do navegador — e a fila offline,
 * que está pronta e testada, fica inalcançável porque a tela que a usa não
 * carrega. O motor existia; faltava a carroceria.
 *
 * Três regras governam este arquivo:
 *
 *  1. **Nada de `/api` no cache.** Intenção de voto e dado pessoal não ficam
 *     guardados no navegador do aparelho, que é o item mais fácil de perder ou
 *     de ter roubado numa campanha. O que precisa sobreviver offline já vive no
 *     IndexedDB da fila, sob controle da aplicação. Cachear resposta de API aqui
 *     também serviria dado de uma sessão para a seguinte — inclusive de outro
 *     usuário no mesmo aparelho, que é comum quando o celular é da campanha.
 *
 *  2. **Navegação é rede primeiro, cache como rede de segurança.** Campanha
 *     muda o app no meio do dia; servir HTML velho por dias esconderia
 *     correções. Mas se a rede falhar, o cache responde — que é o cenário para o
 *     qual isto tudo existe.
 *
 *  3. **Estático do Next é cache primeiro.** `/_next/static` tem hash no nome:
 *     o arquivo daquele endereço nunca muda, então buscar de novo é desperdício
 *     de dados móveis de quem está em 3G.
 */

const VERSAO = 'v1';
const CACHE_APLICACAO = `jeleitoral-app-${VERSAO}`;
const CACHE_ESTATICO = `jeleitoral-estatico-${VERSAO}`;

/*
 * Rotas que precisam abrir sem rede.
 *
 * Não dá para pré-cachear os pedaços de JavaScript do Next: os nomes têm hash e
 * só existem depois do build. Por isso o que se pré-carrega são as rotas — e o
 * navegador guarda os pedaços delas na primeira visita com sinal, pela regra do
 * `/_next/static`. Consequência operacional a comunicar à equipe: **o aparelho
 * precisa abrir o aplicativo uma vez com internet antes de ir para a rua.**
 */
const ROTAS_ESSENCIAIS = ['/campo/entrevista', '/offline'];

self.addEventListener('install', (evento) => {
  evento.waitUntil(
    (async () => {
      const cache = await caches.open(CACHE_APLICACAO);
      // `reload` ignora o cache HTTP do navegador: numa atualização, pegar a
      // versão velha aqui congelaria a correção que acabou de subir.
      await cache.addAll(ROTAS_ESSENCIAIS.map((rota) => new Request(rota, { cache: 'reload' })));
      // Assume o controle sem esperar o fechamento das abas: quem está em campo
      // não fecha o aplicativo, e a correção precisa chegar.
      await self.skipWaiting();
    })(),
  );
});

self.addEventListener('activate', (evento) => {
  evento.waitUntil(
    (async () => {
      const nomes = await caches.keys();
      await Promise.all(
        nomes
          .filter((nome) => nome.startsWith('jeleitoral-') && !nome.endsWith(VERSAO))
          .map((nome) => caches.delete(nome)),
      );
      await self.clients.claim();
    })(),
  );
});

self.addEventListener('fetch', (evento) => {
  const requisicao = evento.request;

  // Só GET. POST de sincronização jamais pode ser servido de cache nem repetido
  // por engano — a idempotência da fila protege o servidor, mas o lugar de
  // resolver isso é a fila, não aqui.
  if (requisicao.method !== 'GET') return;

  const url = new URL(requisicao.url);

  // Outra origem (IBGE, mapas): passa direto, sem intermediação.
  if (url.origin !== self.location.origin) return;

  // Regra 1: nada de API no cache.
  if (url.pathname.startsWith('/api/')) return;

  if (url.pathname.startsWith('/_next/static/')) {
    evento.respondWith(cachePrimeiro(requisicao));
    return;
  }

  if (requisicao.mode === 'navigate') {
    evento.respondWith(redePrimeiro(requisicao));
    return;
  }

  // Ícones, manifest e imagens: servem do cache e revalidam em segundo plano.
  if (['image', 'font', 'style', 'script'].includes(requisicao.destination)) {
    evento.respondWith(cachePrimeiro(requisicao));
  }
});

async function cachePrimeiro(requisicao) {
  const cache = await caches.open(CACHE_ESTATICO);
  const guardado = await cache.match(requisicao);
  if (guardado) return guardado;

  const resposta = await fetch(requisicao);
  // `basic` exclui opaca e erro: guardar uma resposta opaca ocuparia a cota sem
  // que dê para saber se ela é útil, e guardar erro serviria erro para sempre.
  if (resposta.ok && resposta.type === 'basic') {
    cache.put(requisicao, resposta.clone());
  }
  return resposta;
}

async function redePrimeiro(requisicao) {
  const cache = await caches.open(CACHE_APLICACAO);
  try {
    const resposta = await fetch(requisicao);
    if (resposta.ok) cache.put(requisicao, resposta.clone());
    return resposta;
  } catch {
    const guardado = (await cache.match(requisicao)) ?? (await cache.match('/campo/entrevista'));
    if (guardado) return guardado;

    const alternativa = await cache.match('/offline');
    if (alternativa) return alternativa;

    // Último recurso: sem rede e sem nada em cache, dizer o que houve em vez de
    // deixar o navegador mostrar a própria tela de erro, que não explica que o
    // trabalho salvo está a salvo.
    return new Response(
      '<!doctype html><html lang="pt-BR"><meta charset="utf-8">' +
        '<meta name="viewport" content="width=device-width,initial-scale=1">' +
        '<title>Sem conexão — jEleitoral</title>' +
        '<body style="font-family:system-ui;margin:0;display:grid;place-items:center;' +
        'min-height:100dvh;padding:1.5rem;text-align:center;color:#1a1d24">' +
        '<div><h1 style="font-size:1.25rem">Sem conexão</h1>' +
        '<p>As entrevistas já salvas neste aparelho estão guardadas e sobem sozinhas ' +
        'quando o sinal voltar.</p>' +
        '<p style="color:#555">Abra o aplicativo uma vez com internet para que ele ' +
        'funcione offline daqui em diante.</p></div></body></html>',
      { status: 503, headers: { 'Content-Type': 'text/html; charset=utf-8' } },
    );
  }
}
