/** @type {import('next').NextConfig} */
const configuracao = {
  reactStrictMode: true,
  // Os pacotes do monorepo são publicados como TypeScript puro.
  transpilePackages: ['@jeleitoral/ui', '@jeleitoral/tipos', '@jeleitoral/utilitarios'],
  poweredByHeader: false,
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
