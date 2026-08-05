/**
 * Imutabilidade e retificação de entrevistas (migration 0030).
 *
 * Roda contra o banco real, como `resolucaoIntencao.spec.ts` — o que está
 * sendo testado são TRIGGERS e um ÍNDICE ÚNICO. Um teste com mock provaria
 * que o mock funciona.
 *
 * Este é o teste que segura o risco mais grave do plano: uma entrevista
 * retificada vira DUAS linhas na tabela base, e qualquer agregado que não
 * filtre `vigente` conta dobrado. Uma projeção 10% acima da realidade no dia
 * da apuração é o pior defeito imaginável neste sistema.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Client } from 'pg';

import { resolve as resolverCaminho } from 'node:path';
import { fileURLToPath as paraCaminho } from 'node:url';
import { config as carregarEnvDaRaiz } from 'dotenv';

carregarEnvDaRaiz({
  path: resolverCaminho(paraCaminho(new URL('.', import.meta.url)), '../../../.env'),
});

const URL_BANCO = process.env['BANCO_URL'];

let cliente: Client;

const criados = {
  organizacao: '',
  campanha: '',
  cargo: '',
  usuario: '',
  bairro: '',
  logradouro: '',
  domicilio: '',
  entrevistado: '',
  entrevista: '',
};

describe.skipIf(!URL_BANCO)('imutabilidade e retificação de entrevistas', () => {
  beforeAll(async () => {
    cliente = new Client({ connectionString: URL_BANCO });
    await cliente.connect();

    await cliente.query('begin');
    for (const tabela of [
      'intencoes_voto',
      'entrevistas',
      'entrevistados',
      'candidatos',
      'campanhas',
      'organizacoes',
      'usuarios',
      'domicilios',
      'logradouros',
      'bairros',
      'consentimentos',
    ]) {
      await cliente.query(`alter table public.${tabela} no force row level security`);
    }

    const { rows: plano } = await cliente.query<{ id: string }>(
      'select id from public.planos limit 1',
    );
    const { rows: org } = await cliente.query<{ id: string }>(
      `insert into public.organizacoes (nome, id_plano, status)
       values ('Teste imutabilidade', $1, 'ATIVA') returning id`,
      [plano[0]!.id],
    );
    criados.organizacao = org[0]!.id;

    await cliente.query('select public.semear_perfis_organizacao($1)', [criados.organizacao]);
    const { rows: perfil } = await cliente.query<{ id: string }>(
      'select id from public.perfis_acesso where id_organizacao = $1 limit 1',
      [criados.organizacao],
    );

    const { rows: camp } = await cliente.query<{ id: string }>(
      `insert into public.campanhas (id_organizacao, nome, abrangencia, uf, ano_pleito)
       values ($1, 'Campanha de teste', 'ESTADUAL', 'CE', 2026) returning id`,
      [criados.organizacao],
    );
    criados.campanha = camp[0]!.id;

    const { rows: cargo } = await cliente.query<{ id: string }>(
      `select id from public.cargos where nome = 'Senador'`,
    );
    criados.cargo = cargo[0]!.id;

    const { rows: usuario } = await cliente.query<{ id: string }>(
      `insert into public.usuarios (id, id_organizacao, id_perfil, nome, email)
       values (gen_random_uuid(), $1, $2, 'Entrevistador de teste', $3) returning id`,
      [criados.organizacao, perfil[0]!.id, `teste-imutabilidade-${Date.now()}@exemplo.invalido`],
    );
    criados.usuario = usuario[0]!.id;

    // `municipios`/`estados` só existem depois de `pnpm ibge:sincronizar` — que
    // roda no banco de desenvolvimento, mas não no banco efêmero do CI. `on
    // conflict do nothing` cobre os dois casos: cria a referência quando falta,
    // e não sobrescreve quando o dado real do IBGE já está lá.
    await cliente.query(
      `insert into public.estados (id_ibge, sigla, nome, regiao)
       values (23, 'CE', 'Ceará', 'Nordeste') on conflict (id_ibge) do nothing`,
    );
    await cliente.query(
      `insert into public.municipios (id_ibge, id_estado, nome)
       values (2304400, 23, 'Fortaleza') on conflict (id_ibge) do nothing`,
    );

    const { rows: bairro } = await cliente.query<{ id: string }>(
      `insert into public.bairros (id_organizacao, id_municipio, nome, origem)
       values ($1, 2304400, 'Bairro de teste', 'USUARIO') returning id`,
      [criados.organizacao],
    );
    criados.bairro = bairro[0]!.id;

    const { rows: logradouro } = await cliente.query<{ id: string }>(
      `insert into public.logradouros (id_organizacao, id_bairro, nome, nome_canonico)
       values ($1, $2, 'Rua de teste', 'rua de teste') returning id`,
      [criados.organizacao, criados.bairro],
    );
    criados.logradouro = logradouro[0]!.id;

    const { rows: domicilio } = await cliente.query<{ id: string }>(
      `insert into public.domicilios
         (id_organizacao, id_campanha, id_logradouro, id_bairro, numero, numero_normalizado,
          id_usuario_cadastro)
       values ($1, $2, $3, $4, '10', '10', $5) returning id`,
      [criados.organizacao, criados.campanha, criados.logradouro, criados.bairro, criados.usuario],
    );
    criados.domicilio = domicilio[0]!.id;

    const { rows: entrevistado } = await cliente.query<{ id: string }>(
      `insert into public.entrevistados
         (id_organizacao, id_campanha, nome, id_usuario_cadastro, id_domicilio)
       values ($1, $2, 'Eleitor de Teste', $3, $4) returning id`,
      [criados.organizacao, criados.campanha, criados.usuario, criados.domicilio],
    );
    criados.entrevistado = entrevistado[0]!.id;

    // Consentimento vigente: sem ele, `validar_conclusao_entrevista` (0007)
    // recusa a transição para CONCLUIDA, e o teste nem chegaria ao que importa.
    const { rows: versaoTermo } = await cliente.query<{ id: string }>(
      `insert into public.versoes_consentimento (id_organizacao, versao, texto, finalidade)
       values ($1, '1', 'texto do termo', 'pesquisa eleitoral') returning id`,
      [criados.organizacao],
    );
    await cliente.query(
      `insert into public.consentimentos
         (id_organizacao, id_campanha, id_entrevistado, id_versao_consentimento, versao_texto,
          finalidade, canal, id_usuario_coletor)
       values ($1, $2, $3, $4, 'texto do termo', 'pesquisa eleitoral', 'VERBAL_REGISTRADO', $5)`,
      [
        criados.organizacao,
        criados.campanha,
        criados.entrevistado,
        versaoTermo[0]!.id,
        criados.usuario,
      ],
    );

    const { rows: entrevista } = await cliente.query<{ id: string }>(
      `insert into public.entrevistas
         (id_organizacao, id_campanha, id_entrevistado, id_usuario_entrevistador, status,
          recusou_responder)
       values ($1, $2, $3, $4, 'RASCUNHO', true) returning id`,
      [criados.organizacao, criados.campanha, criados.entrevistado, criados.usuario],
    );
    criados.entrevista = entrevista[0]!.id;
  });

  afterAll(async () => {
    if (!cliente) return;
    /*
     * O expurgo deste teste esbarra na própria trigger que ele acabou de
     * provar: `entrevistas_impedir_exclusao` bloqueia o DELETE em cascata que
     * vem de apagar a organização, porque a entrevista de teste está
     * CONCLUIDA. É o comportamento CORRETO — o comentário da migration 0030
     * já avisa que expurgo de verdade precisa de um `set local` explícito, e
     * "isso é bom: expurgo deve doer".
     *
     * `session_replication_role = replica` desliga os triggers (não a RLS) só
     * nesta sessão, só para esta limpeza de dado de teste.
     */
    await cliente.query('set local session_replication_role = replica');
    await cliente.query('delete from public.organizacoes where id = $1', [criados.organizacao]);
    await cliente.query('set local session_replication_role = default');
    for (const tabela of [
      'intencoes_voto',
      'entrevistas',
      'entrevistados',
      'candidatos',
      'campanhas',
      'organizacoes',
      'usuarios',
      'domicilios',
      'logradouros',
      'bairros',
      'consentimentos',
    ]) {
      await cliente.query(`alter table public.${tabela} force row level security`);
    }
    await cliente.query('commit');
    await cliente.end();
  });

  /** Roda algo que DEVE falhar, sem envenenar a transação do arquivo inteiro. */
  async function esperarErro(trabalho: () => Promise<unknown>, padrao: RegExp): Promise<void> {
    await cliente.query('savepoint caso');
    let mensagem: string | null = null;
    try {
      await trabalho();
    } catch (erro) {
      mensagem = erro instanceof Error ? erro.message : String(erro);
    }
    await cliente.query('rollback to savepoint caso');
    expect(mensagem, 'esperava erro, e a operação passou').not.toBeNull();
    expect(mensagem).toMatch(padrao);
  }

  it('RASCUNHO libera tudo — a sincronização offline continua funcionando', async () => {
    // É exatamente o que sincronizacaoOffline.service.ts faz: insere RASCUNHO,
    // insere intenções, e só então muda o status. O mecanismo não pode quebrar
    // essa sequência.
    await expect(
      cliente.query(`update public.entrevistas set status = 'CONCLUIDA' where id = $1`, [
        criados.entrevista,
      ]),
    ).resolves.toBeDefined();
  });

  it('UPDATE de conteúdo em entrevista concluída é recusado', async () => {
    await esperarErro(
      () =>
        cliente.query(`update public.entrevistas set observacoes = 'alterado' where id = $1`, [
          criados.entrevista,
        ]),
      /não pode ser alterada/i,
    );
  });

  it('DELETE de entrevista concluída é recusado', async () => {
    await esperarErro(
      () => cliente.query('delete from public.entrevistas where id = $1', [criados.entrevista]),
      /não pode ser excluída/i,
    );
  });

  it('INSERT de intenção numa entrevista concluída é recusado', async () => {
    // O caso que fecharia a porta dos fundos: sem bloquear INSERT (e não só
    // UPDATE/DELETE), daria para acrescentar voto a uma entrevista já
    // concluída sem passar pela retificação.
    await esperarErro(
      () =>
        cliente.query(
          `insert into public.intencoes_voto
             (id_organizacao, id_campanha, id_entrevista, id_cargo, numero_declarado)
           values ($1, $2, $3, $4, '133')`,
          [criados.organizacao, criados.campanha, criados.entrevista, criados.cargo],
        ),
      /não pode ter intenção/i,
    );
  });

  it('transição de status para trás (CONCLUIDA→RASCUNHO) é recusada', async () => {
    await esperarErro(
      () =>
        cliente.query(`update public.entrevistas set status = 'RASCUNHO' where id = $1`, [
          criados.entrevista,
        ]),
      /não pode voltar/i,
    );
  });

  describe('retificação — a cadeia de versões', () => {
    let idNova = '';

    it('cria a versão 2 como RASCUNHO, vinculada ao original', async () => {
      const { rows } = await cliente.query<{ id: string }>(
        `insert into public.entrevistas
           (id_organizacao, id_campanha, id_entrevistado, id_usuario_entrevistador, status,
            recusou_responder, versao, id_entrevista_original, vigente, motivo_retificacao,
            id_usuario_retificador)
         values ($1, $2, $3, $4, 'RASCUNHO', true, 2, $5, false,
                 'corrigi um erro de digitação no nome', $4)
         returning id`,
        [
          criados.organizacao,
          criados.campanha,
          criados.entrevistado,
          criados.usuario,
          criados.entrevista,
        ],
      );
      idNova = rows[0]!.id;
      expect(idNova).toBeTruthy();
    });

    it('versão nova (RASCUNHO) conclui normalmente', async () => {
      await expect(
        cliente.query(`update public.entrevistas set status = 'CONCLUIDA' where id = $1`, [idNova]),
      ).resolves.toBeDefined();
    });

    it('troca de vigente entre as versões passa — são campos livres', async () => {
      await cliente.query(
        'update public.entrevistas set vigente = false, id_entrevista_substituta = $2 where id = $1',
        [criados.entrevista, idNova],
      );
      await expect(
        cliente.query('update public.entrevistas set vigente = true where id = $1', [idNova]),
      ).resolves.toBeDefined();
    });

    it('o índice único recusa DUAS versões vigentes na mesma cadeia', async () => {
      await esperarErro(
        () =>
          cliente.query('update public.entrevistas set vigente = true where id = $1', [
            criados.entrevista,
          ]),
        /entrevistas_vigente_idx|duplicate key/i,
      );
    });

    it('entrevistas_vigentes conta 1, não 2, para a cadeia retificada', async () => {
      // O teste que segura o build contra o pior defeito do plano inteiro.
      const { rows } = await cliente.query<{ total: string }>(
        'select count(*)::int as total from public.entrevistas_vigentes where id_entrevistado = $1',
        [criados.entrevistado],
      );
      expect(Number(rows[0]!.total)).toBe(1);
    });

    it('a tabela base tem as duas versões — nada foi perdido', async () => {
      const { rows } = await cliente.query<{ total: string }>(
        'select count(*)::int as total from public.entrevistas where id_entrevistado = $1',
        [criados.entrevistado],
      );
      expect(Number(rows[0]!.total)).toBe(2);
    });

    it('versão >= 2 sem motivo_retificacao é recusada', async () => {
      await esperarErro(
        () =>
          cliente.query(
            `insert into public.entrevistas
               (id_organizacao, id_campanha, id_entrevistado, id_usuario_entrevistador, status,
                recusou_responder, versao, id_entrevista_original, vigente)
             values ($1, $2, $3, $4, 'RASCUNHO', true, 2, $5, false)`,
            [
              criados.organizacao,
              criados.campanha,
              criados.entrevistado,
              criados.usuario,
              criados.entrevista,
            ],
          ),
        /entrevistas_motivo_retificacao_check|check constraint/i,
      );
    });
  });
});
