/**
 * Isolamento cruzado — os dois níveis exigidos pelo escopo.
 *
 *  (a) usuário da organização A tentando LER, ESCREVER e EXCLUIR dados da
 *      organização B;
 *  (b) usuário da campanha X tentando acessar a campanha Y DENTRO da mesma
 *      organização;
 *  (c) escopo por perfil: entrevistador não enxerga a coleta de outro
 *      entrevistador.
 *
 * O teste roda contra um PostgreSQL real e sob um papel NÃO-superusuário.
 * Isso é essencial: superusuário ignora RLS mesmo com FORCE, então executar
 * como `postgres` produziria um verde que não significa nada.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Client } from 'pg';
import { randomUUID } from 'node:crypto';

import { resolve as resolverCaminho } from 'node:path';
import { fileURLToPath as paraCaminho } from 'node:url';
import { config as carregarEnvDaRaiz } from 'dotenv';

// O .env mora na RAIZ do monorepo, e o vitest roda com cwd em apps/api. No CI
// as variaveis ja vem do ambiente e o arquivo nao existe — o dotenv nao faz
// nada, sem erro.
carregarEnvDaRaiz({
  path: resolverCaminho(paraCaminho(new URL('.', import.meta.url)), '../../../.env'),
});

const PAPEL_TESTE = 'testador_rls';

const orgA = randomUUID();
const orgB = randomUUID();
const campanhaA1 = randomUUID();
const campanhaA2 = randomUUID();
const campanhaB1 = randomUUID();
const usuarioA1 = randomUUID();
const usuarioA2 = randomUUID();
const usuarioB1 = randomUUID();
const bairroA1 = randomUUID();
const bairroA2 = randomUUID();
const bairroB1 = randomUUID();

let cliente: Client;

const PERMISSOES_AMPLAS = {
  'territorio.ler': 'CAMPANHA',
  'territorio.gerenciar': 'CAMPANHA',
  'campo.ler': 'CAMPANHA',
  'campo.gerenciar': 'CAMPANHA',
};

const PERMISSOES_ENTREVISTADOR = {
  'territorio.ler': 'TERRITORIO',
  'campo.ler': 'PROPRIO',
  'campo.gerenciar': 'PROPRIO',
};

/** Assume a identidade de um usuário: papel não privilegiado + claims do JWT. */
async function autenticarComo(claims: Record<string, unknown>): Promise<void> {
  await cliente.query('reset role');
  await cliente.query('select set_config($1, $2, false)', [
    'request.jwt.claims',
    JSON.stringify(claims),
  ]);
  await cliente.query(`set role ${PAPEL_TESTE}`);
}

async function comoAdministradorDoBanco(): Promise<void> {
  await cliente.query('reset role');
  await cliente.query('select set_config($1, $2, false)', ['request.jwt.claims', '{}']);
}

beforeAll(async () => {
  const urlBanco = process.env.BANCO_URL;
  if (!urlBanco) {
    throw new Error('BANCO_URL não definida. O teste de isolamento exige um PostgreSQL real.');
  }
  cliente = new Client({ connectionString: urlBanco });
  await cliente.connect();

  // Papel sem privilégios especiais: é o único jeito de a RLS realmente valer.
  await cliente.query(`
    do $$
    begin
      if not exists (select 1 from pg_roles where rolname = '${PAPEL_TESTE}') then
        create role ${PAPEL_TESTE} nologin nosuperuser nobypassrls;
      end if;
    end;
    $$;
  `);
  // No Supabase o usuário `postgres` NÃO é superusuário: só consegue assumir um
  // papel do qual é membro. Sem esta concessão o `set role` falha com
  // "permission denied", e o teste inteiro deixa de exercitar a RLS.
  await cliente.query(`grant ${PAPEL_TESTE} to current_user`);
  await cliente.query(
    `grant usage on schema public, autenticacao, catalogo, provedor to ${PAPEL_TESTE}`,
  );
  await cliente.query(
    `grant select, insert, update, delete on all tables in schema public to ${PAPEL_TESTE}`,
  );
  await cliente.query(`grant execute on all functions in schema autenticacao to ${PAPEL_TESTE}`);
  await cliente.query(`grant execute on all functions in schema public to ${PAPEL_TESTE}`);

  // --- Semente (como administrador do banco, antes de assumir o papel) -------
  await cliente.query(`
    insert into public.estados (id_ibge, sigla, nome, regiao)
    values (35, 'SP', 'São Paulo', 'Sudeste') on conflict do nothing;
    insert into public.municipios (id_ibge, id_estado, nome)
    values (3550308, 35, 'São Paulo') on conflict do nothing;
  `);

  const { rows: planos } = await cliente.query<{ id: string }>(
    `select id from public.planos order by valor_mensal limit 1`,
  );
  const idPlano = planos[0]?.id;
  if (!idPlano) throw new Error('Semente de planos ausente — rode as migrations antes.');

  for (const [id, nome] of [
    [orgA, 'Organização A'],
    [orgB, 'Organização B'],
  ] as const) {
    await cliente.query(
      `insert into public.organizacoes (id, nome, id_plano) values ($1, $2, $3)`,
      [id, nome, idPlano],
    );
    await cliente.query(`select public.semear_perfis_organizacao($1)`, [id]);
  }

  for (const [id, org, nome] of [
    [campanhaA1, orgA, 'A — Deputado Federal'],
    [campanhaA2, orgA, 'A — Governador'],
    [campanhaB1, orgB, 'B — Deputado Estadual'],
  ] as const) {
    await cliente.query(
      `insert into public.campanhas (id, id_organizacao, nome, abrangencia, uf, ano_pleito)
       values ($1, $2, $3, 'ESTADUAL', 'SP', 2026)`,
      [id, org, nome],
    );
  }

  for (const [id, org, nome, email] of [
    [usuarioA1, orgA, 'Usuário A1', 'a1@teste.local'],
    [usuarioA2, orgA, 'Usuário A2', 'a2@teste.local'],
    [usuarioB1, orgB, 'Usuário B1', 'b1@teste.local'],
  ] as const) {
    const { rows } = await cliente.query<{ id: string }>(
      `select id from public.perfis_acesso where id_organizacao = $1 and nome = 'ADMINISTRADOR'`,
      [org],
    );
    await cliente.query(
      `insert into public.usuarios (id, id_organizacao, nome, email, id_perfil)
       values ($1, $2, $3, $4, $5)`,
      [id, org, nome, email, rows[0]?.id],
    );
  }

  for (const [id, org, campanha, nome] of [
    [bairroA1, orgA, campanhaA1, 'Centro (A1)'],
    [bairroA2, orgA, campanhaA2, 'Centro (A2)'],
    [bairroB1, orgB, campanhaB1, 'Centro (B1)'],
  ] as const) {
    await cliente.query(
      `insert into public.bairros (id, id_organizacao, id_campanha, id_municipio, nome, validado)
       values ($1, $2, $3, 3550308, $4, true)`,
      [id, org, campanha, nome],
    );
  }
});

afterAll(async () => {
  if (!cliente) return;
  await comoAdministradorDoBanco();
  await cliente.query(`delete from public.organizacoes where id = any($1::uuid[])`, [[orgA, orgB]]);
  await cliente.end();
});

// =============================================================================
// (a) Isolamento entre organizações
// =============================================================================

describe('isolamento entre organizações', () => {
  const claimsA1 = () => ({
    sub: usuarioA1,
    id_organizacao: orgA,
    campanhas: [campanhaA1],
    permissoes: PERMISSOES_AMPLAS,
  });

  it('lê apenas os bairros da própria organização e campanha', async () => {
    await autenticarComo(claimsA1());
    const { rows } = await cliente.query<{ id: string }>('select id from public.bairros');
    const ids = rows.map((r) => r.id);
    expect(ids).toContain(bairroA1);
    expect(ids).not.toContain(bairroB1);
  });

  it('não lê um bairro de outra organização nem pelo identificador exato', async () => {
    await autenticarComo(claimsA1());
    const { rows } = await cliente.query('select id from public.bairros where id = $1', [bairroB1]);
    // A linha existe no banco; a RLS a torna inexistente para este usuário.
    expect(rows).toHaveLength(0);
  });

  it('não consegue INSERIR carimbando a organização alheia', async () => {
    await autenticarComo(claimsA1());
    await expect(
      cliente.query(
        `insert into public.bairros (id_organizacao, id_campanha, id_municipio, nome)
         values ($1, $2, 3550308, 'Invasão')`,
        [orgB, campanhaB1],
      ),
    ).rejects.toThrow(/row-level security|violates/i);
  });

  it('não consegue ALTERAR dado de outra organização', async () => {
    await autenticarComo(claimsA1());
    const resultado = await cliente.query(
      `update public.bairros set nome = 'Alterado indevidamente' where id = $1`,
      [bairroB1],
    );
    expect(resultado.rowCount).toBe(0);

    await comoAdministradorDoBanco();
    const { rows } = await cliente.query<{ nome: string }>(
      'select nome from public.bairros where id = $1',
      [bairroB1],
    );
    expect(rows[0]?.nome).toBe('Centro (B1)');
  });

  it('não consegue EXCLUIR dado de outra organização', async () => {
    await autenticarComo(claimsA1());
    const resultado = await cliente.query('delete from public.bairros where id = $1', [bairroB1]);
    expect(resultado.rowCount).toBe(0);

    await comoAdministradorDoBanco();
    const { rows } = await cliente.query('select 1 from public.bairros where id = $1', [bairroB1]);
    expect(rows).toHaveLength(1);
  });

  it('um token sem organização não enxerga nada', async () => {
    // Cenário do usuário do backoffice sem autorização de suporte vigente.
    await autenticarComo({ sub: randomUUID(), perfil_provedor: 'SUPORTE_PROVEDOR' });
    const { rows } = await cliente.query('select id from public.bairros');
    expect(rows).toHaveLength(0);
  });
});

// =============================================================================
// (b) Isolamento entre campanhas da MESMA organização
// =============================================================================

describe('isolamento entre campanhas da mesma organização', () => {
  it('não enxerga bairro de campanha à qual o usuário não foi vinculado', async () => {
    await autenticarComo({
      sub: usuarioA1,
      id_organizacao: orgA,
      campanhas: [campanhaA1],
      permissoes: PERMISSOES_AMPLAS,
    });
    const { rows } = await cliente.query('select id from public.bairros where id = $1', [bairroA2]);
    expect(rows).toHaveLength(0);
  });

  it('passa a enxergar quando a campanha é acrescentada ao token', async () => {
    await autenticarComo({
      sub: usuarioA1,
      id_organizacao: orgA,
      campanhas: [campanhaA1, campanhaA2],
      permissoes: PERMISSOES_AMPLAS,
    });
    const { rows } = await cliente.query('select id from public.bairros where id = $1', [bairroA2]);
    expect(rows).toHaveLength(1);
  });

  it('não consegue mover um registro para outra campanha fora do seu token', async () => {
    await autenticarComo({
      sub: usuarioA1,
      id_organizacao: orgA,
      campanhas: [campanhaA1],
      permissoes: PERMISSOES_AMPLAS,
    });
    await expect(
      cliente.query('update public.bairros set id_campanha = $1 where id = $2', [
        campanhaA2,
        bairroA1,
      ]),
    ).rejects.toThrow(/row-level security|violates/i);
  });
});

// =============================================================================
// (c) Escopo por perfil dentro da MESMA campanha
// =============================================================================

describe('escopo por perfil', () => {
  const logradouro = randomUUID();
  const domicilioDeA1 = randomUUID();
  const domicilioDeA2 = randomUUID();

  beforeAll(async () => {
    await comoAdministradorDoBanco();
    await cliente.query(
      `insert into public.logradouros
         (id, id_organizacao, id_campanha, id_bairro, nome, nome_canonico, validado)
       values ($1, $2, $3, $4, 'Rua São José', 'RUA SAO JOSE', true)`,
      [logradouro, orgA, campanhaA1, bairroA1],
    );
    for (const [id, dono] of [
      [domicilioDeA1, usuarioA1],
      [domicilioDeA2, usuarioA2],
    ] as const) {
      await cliente.query(
        `insert into public.domicilios
           (id, id_organizacao, id_campanha, id_logradouro, id_bairro, numero,
            numero_normalizado, id_usuario_cadastro)
         values ($1, $2, $3, $4, $5, $6, $6, $7)`,
        [id, orgA, campanhaA1, logradouro, bairroA1, id === domicilioDeA1 ? '10' : '20', dono],
      );
    }
  });

  it('entrevistador com escopo PROPRIO vê só o que ele mesmo cadastrou', async () => {
    await autenticarComo({
      sub: usuarioA1,
      id_organizacao: orgA,
      campanhas: [campanhaA1],
      permissoes: PERMISSOES_ENTREVISTADOR,
    });
    const { rows } = await cliente.query<{ id: string }>('select id from public.domicilios');
    const ids = rows.map((r) => r.id);
    expect(ids).toContain(domicilioDeA1);
    expect(ids).not.toContain(domicilioDeA2);
  });

  it('entrevistador não altera nem exclui o registro do colega', async () => {
    await autenticarComo({
      sub: usuarioA1,
      id_organizacao: orgA,
      campanhas: [campanhaA1],
      permissoes: PERMISSOES_ENTREVISTADOR,
    });
    const alteracao = await cliente.query(
      `update public.domicilios set complemento = 'invadido' where id = $1`,
      [domicilioDeA2],
    );
    expect(alteracao.rowCount).toBe(0);

    const exclusao = await cliente.query('delete from public.domicilios where id = $1', [
      domicilioDeA2,
    ]);
    expect(exclusao.rowCount).toBe(0);
  });

  it('entrevistador não consegue inserir em nome de outro usuário', async () => {
    await autenticarComo({
      sub: usuarioA1,
      id_organizacao: orgA,
      campanhas: [campanhaA1],
      permissoes: PERMISSOES_ENTREVISTADOR,
    });
    await expect(
      cliente.query(
        `insert into public.domicilios
           (id_organizacao, id_campanha, id_logradouro, id_bairro, numero,
            numero_normalizado, id_usuario_cadastro)
         values ($1, $2, $3, $4, '30', '30', $5)`,
        [orgA, campanhaA1, logradouro, bairroA1, usuarioA2],
      ),
    ).rejects.toThrow(/row-level security|violates/i);
  });

  it('administrador com escopo CAMPANHA vê a coleta de todos', async () => {
    await autenticarComo({
      sub: usuarioA1,
      id_organizacao: orgA,
      campanhas: [campanhaA1],
      permissoes: PERMISSOES_AMPLAS,
    });
    const { rows } = await cliente.query<{ id: string }>('select id from public.domicilios');
    const ids = rows.map((r) => r.id);
    expect(ids).toContain(domicilioDeA1);
    expect(ids).toContain(domicilioDeA2);
  });

  it('sem a permissão no token, nada é visível', async () => {
    await autenticarComo({
      sub: usuarioA1,
      id_organizacao: orgA,
      campanhas: [campanhaA1],
      permissoes: {},
    });
    const { rows } = await cliente.query('select id from public.domicilios');
    expect(rows).toHaveLength(0);
  });
});
