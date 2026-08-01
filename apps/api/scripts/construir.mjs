import { build } from 'esbuild';
import { readFileSync } from 'node:fs';

/**
 * Build da API para deploy.
 *
 * O `tsc` sozinho não serve num monorepo pnpm: ele deixa `@jeleitoral/tipos` e
 * `@jeleitoral/utilitarios` como importações nuas, e em produção o Node tentaria
 * carregar o `src/index.ts` desses pacotes — que ele não sabe ler. O resultado é
 * um `MODULE_NOT_FOUND` que só aparece no contêiner.
 *
 * Então empacotamos: o código do workspace é embutido no bundle, e tudo o que
 * vem de `node_modules` continua externo (o NestJS usa require dinâmico e
 * decoradores que não sobrevivem bem a bundling).
 */
const pacote = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));

const DO_WORKSPACE = /^@jeleitoral\//;
const externos = Object.keys({ ...pacote.dependencies, ...pacote.devDependencies }).filter(
  (nome) => !DO_WORKSPACE.test(nome),
);

await build({
  entryPoints: ['src/main.ts'],
  outfile: 'dist/main.js',
  bundle: true,
  platform: 'node',
  target: 'node20',
  format: 'cjs',
  sourcemap: true,
  // Módulos opcionais que o NestJS referencia e nunca usamos. Sem isto o
  // esbuild falha ao resolvê-los.
  external: [
    ...externos,
    '@nestjs/websockets/socket-module',
    '@nestjs/microservices/microservices-module',
    '@nestjs/microservices',
    'class-transformer',
    'class-validator',
  ],
  logLevel: 'info',
});
