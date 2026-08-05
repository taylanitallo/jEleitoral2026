/**
 * `pnpm verificar:boot`
 *
 * Sobe o `dist/main.js` de verdade e confere que ele fica de pé.
 *
 * Existe por uma falha de produção: `DivulgacaoModule` foi escrito com
 * `controllers` e sem `providers`. O TypeScript não vê nada de errado — a
 * injeção do Nest é resolvida em tempo de execução — então `typecheck`, `lint`,
 * os 191 testes, RLS, isolamento e o `build` passaram todos, e a Railway subiu
 * uma imagem que não bootava. O sintoma foi "1/1 replicas never became
 * healthy", que não diz nada sobre módulo nem sobre injeção.
 *
 * **Contra o BUNDLE, e não contra o código-fonte.** Foi verificado: montar o
 * `AppModule` a partir dos fontes, tanto com `Test.createTestingModule` quanto
 * com `NestFactory.create`, passa mesmo com o defeito presente — em fonte o
 * Nest acha o provider subindo até o módulo pai. Só o artefato do esbuild
 * reproduz, porque lá as classes viram identidades distintas
 * (`BancoService2`). Um teste de fumaça que não reproduz o caminho de produção
 * é pior que nenhum: parece que protege.
 *
 * O critério é simples e suficiente: se o processo morre, falhou; se continua
 * vivo depois da janela, subiu.
 */
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const RAIZ_API = resolve(fileURLToPath(new URL('.', import.meta.url)), '..');
const BUNDLE = resolve(RAIZ_API, 'dist/main.js');
const JANELA_MS = 20_000;

/**
 * Ambiente sintático, não credenciais.
 *
 * `carregarConfiguracao` valida com Zod e derruba o processo se faltar chave. A
 * porta é alta e improvável para não brigar com nada que esteja rodando, e o
 * banco aponta para lugar nenhum de propósito: o boot não deve depender de
 * banco disponível, e se um dia depender, é aqui que se descobre.
 */
const AMBIENTE = {
  ...process.env,
  AMBIENTE: 'desenvolvimento',
  PORT: '39517',
  URL_WEB: 'http://localhost:3100',
  SUPABASE_URL: 'http://localhost:54321',
  SUPABASE_CHAVE_ANONIMA: 'chave-anonima-de-teste-com-tamanho-suficiente',
  SUPABASE_CHAVE_SERVICO: 'chave-servico-de-teste-com-tamanho-suficiente',
  BANCO_URL: 'postgresql://usuario:senha@127.0.0.1:1/inexistente',
  CHAVE_CRIPTOGRAFIA_AES: '0'.repeat(64),
  SEGREDO_HMAC_INDICE: '1'.repeat(64),
};

if (!existsSync(BUNDLE)) {
  console.error(`Bundle não encontrado em ${BUNDLE}. Rode o build antes.`);
  process.exit(1);
}

const processo = spawn(process.execPath, [BUNDLE], { env: AMBIENTE, cwd: RAIZ_API });

let saida = '';
processo.stdout.on('data', (pedaco) => {
  saida += String(pedaco);
});
processo.stderr.on('data', (pedaco) => {
  saida += String(pedaco);
});

const relogio = setTimeout(() => {
  // Vivo depois da janela: subiu. Mata e sai bem.
  processo.kill('SIGTERM');
  console.log('A API subiu: todo provider e controller resolveu.');
  process.exit(0);
}, JANELA_MS);

processo.on('exit', (codigo, sinal) => {
  clearTimeout(relogio);
  // SIGTERM é o nosso: chegou aqui pelo caminho de sucesso.
  if (sinal === 'SIGTERM') return;

  console.error(`A API NÃO subiu (código ${codigo}).\n`);
  console.error(saida.trim());
  process.exit(1);
});

processo.on('error', (erro) => {
  clearTimeout(relogio);
  console.error(`Não foi possível executar o bundle: ${String(erro)}`);
  process.exit(1);
});
