/**
 * Aplica as migrations pendentes em ordem, dentro de uma única transação.
 *
 * Usado pelo CI (contra um PostgreSQL descartável) e pelo ambiente local. Em
 * produção quem aplica é `supabase db push` no pipeline — nunca alguém rodando
 * SQL à mão no painel.
 *
 * O que já foi aplicado fica registrado em `manutencao.migrations_aplicadas`. Sem
 * esse controle, rodar duas vezes falhava em `type "escopo_permissao" already
 * exists` — e a única saída era recriar o banco, o que num ambiente com dados
 * de campo não é saída nenhuma.
 */
import { readFile, readdir } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { config } from 'dotenv';
import { deveAdotar } from '../src/comum/ordemMigrations.js';
import { Client } from 'pg';

// Lê o `.env` da RAIZ do monorepo, não o do diretório atual. `dotenv/config`
// sozinho procura em `process.cwd()`, que com `pnpm --filter` é `apps/api` — e
// o arquivo mora na raiz. O sintoma era "Defina BANCO_URL" com a variável
// preenchida. No CI e em produção as variáveis já vêm do ambiente e o arquivo
// não existe; o dotenv não faz nada, sem erro.
config({ path: resolve(fileURLToPath(new URL('.', import.meta.url)), '../../../.env') });

// `fileURLToPath` e não `.pathname`: o caminho deste projeto tem espaço, que na
// URL vira `%20` e chega ao `scandir` como diretório inexistente.
const DIRETORIO_MIGRATIONS = resolve(
  fileURLToPath(new URL('.', import.meta.url)),
  '../../../infra/supabase/migrations',
);

async function principal(): Promise<void> {
  const urlBanco = process.env.BANCO_URL;
  if (!urlBanco) {
    throw new Error('Defina BANCO_URL antes de aplicar as migrations.');
  }

  const arquivos = (await readdir(DIRETORIO_MIGRATIONS))
    .filter((nome) => nome.endsWith('.sql'))
    .sort();

  if (arquivos.length === 0) {
    throw new Error(`Nenhuma migration encontrada em ${DIRETORIO_MIGRATIONS}.`);
  }

  const cliente = new Client({ connectionString: urlBanco });
  await cliente.connect();

  try {
    /*
     * A escrituração vive em `manutencao`, não em `public`.
     *
     * `public` é o esquema de dados de campo, e lá toda tabela precisa de
     * `id_organizacao` e política de RLS — a cobertura de RLS quebra o build
     * quando alguma não tem, e é isso que impede um vazamento entre inquilinos
     * de entrar despercebido. Esta tabela não é dado de cliente e não deve
     * relaxar aquela regra para caber.
     */
    await cliente.query('create schema if not exists manutencao');
    await cliente.query(`
      create table if not exists manutencao.migrations_aplicadas (
        arquivo text primary key,
        aplicada_em timestamptz not null default now()
      )
    `);

    // Bancos que registraram no lugar antigo trazem o histórico junto, para que
    // esta mudança não faça as migrations já aplicadas parecerem pendentes.
    await cliente.query(`
      do $$
      begin
        if to_regclass('public.migrations_aplicadas') is not null then
          insert into manutencao.migrations_aplicadas (arquivo, aplicada_em)
            select arquivo, aplicada_em from public.migrations_aplicadas
            on conflict (arquivo) do nothing;
          drop table public.migrations_aplicadas;
        end if;
      end;
      $$
    `);

    const { rows } = await cliente.query<{ arquivo: string }>(
      'select arquivo from manutencao.migrations_aplicadas',
    );
    const jaAplicadas = new Set(rows.map((linha) => linha.arquivo));

    /*
     * Adoção de banco preexistente.
     *
     * Os ambientes criados antes do controle de versões já têm o esquema, mas o
     * registro está vazio — uma execução normal tentaria recriar tudo e falharia.
     * `--adotar-ate=0015` marca como aplicadas as migrations até aquele número,
     * sem executá-las, e deixa as seguintes para rodar normalmente.
     */
    const adocao = process.argv.find((argumento) => argumento.startsWith('--adotar-ate='));
    if (adocao) {
      const limite = adocao.split('=')[1] ?? '';
      const adotadas = arquivos.filter(
        (arquivo) => deveAdotar(arquivo, limite) && !jaAplicadas.has(arquivo),
      );
      if (adotadas.length === 0) {
        // Silêncio aqui esconderia um limite mal digitado, e o operador
        // concluiria que a adoção funcionou.
        process.stdout.write(`Nenhuma migration corresponde a --adotar-ate=${limite}.
`);
      }
      for (const arquivo of adotadas) {
        await cliente.query(
          'insert into manutencao.migrations_aplicadas (arquivo) values ($1) on conflict do nothing',
          [arquivo],
        );
        jaAplicadas.add(arquivo);
        process.stdout.write(`≡ ${arquivo} (adotada, não executada)\n`);
      }
    }

    const pendentes = arquivos.filter((arquivo) => !jaAplicadas.has(arquivo));

    if (pendentes.length === 0) {
      process.stdout.write('Nada a aplicar: o banco já está na última migration.\n');
      return;
    }

    await cliente.query('begin');
    for (const arquivo of pendentes) {
      const sql = await readFile(join(DIRETORIO_MIGRATIONS, arquivo), 'utf8');
      process.stdout.write(`→ ${arquivo}\n`);
      await cliente.query(sql);
      await cliente.query('insert into manutencao.migrations_aplicadas (arquivo) values ($1)', [
        arquivo,
      ]);
    }
    await cliente.query('commit');
    process.stdout.write(`\n${pendentes.length} migration(s) aplicada(s) com sucesso.\n`);
  } catch (erro) {
    await cliente.query('rollback');
    // Falha parcial deixaria o banco em estado inconsistente; a transação
    // garante tudo-ou-nada.
    throw erro;
  } finally {
    await cliente.end();
  }
}

principal().catch((erro: unknown) => {
  process.stderr.write(`Falha ao aplicar migrations: ${String(erro)}\n`);
  process.exitCode = 1;
});
