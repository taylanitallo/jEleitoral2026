/**
 * Aplica as migrations pendentes em ordem, dentro de uma única transação.
 *
 * Usado pelo CI (contra um PostgreSQL descartável) e pelo ambiente local. Em
 * produção quem aplica é `supabase db push` no pipeline — nunca alguém rodando
 * SQL à mão no painel.
 *
 * O que já foi aplicado fica registrado em `public.migrations_aplicadas`. Sem
 * esse controle, rodar duas vezes falhava em `type "escopo_permissao" already
 * exists` — e a única saída era recriar o banco, o que num ambiente com dados
 * de campo não é saída nenhuma.
 */
// Lê o `.env` local quando existir. No CI e em produção as variáveis já vêm do
// ambiente e o arquivo não existe — o dotenv não faz nada, sem erro.
import 'dotenv/config';
import { readFile, readdir } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Client } from 'pg';

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
    await cliente.query(`
      create table if not exists public.migrations_aplicadas (
        arquivo text primary key,
        aplicada_em timestamptz not null default now()
      )
    `);

    const { rows } = await cliente.query<{ arquivo: string }>(
      'select arquivo from public.migrations_aplicadas',
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
        (arquivo) => arquivo.localeCompare(limite) <= 0 && !jaAplicadas.has(arquivo),
      );
      for (const arquivo of adotadas) {
        await cliente.query(
          'insert into public.migrations_aplicadas (arquivo) values ($1) on conflict do nothing',
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
      await cliente.query('insert into public.migrations_aplicadas (arquivo) values ($1)', [
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
