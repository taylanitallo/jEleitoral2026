/**
 * Cobertura de RLS.
 *
 * Este teste é a rede de segurança do requisito central do produto: nenhum
 * cliente pode enxergar dado de outro. Ele não testa comportamento — testa
 * ESTRUTURA. Se alguém acrescentar uma tabela de dados e esquecer a política,
 * a falha aparece aqui, no CI, e não em produção com dois clientes adversários
 * no mesmo banco.
 *
 * Quebra o build quando uma tabela de `public`:
 *   • não tem `id_organizacao`;
 *   • não tem RLS habilitada;
 *   • não tem `FORCE ROW LEVEL SECURITY`;
 *   • não tem nenhuma política.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Client } from 'pg';

import { resolve as resolverCaminho } from 'node:path';
import { fileURLToPath as paraCaminho } from 'node:url';
import { config as carregarEnvDaRaiz } from 'dotenv';

// O .env mora na RAIZ do monorepo, e o vitest roda com cwd em apps/api. No CI
// as variaveis ja vem do ambiente e o arquivo nao existe — o dotenv nao faz
// nada, sem erro.
carregarEnvDaRaiz({ path: resolverCaminho(paraCaminho(new URL('.', import.meta.url)), '../../../.env') });

/**
 * Tabelas de REFERÊNCIA: dado público do IBGE e do TSE, igual para todos os
 * clientes, sem `id_organizacao` por natureza. Continuam exigindo RLS e
 * política (de leitura), mas são dispensadas da coluna de tenant.
 *
 * Acrescentar nome a esta lista é uma decisão consciente de arquitetura. Se a
 * tabela guarda qualquer coisa produzida pelo cliente, ela NÃO pertence aqui.
 */
const TABELAS_DE_REFERENCIA = new Set([
  'estados',
  'municipios',
  'distritos',
  'subdistritos',
  'cache_cep',
  'zonas_eleitorais',
  'locais_votacao',
  'secoes_eleitorais',
  'eleitorado_secao',
  'resultados_oficiais',
  'partidos',
  'federacoes',
  'federacao_partidos',
  'cargos',
  'permissoes',
  'planos',
  'boletins_apuracao',
  // Catálogo dos perfis-padrão, igual para todas as organizações. Saiu de um
  // literal jsonb dentro de `semear_perfis_organizacao` e virou dado na 0019,
  // para cada módulo novo não precisar reescrever a função inteira.
  'perfis_padrao',
  'perfil_permissao_padrao',
]);

/**
 * Tabelas com isolamento por vínculo, não por coluna própria: a política checa
 * a existência da linha-pai, que por sua vez é isolada. Mantidas à parte para
 * que a exceção seja explícita e revisável.
 */
const TABELAS_ISOLADAS_POR_VINCULO = new Set([
  'perfil_permissoes',
  // A própria tabela de tenants: seu `id` É o `id_organizacao`. Exigir a coluna
  // aqui seria pedir que a organização apontasse para si mesma.
  'organizacoes',
]);

interface LinhaTabela {
  nome: string;
  rls_habilitada: boolean;
  rls_forcada: boolean;
  qtd_politicas: number;
  tem_id_organizacao: boolean;
}

let cliente: Client;
let tabelas: LinhaTabela[];

beforeAll(async () => {
  const urlBanco = process.env.BANCO_URL;
  if (!urlBanco) {
    throw new Error(
      'BANCO_URL não definida. O teste de cobertura de RLS precisa de um PostgreSQL real: ' +
        'verificar política de segurança contra mock não prova nada.',
    );
  }
  cliente = new Client({ connectionString: urlBanco });
  await cliente.connect();

  const resultado = await cliente.query<LinhaTabela>(`
    select
      c.relname as nome,
      c.relrowsecurity as rls_habilitada,
      c.relforcerowsecurity as rls_forcada,
      (select count(*) from pg_policy p where p.polrelid = c.oid)::int as qtd_politicas,
      exists (
        select 1 from pg_attribute a
        where a.attrelid = c.oid and a.attname = 'id_organizacao' and a.attnum > 0
          and not a.attisdropped
      ) as tem_id_organizacao
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public'
      and c.relkind = 'r'
    order by c.relname
  `);
  tabelas = resultado.rows;
});

afterAll(async () => {
  await cliente?.end();
});

describe('cobertura de RLS no esquema public', () => {
  it('encontra tabelas para verificar', () => {
    // Guarda contra o falso verde: se as migrations não rodaram, a lista vem
    // vazia e todos os testes abaixo passariam sem verificar nada.
    expect(tabelas.length).toBeGreaterThan(20);
  });

  it('todas as tabelas têm ROW LEVEL SECURITY habilitada', () => {
    const semRls = tabelas.filter((t) => !t.rls_habilitada).map((t) => t.nome);
    expect(semRls, `Tabelas sem RLS: ${semRls.join(', ')}`).toEqual([]);
  });

  it('todas as tabelas têm FORCE ROW LEVEL SECURITY', () => {
    // Sem o FORCE, o dono da tabela ignora as políticas — e migrations e jobs
    // rodam como dono. É a brecha mais fácil de abrir sem perceber.
    const semForce = tabelas.filter((t) => !t.rls_forcada).map((t) => t.nome);
    expect(semForce, `Tabelas sem FORCE ROW LEVEL SECURITY: ${semForce.join(', ')}`).toEqual([]);
  });

  it('todas as tabelas têm ao menos uma política', () => {
    // RLS habilitada sem política nenhuma nega tudo — o que não quebra a
    // segurança, mas quebra o sistema silenciosamente.
    const semPolitica = tabelas.filter((t) => t.qtd_politicas === 0).map((t) => t.nome);
    expect(semPolitica, `Tabelas sem política: ${semPolitica.join(', ')}`).toEqual([]);
  });

  it('todas as tabelas de dados têm id_organizacao', () => {
    const semTenant = tabelas
      .filter(
        (t) =>
          !t.tem_id_organizacao &&
          !TABELAS_DE_REFERENCIA.has(t.nome) &&
          !TABELAS_ISOLADAS_POR_VINCULO.has(t.nome),
      )
      .map((t) => t.nome);
    expect(
      semTenant,
      `Tabelas de dados sem id_organizacao: ${semTenant.join(', ')}. ` +
        'Acrescente a coluna ou justifique a exceção na lista de referência.',
    ).toEqual([]);
  });

  it('toda tabela com id_organizacao tem índice começando por essa coluna', async () => {
    // Política que filtra por `id_organizacao` sem índice adequado transforma
    // cada consulta em varredura completa assim que a base cresce.
    const { rows } = await cliente.query<{ nome: string }>(`
      select c.relname as nome
      from pg_class c
      join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public'
        and c.relkind = 'r'
        and exists (
          select 1 from pg_attribute a
          where a.attrelid = c.oid and a.attname = 'id_organizacao'
            and a.attnum > 0 and not a.attisdropped
        )
        and not exists (
          select 1
          from pg_index i
          join pg_attribute a
            on a.attrelid = c.oid and a.attnum = i.indkey[0]
          where i.indrelid = c.oid and a.attname = 'id_organizacao'
        )
      order by c.relname
    `);
    const semIndice = rows.map((r) => r.nome);
    expect(
      semIndice,
      `Tabelas com id_organizacao sem índice liderado por ela: ${semIndice.join(', ')}`,
    ).toEqual([]);
  });

  it('a trilha de auditoria não admite alteração nem exclusão por ninguém', async () => {
    const { rows } = await cliente.query<{ cmd: string }>(`
      select case p.polcmd
               when 'w' then 'UPDATE' when 'd' then 'DELETE' when '*' then 'ALL'
               else p.polcmd::text end as cmd
      from pg_policy p
      join pg_class c on c.oid = p.polrelid
      where c.relname = 'logs_auditoria'
        and p.polcmd in ('w', 'd', '*')
    `);
    expect(
      rows.map((r) => r.cmd),
      'A trilha de auditoria precisa ser imutável — inclusive para o administrador.',
    ).toEqual([]);
  });
});
