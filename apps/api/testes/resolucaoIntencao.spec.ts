/**
 * Resolução de `numero_declarado` → `id_candidato`.
 *
 * Este teste existe por causa do defeito mais grave que o sistema teve, e ele
 * era invisível: o formulário gravava o número da urna, a projeção lia
 * `id_candidato`, e **nada resolvia um para o outro**. Toda projeção por
 * candidato devolvia zero, para toda a campanha, sem erro e sem log.
 *
 * Roda contra o banco de verdade, como `coberturaRls.spec.ts`, porque o que
 * está sendo testado é um TRIGGER. Um teste com mock provaria que o mock
 * funciona.
 *
 * Cada caso limpa o que criou: o banco de homologação tem dados de trabalho e
 * este arquivo não pode deixar lixo neles.
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

/** Identificadores criados pelo teste, para o expurgo do final. */
const criados = {
  organizacao: '',
  campanha: '',
  cargo: '',
  candidatoA: '',
  candidatoB: '',
  entrevista: '',
  entrevistado: '',
  usuario: '',
};

describe.skipIf(!URL_BANCO)('resolução de intenção de voto', () => {
  beforeAll(async () => {
    cliente = new Client({ connectionString: URL_BANCO });
    await cliente.connect();

    /*
     * O teste roda como dono da conexão, sem JWT. As políticas de RLS chamam
     * `autenticacao.pertence(...)`, que leria um token inexistente — por isso
     * `no force` durante o preparo, restaurado no final. É o mesmo cuidado que
     * a migration 0028 toma no backfill, e pelo mesmo motivo.
     */
    await cliente.query('begin');
    await cliente.query('alter table public.intencoes_voto no force row level security');
    await cliente.query('alter table public.entrevistas no force row level security');
    await cliente.query('alter table public.entrevistados no force row level security');
    await cliente.query('alter table public.candidatos no force row level security');
    await cliente.query('alter table public.campanhas no force row level security');
    await cliente.query('alter table public.organizacoes no force row level security');
    await cliente.query('alter table public.usuarios no force row level security');

    const { rows: plano } = await cliente.query<{ id: string }>(
      'select id from public.planos limit 1',
    );

    const { rows: org } = await cliente.query<{ id: string }>(
      `insert into public.organizacoes (nome, id_plano, status)
       values ('Teste resolução', $1, 'ATIVA') returning id`,
      [plano[0]!.id],
    );
    criados.organizacao = org[0]!.id;

    const { rows: camp } = await cliente.query<{ id: string }>(
      `insert into public.campanhas (id_organizacao, nome, abrangencia, uf, ano_pleito)
       values ($1, 'Campanha de teste', 'ESTADUAL', 'CE', 2026) returning id`,
      [criados.organizacao],
    );
    criados.campanha = camp[0]!.id;

    // Senador: 2 votos por eleitor. É o cargo que expõe os casos difíceis.
    const { rows: cargo } = await cliente.query<{ id: string }>(
      `select id from public.cargos where nome = 'Senador'`,
    );
    criados.cargo = cargo[0]!.id;

    const inserirCandidato = async (nome: string, numero: string): Promise<string> => {
      const { rows } = await cliente.query<{ id: string }>(
        `insert into public.candidatos
           (id_organizacao, id_campanha, id_cargo, nome_completo, nome_urna, numero_urna, proprio)
         values ($1, $2, $3, $4, $4, $5, true) returning id`,
        [criados.organizacao, criados.campanha, criados.cargo, nome, numero],
      );
      return rows[0]!.id;
    };
    criados.candidatoA = await inserirCandidato('Candidato A', '133');
    criados.candidatoB = await inserirCandidato('Candidato B', '155');

    // Organização nova nasce sem perfis; quem os cria é esta função, chamada
    // pelo backoffice ao contratar. Aqui é seguro: a organização é do teste.
    await cliente.query('select public.semear_perfis_organizacao($1)', [criados.organizacao]);

    const { rows: perfil } = await cliente.query<{ id: string }>(
      `select id from public.perfis_acesso where id_organizacao = $1 limit 1`,
      [criados.organizacao],
    );

    const { rows: usuario } = await cliente.query<{ id: string }>(
      `insert into public.usuarios (id, id_organizacao, id_perfil, nome, email)
       values (gen_random_uuid(), $1, $2, 'Entrevistador de teste', $3) returning id`,
      [criados.organizacao, perfil[0]!.id, `teste-resolucao-${Date.now()}@exemplo.invalido`],
    );
    criados.usuario = usuario[0]!.id;

    const { rows: entrevistado } = await cliente.query<{ id: string }>(
      `insert into public.entrevistados
         (id_organizacao, id_campanha, nome, id_usuario_cadastro)
       values ($1, $2, 'Eleitor de Teste', $3) returning id`,
      [criados.organizacao, criados.campanha, criados.usuario],
    );
    criados.entrevistado = entrevistado[0]!.id;

    // Fica em RASCUNHO: concluir exigiria consentimento, e o que se testa aqui
    // é a resolução da intenção, não a validação de conclusão.
    const { rows: entrevista } = await cliente.query<{ id: string }>(
      `insert into public.entrevistas
         (id_organizacao, id_campanha, id_entrevistado, id_usuario_entrevistador, status)
       values ($1, $2, $3, $4, 'RASCUNHO') returning id`,
      [criados.organizacao, criados.campanha, criados.entrevistado, criados.usuario],
    );
    criados.entrevista = entrevista[0]!.id;
  });

  afterAll(async () => {
    if (!cliente) return;
    // Tudo cascateia da organização.
    await cliente.query('delete from public.organizacoes where id = $1', [criados.organizacao]);
    for (const tabela of [
      'intencoes_voto',
      'entrevistas',
      'entrevistados',
      'candidatos',
      'campanhas',
      'organizacoes',
      'usuarios',
    ]) {
      await cliente.query(`alter table public.${tabela} force row level security`);
    }
    await cliente.query('commit');
    await cliente.end();
  });

  /** Insere uma intenção e devolve como o trigger a deixou. */
  async function inserirIntencao(campos: {
    numeroDeclarado?: string | null;
    idCandidato?: string | null;
    tipo?: string;
  }): Promise<{ id_candidato: string | null; numero_declarado: string | null; tipo: string }> {
    const { rows } = await cliente.query<{
      id: string;
      id_candidato: string | null;
      numero_declarado: string | null;
      tipo: string;
    }>(
      `insert into public.intencoes_voto
         (id_organizacao, id_campanha, id_entrevista, id_cargo, id_candidato,
          numero_declarado, tipo)
       values ($1, $2, $3, $4, $5, $6, coalesce($7, 'NAO_RESPONDEU')::public.tipo_intencao)
       returning id, id_candidato, numero_declarado, tipo::text`,
      [
        criados.organizacao,
        criados.campanha,
        criados.entrevista,
        criados.cargo,
        campos.idCandidato ?? null,
        campos.numeroDeclarado ?? null,
        campos.tipo ?? null,
      ],
    );
    return rows[0]!;
  }

  async function limparIntencoes(): Promise<void> {
    await cliente.query('delete from public.intencoes_voto where id_entrevista = $1', [
      criados.entrevista,
    ]);
  }

  /**
   * Executa algo que DEVE falhar, sem envenenar a transação do arquivo.
   *
   * Tudo aqui roda numa transação só (para poder desligar o `force` da RLS e
   * desfazer no final). No PostgreSQL, um erro aborta a transação inteira: sem
   * savepoint, o primeiro caso de erro esperado derruba todos os seguintes com
   * "current transaction is aborted" — e o relatório culpa os testes errados.
   */
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

  it('resolve o número declarado para o candidato', async () => {
    // O caso que estava quebrado em produção.
    const linha = await inserirIntencao({ numeroDeclarado: '133' });
    expect(linha.id_candidato).toBe(criados.candidatoA);
    expect(linha.tipo).toBe('CANDIDATO');
    await limparIntencoes();
  });

  it('ignora pontuação no número', async () => {
    const linha = await inserirIntencao({ numeroDeclarado: ' 1-3 3 ' });
    expect(linha.id_candidato).toBe(criados.candidatoA);
    expect(linha.numero_declarado).toBe('133');
    await limparIntencoes();
  });

  it('número sem candidato vira NAO_CADASTRADO e PRESERVA o número', async () => {
    /*
     * Não é lixo: é concorrente que ninguém cadastrou. Descartar o número
     * perderia o sinal mais valioso da coleta — "todo mundo no bairro fala um
     * número que não está no nosso cadastro".
     */
    const linha = await inserirIntencao({ numeroDeclarado: '999' });
    expect(linha.id_candidato).toBeNull();
    expect(linha.tipo).toBe('NAO_CADASTRADO');
    expect(linha.numero_declarado).toBe('999');
    await limparIntencoes();
  });

  it('candidato informado direto preenche o número para o histórico', async () => {
    // O diff da retificação precisa do número legível meses depois.
    const linha = await inserirIntencao({ idCandidato: criados.candidatoB });
    expect(linha.tipo).toBe('CANDIDATO');
    expect(linha.numero_declarado).toBe('155');
    await limparIntencoes();
  });

  it('branco e nulo não resolvem candidato', async () => {
    const branco = await inserirIntencao({ tipo: 'BRANCO', numeroDeclarado: '133' });
    expect(branco.id_candidato).toBeNull();
    expect(branco.tipo).toBe('BRANCO');
    expect(branco.numero_declarado).toBeNull();
    await limparIntencoes();
  });

  it('campo vazio vira NAO_RESPONDEU', async () => {
    const linha = await inserirIntencao({ numeroDeclarado: '' });
    expect(linha.tipo).toBe('NAO_RESPONDEU');
    await limparIntencoes();
  });

  it('os dois votos de Senador aceitam candidatos DIFERENTES', async () => {
    await inserirIntencao({ numeroDeclarado: '133' });
    await inserirIntencao({ numeroDeclarado: '155' });
    const { rows } = await cliente.query<{ total: string }>(
      'select count(*)::text as total from public.intencoes_voto where id_entrevista = $1',
      [criados.entrevista],
    );
    expect(Number(rows[0]!.total)).toBe(2);
    await limparIntencoes();
  });

  it('RECUSA os dois votos de Senador no MESMO candidato', async () => {
    /*
     * Sem o índice único, a projeção daquele senador inflaria em 100%.
     * `validar_quantidade_intencoes` limita a quantidade de linhas por cargo,
     * não a repetição do candidato — são defeitos diferentes.
     */
    await inserirIntencao({ numeroDeclarado: '133' });
    await esperarErro(
      () => inserirIntencao({ numeroDeclarado: '133' }),
      /intencoes_candidato_unico_idx|duplicate key/i,
    );
    await limparIntencoes();
  });

  it('recusa a TERCEIRA intenção de Senador', async () => {
    // A trigger de quantidade continua valendo, e roda DEPOIS da resolução.
    await inserirIntencao({ numeroDeclarado: '133' });
    await inserirIntencao({ numeroDeclarado: '155' });
    await esperarErro(() => inserirIntencao({ tipo: 'BRANCO' }), /permite 2 voto/i);
    await limparIntencoes();
  });
});
