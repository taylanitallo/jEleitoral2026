/**
 * `pnpm banco:diagnosticar`
 *
 * Diz o que o banco REALMENTE tem, e não o que o registro afirma.
 *
 * Existe por um desencontro concreto: o banco de produção tinha o esquema
 * bem à frente de `manutencao.migrations_aplicadas`, porque em algum momento
 * migrations foram aplicadas por um caminho que não registrava. A aplicação
 * normal então abortava em "already exists", uma migration por vez — e
 * descobrir até onde o esquema ia custava uma execução de CI a cada tentativa.
 *
 * Roda ANTES de aplicar, em todo deploy. Quando dá tudo certo, é uma linha de
 * log; quando não dá, é a diferença entre uma tentativa e oito.
 */
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readdir } from 'node:fs/promises';
import { config } from 'dotenv';
import { Client } from 'pg';
import { numeroDaMigration } from '../src/comum/ordemMigrations.js';

// O `.env` mora na RAIZ do monorepo, não neste diretório.
config({ path: resolve(fileURLToPath(new URL('.', import.meta.url)), '../../../.env') });

const DIRETORIO_MIGRATIONS = resolve(
  fileURLToPath(new URL('.', import.meta.url)),
  '../../../infra/supabase/migrations',
);

/**
 * Objeto que prova que a migration rodou.
 *
 * Mapa explícito, e não dedução a partir do SQL: um `create table` dentro de um
 * `do $$` ou atrás de um `if not exists` enganaria qualquer heurística, e um
 * diagnóstico que erra é pior que nenhum — ele autoriza pular uma migration que
 * não foi aplicada.
 *
 * Só as migrations a partir da 0017 estão aqui; as anteriores são a base que
 * todo ambiente tem desde a criação.
 */
const SENTINELA: Record<number, { tipo: 'tabela' | 'coluna' | 'funcao'; alvo: string }> = {
  18: { tipo: 'tabela', alvo: 'public.bairros' },
  19: { tipo: 'tabela', alvo: 'public.perfis_padrao' },
  20: { tipo: 'tabela', alvo: 'public.ativistas' },
  21: { tipo: 'tabela', alvo: 'public.atividades' },
  22: { tipo: 'tabela', alvo: 'public.areas_estrategicas' },
  23: { tipo: 'tabela', alvo: 'public.diagnosticos' },
  24: { tipo: 'coluna', alvo: 'usos_ia.provedor' },
  25: { tipo: 'tabela', alvo: 'public.planejamentos' },
  26: { tipo: 'tabela', alvo: 'public.publicacoes' },
  27: { tipo: 'coluna', alvo: 'usuarios.claims_invalidos_apos' },
};

async function existe(
  cliente: Client,
  sentinela: { tipo: 'tabela' | 'coluna' | 'funcao'; alvo: string },
): Promise<boolean> {
  if (sentinela.tipo === 'tabela') {
    const { rows } = await cliente.query<{ ok: string | null }>(
      'select to_regclass($1)::text as ok',
      [sentinela.alvo],
    );
    return rows[0]?.ok !== null;
  }

  if (sentinela.tipo === 'funcao') {
    const { rows } = await cliente.query<{ ok: string | null }>(
      'select to_regproc($1)::text as ok',
      [sentinela.alvo],
    );
    return rows[0]?.ok !== null;
  }

  const [tabela, coluna] = sentinela.alvo.split('.');
  const { rows } = await cliente.query<{ total: string }>(
    `select count(*)::text as total from information_schema.columns
      where table_schema = 'public' and table_name = $1 and column_name = $2`,
    [tabela, coluna],
  );
  return Number(rows[0]?.total ?? 0) > 0;
}

async function principal(): Promise<void> {
  const urlBanco = process.env.BANCO_URL;
  if (!urlBanco) throw new Error('Defina BANCO_URL.');

  const cliente = new Client({ connectionString: urlBanco });
  await cliente.connect();

  try {
    const registrado = new Set<string>();
    const { rows: existeRegistro } = await cliente.query<{ ok: string | null }>(
      "select to_regclass('manutencao.migrations_aplicadas')::text as ok",
    );
    if (existeRegistro[0]?.ok !== null) {
      const { rows } = await cliente.query<{ arquivo: string }>(
        'select arquivo from manutencao.migrations_aplicadas',
      );
      for (const linha of rows) registrado.add(linha.arquivo);
    }

    const arquivos = (await readdir(DIRETORIO_MIGRATIONS))
      .filter((nome) => nome.endsWith('.sql'))
      .sort();

    process.stdout.write(
      `Registro conhece ${registrado.size} de ${arquivos.length} migrations.\n\n`,
    );

    /*
     * A divergência que interessa: o esquema tem o objeto, mas o registro não
     * sabe. É exatamente essa lista que `--adotar-ate` precisa cobrir, e o
     * maior número dela é o valor a informar.
     */
    let maiorDivergencia = 0;
    for (const arquivo of arquivos) {
      const numero = numeroDaMigration(arquivo);
      const sentinela = SENTINELA[numero];
      const noRegistro = registrado.has(arquivo);

      if (!sentinela) {
        process.stdout.write(`  ${noRegistro ? 'registrada' : 'PENDENTE  '}  ${arquivo}\n`);
        continue;
      }

      const noEsquema = await existe(cliente, sentinela);
      let situacao: string;
      if (noRegistro && noEsquema) situacao = 'ok        ';
      else if (!noRegistro && noEsquema) {
        situacao = 'DIVERGE   ';
        maiorDivergencia = Math.max(maiorDivergencia, numero);
      } else if (noRegistro && !noEsquema) situacao = 'REGISTRO SEM ESQUEMA';
      else situacao = 'pendente  ';

      process.stdout.write(`  ${situacao}  ${arquivo}  (${sentinela.alvo})\n`);
    }

    if (maiorDivergencia > 0) {
      const rotulo = String(maiorDivergencia).padStart(4, '0');
      process.stdout.write(
        `\nO esquema esta a frente do registro ate a ${rotulo}.\n` +
          `Para alinhar sem reexecutar: --adotar-ate=${rotulo}\n`,
      );
    }
  } finally {
    await cliente.end();
  }
}

principal().catch((erro: unknown) => {
  process.stderr.write(`Falha ao diagnosticar: ${String(erro)}\n`);
  process.exitCode = 1;
});
