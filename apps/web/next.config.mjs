/** @type {import('next').NextConfig} */
const configuracao = {
  reactStrictMode: true,
  // Os pacotes do monorepo são publicados como TypeScript puro.
  transpilePackages: ['@jeleitoral/ui', '@jeleitoral/tipos', '@jeleitoral/utilitarios'],
  poweredByHeader: false,
  /*
   * `next build` e `next dev` escrevem no MESMO `.next`.
   *
   * Rodar um build com o servidor de desenvolvimento no ar substitui os
   * artefatos que ele está servindo, e o dev passa a entregar um manifesto que
   * aponta para arquivos inexistentes. A página abre, o HTML vem, e o CSS e o
   * JavaScript dão 404 — a tela aparece sem estilo nenhum e o formulário faz
   * submit nativo em vez de chamar a API. O sintoma parece "o login não
   * funciona", e nada nos logs liga uma coisa à outra.
   *
   * O padrão continua `.next`, que é o que a Vercel espera. Para conferir um
   * build de produção sem derrubar o dev, use `pnpm build:local`.
   */
  distDir: process.env.NEXT_DIRETORIO_BUILD ?? '.next',
  /**
   * A API é servida na MESMA ORIGEM, por proxy.
   *
   * Com web na Vercel e API na Railway, qualquer cookie de sessão é um cookie
   * entre sites — e o navegador o descarta se for SameSite=Strict. Baixar para
   * SameSite=None resolveria o sintoma e abriria a porta para CSRF. Encaminhar
   * mantém tudo em primeira parte: o cookie é aceito, e o Strict continua
   * valendo como defesa.
   */
  async rewrites() {
    const api = process.env.URL_API_INTERNA ?? process.env.NEXT_PUBLIC_URL_API;
    if (!api) return [];
    return [{ source: '/api/:caminho*', destination: `${api}/api/:caminho*` }];
  },

  async headers() {
    return [
      {
        /*
         * O próprio service worker não pode ficar em cache HTTP.
         *
         * Ele é o arquivo que decide o que os outros cacheiam; guardado por
         * horas, uma correção de cache fica presa atrás do cache do próprio
         * corretor. O navegador já revalida `sw.js` com frequência por conta
         * própria, mas o padrão de estáticos da Vercel é agressivo o bastante
         * para atrapalhar — e um worker velho em campo é invisível até alguém
         * notar que a correção não chegou a aparelho nenhum.
         */
        source: '/sw.js',
        headers: [
          { key: 'Cache-Control', value: 'public, max-age=0, must-revalidate' },
          { key: 'Content-Type', value: 'application/javascript; charset=utf-8' },
        ],
      },
      {
        source: '/:caminho*',
        headers: [
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
          { key: 'X-Frame-Options', value: 'DENY' },
          {
            key: 'Permissions-Policy',
            // Geolocalização é necessária no formulário de campo; o resto não.
            value: 'geolocation=(self), camera=(), microphone=(), payment=()',
          },
        ],
      },
    ];
  },
};

export default configuracao;
