import { NextResponse, type NextRequest } from 'next/server';

const COOKIE_SESSAO = 'jeleitoral_sessao';

/**
 * Rotas que existem sem sessão. Tudo o mais exige entrar.
 *
 * `/offline` entra aqui porque é justamente a tela que o service worker serve
 * quando não há rede — e sem rede não há como validar sessão nenhuma.
 */
const PUBLICAS = ['/entrar', '/saude', '/offline'];

/**
 * Portão de sessão do lado do navegador.
 *
 * Isto é **conveniência de navegação**, não segurança: ele só evita que o
 * usuário veja uma tela vazia antes de a API recusar. A autorização de verdade
 * está no guard da API e, abaixo dele, nas políticas RLS do PostgreSQL — e é
 * lá que ela precisa estar, porque o middleware roda no cliente e um cookie
 * pode ser forjado.
 *
 * O que ele checa é apenas a **presença** do cookie; validar a assinatura aqui
 * duplicaria o segredo do JWT no ambiente da Vercel sem ganho real.
 */
export function middleware(requisicao: NextRequest): NextResponse {
  const caminho = requisicao.nextUrl.pathname;

  if (PUBLICAS.some((publica) => caminho.startsWith(publica))) {
    return NextResponse.next();
  }

  const temSessao = requisicao.cookies.has(COOKIE_SESSAO);
  if (temSessao) return NextResponse.next();

  const destino = new URL('/entrar', requisicao.url);
  // Preserva para onde o usuário ia: depois de entrar, ele volta ao lugar certo
  // em vez de cair sempre no painel.
  destino.searchParams.set('destino', `${caminho}${requisicao.nextUrl.search}`);
  return NextResponse.redirect(destino);
}

export const config = {
  matcher: [
    /*
     * Tudo, menos estáticos do Next, favicon e — sobretudo — `/api`.
     *
     * `/api` é o encaminhamento para a API, que faz a própria autenticação. Com
     * ele dentro do matcher, o middleware redireciona a chamada de login para a
     * tela de login porque ainda não existe cookie: nenhuma sessão jamais é
     * criada, e o sintoma no navegador é um 307 sem explicação.
     *
     * `sw.js` e `manifest.json` precisam estar de fora pela mesma razão, e o
     * modo como isso falha é traiçoeiro: sem sessão, o middleware responde o
     * redirecionamento para `/entrar`, o navegador recebe HTML onde esperava
     * JavaScript, e o registro do service worker morre com um erro de tipo MIME
     * que não menciona autenticação em lugar nenhum. O aplicativo simplesmente
     * nunca funciona offline, sem nada indicando o porquê.
     */
    '/((?!api|_next/static|_next/image|favicon.ico|sw\\.js|manifest\\.json|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)',
  ],
};
