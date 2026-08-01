-- =============================================================================
-- 0010 — Sincronizações, uso de IA e exportações
-- =============================================================================

create type public.fonte_integracao as enum (
  'IBGE_LOCALIDADES', 'CEP', 'TSE_DADOS_ABERTOS', 'DIVULGACAND',
  'RESULTADOS_AO_VIVO', 'CNEFE'
);
create type public.status_sincronizacao as enum (
  'PENDENTE', 'EM_EXECUCAO', 'CONCLUIDA', 'CONCLUIDA_COM_ERROS', 'FALHOU', 'CANCELADA'
);
create type public.formato_exportacao as enum ('PDF', 'XLSX', 'CSV');

/**
 * Histórico de sincronizações. `id_organizacao` é NULO nas cargas de tabelas de
 * referência (IBGE, TSE), que são compartilhadas por todos os clientes; e
 * preenchido quando a sincronização foi disparada por uma organização
 * específica, para exibir progresso na tela dela.
 */
create table public.sincronizacoes (
  id uuid primary key default gen_random_uuid(),
  id_organizacao uuid references public.organizacoes(id) on delete cascade,
  fonte public.fonte_integracao not null,
  parametros jsonb not null default '{}'::jsonb,
  status public.status_sincronizacao not null default 'PENDENTE',
  iniciado_em timestamptz,
  finalizado_em timestamptz,
  registros_processados integer not null default 0,
  registros_inseridos integer not null default 0,
  registros_atualizados integer not null default 0,
  registros_ignorados integer not null default 0,
  erros jsonb not null default '[]'::jsonb,
  id_usuario_disparo uuid references public.usuarios(id),
  criado_em timestamptz not null default now()
);

create index sincronizacoes_fonte_idx on public.sincronizacoes (fonte, criado_em desc);
create index sincronizacoes_org_idx
  on public.sincronizacoes (id_organizacao, criado_em desc) where id_organizacao is not null;

alter table public.sincronizacoes enable row level security;
alter table public.sincronizacoes force row level security;

create policy sincronizacoes_ler on public.sincronizacoes
  for select using (
    autenticacao.eh_provedor()
    or id_organizacao is null            -- carga de referência: visível a todos
    or id_organizacao = autenticacao.id_organizacao()
  );

create policy sincronizacoes_disparar on public.sincronizacoes
  for insert with check (
    id_organizacao = autenticacao.id_organizacao()
    and autenticacao.escopo_de('integracoes.executar') = 'CAMPANHA'
  );

/**
 * Consumo de IA por campanha.
 *
 * Registrar custo por chamada permite cobrar por plano e, mais importante,
 * cortar o gasto quando a campanha estoura o limite — sem isso, um laço mal
 * feito no diagnóstico geraria fatura inesperada.
 *
 * `resumo_entrada` guarda apenas os AGREGADOS enviados ao modelo. Dado nominal
 * (nome, CPF, título, telefone) nunca é enviado nem registrado aqui.
 */
create table public.usos_ia (
  id bigint generated always as identity primary key,
  id_organizacao uuid not null references public.organizacoes(id) on delete cascade,
  id_campanha uuid references public.campanhas(id) on delete cascade,
  id_usuario uuid references public.usuarios(id),
  funcionalidade text not null,
  modelo text not null,
  tokens_entrada integer not null default 0,
  tokens_saida integer not null default 0,
  custo_estimado numeric(10, 6) not null default 0,
  duracao_ms integer,
  resumo_entrada jsonb,
  sucesso boolean not null default true,
  erro text,
  criado_em timestamptz not null default now()
);

create index usos_ia_org_mes_idx on public.usos_ia (id_organizacao, criado_em desc);
create index usos_ia_campanha_idx on public.usos_ia (id_organizacao, id_campanha, funcionalidade);

alter table public.usos_ia enable row level security;
alter table public.usos_ia force row level security;
create policy usos_ia_ler on public.usos_ia
  for select using (
    id_organizacao = autenticacao.id_organizacao()
    and autenticacao.escopo_de('ia.usar') is not null
  );
create policy usos_ia_registrar on public.usos_ia
  for insert with check (id_organizacao = autenticacao.id_organizacao());

/**
 * Exportações. Rodam em job assíncrono quando grandes, com link temporário.
 * A linha é criada ANTES de gerar o arquivo — assim a auditoria registra a
 * intenção mesmo que a geração falhe.
 */
create table public.exportacoes (
  id uuid primary key default gen_random_uuid(),
  id_organizacao uuid not null references public.organizacoes(id) on delete cascade,
  id_campanha uuid not null references public.campanhas(id) on delete cascade,
  id_usuario uuid not null references public.usuarios(id),
  relatorio text not null,
  formato public.formato_exportacao not null,
  -- Filtro por extenso, do jeito que aparece no cabeçalho do PDF.
  filtro_aplicado jsonb not null default '{}'::jsonb,
  natureza public.natureza_levantamento not null default 'LEVANTAMENTO_INTERNO',
  quantidade_registros integer,
  status text not null default 'PENDENTE'
    check (status in ('PENDENTE', 'PROCESSANDO', 'CONCLUIDA', 'FALHOU')),
  caminho_arquivo text,
  expira_em timestamptz,
  erro text,
  criado_em timestamptz not null default now(),
  finalizado_em timestamptz
);

create index exportacoes_usuario_idx
  on public.exportacoes (id_organizacao, id_usuario, criado_em desc);

select autenticacao.aplicar_rls_padrao('exportacoes', 'relatorios.exportar', 'relatorios.exportar');

-- --- Apuração ao vivo (Fase 13) ----------------------------------------------

/**
 * Boletins recebidos do canal de divulgação de resultados na noite da eleição.
 * Único fluxo genuinamente em tempo real do sistema, e só funciona no dia da
 * apuração. Guardamos o boletim bruto para poder reprocessar sem rebaixar o
 * arquivo de novo.
 */
create table public.boletins_apuracao (
  id bigint generated always as identity primary key,
  ano integer not null,
  turno smallint not null check (turno in (1, 2)),
  uf char(2) not null,
  id_secao uuid references public.secoes_eleitorais(id),
  codigo_cargo integer not null,
  arquivo_origem text not null,
  hash_arquivo text not null,
  conteudo jsonb not null,
  processado boolean not null default false,
  recebido_em timestamptz not null default now(),
  unique (hash_arquivo, codigo_cargo)
);

create index boletins_secao_idx on public.boletins_apuracao (ano, turno, id_secao);
select autenticacao.aplicar_rls_referencia('boletins_apuracao');
