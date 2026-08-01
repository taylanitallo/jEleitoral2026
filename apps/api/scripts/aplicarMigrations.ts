/**
 * Aplica as migrations em ordem, dentro de uma única transação.
 *
 * Usado pelo CI (contra um PostgreSQL descartável) e pelo ambiente local. Em
 * produção quem aplica é `supabase db push` no pipeline — nunca alguém rodando
 * SQL à mão no painel.
 */
import { readFile, readdir } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { Client } from 'pg';

const DIRETORIO_MIGRATIONS = resolve(
  new URL('.', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'),
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
    await cliente.query('begin');
    for (const arquivo of arquivos) {
      const sql = await readFile(join(DIRETORIO_MIGRATIONS, arquivo), 'utf8');
      process.stdout.write(`→ ${arquivo}\n`);
      await cliente.query(sql);
    }
    await cliente.query('commit');
    process.stdout.write(`\n${arquivos.length} migration(s) aplicada(s) com sucesso.\n`);
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
