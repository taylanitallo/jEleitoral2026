/** @type {import('next').NextConfig} */
const configuracao = {
  reactStrictMode: true,
  // Os pacotes do monorepo são publicados como TypeScript puro.
  transpilePackages: ['@jeleitoral/ui', '@jeleitoral/tipos', '@jeleitoral/utilitarios'],
  poweredByHeader: false,
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
