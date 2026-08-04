-- =============================================================================
-- 0025 — Planejamento, linha narrativa e plano de ações
--
-- Fecha a cadeia que os módulos anteriores prepararam:
--
--   diagnóstico → eixo narrativo → ação → atividade
--
-- Cada elo guarda a origem do seguinte. É isso que permite responder, no meio
-- da campanha, "por que estamos fazendo esta visita?" — e chegar até o problema
-- que alguém ouviu numa reunião de bairro.
--
-- `acoes_campanha` NÃO cabe em `atividades`, e a tentação de fundir as duas é
-- real. Ação tem PRAZO e não data-hora; é 1:N com atividades (uma ação gera
-- três visitas e um encontro); e carrega o PORQUÊ, enquanto a atividade carrega
-- o quando/onde/quem. Fundidas, metade das linhas ficaria com `inicio_em` nulo
-- e a agenda precisaria de `where inicio_em is not null` — o cheiro clássico de
-- duas entidades numa tabela.
-- =============================================================================

create type public.status_planejamento as enum ('RASCUNHO', 'VIGENTE', 'ENCERRADO');
create type public.status_acao as enum ('PLANEJADA', 'EM_EXECUCAO', 'CONCLUIDA', 'CANCELADA');

-- --- Plano de campanha -------------------------------------------------------

/*
 * `planejamentos`, e não `planos`: `public.planos` já existe e é o catálogo
 * comercial do SaaS (limite de usuários, valor mensal). Reaproveitar o nome
 * daria uma confusão silenciosa entre plano de campanha e plano de assinatura.
 */
create table public.planejamentos (
  id uuid primary key default gen_random_uuid(),
  id_organizacao uuid not null references public.organizacoes(id) on delete cascade,
  id_campanha uuid not null references public.campanhas(id) on delete cascade,

  titulo text not null,
  -- O plano é reescrito depois do primeiro turno, e o que já está VIGENTE não
  -- pode mudar debaixo de quem está executando.
  versao integer not null default 1,
  status public.status_planejamento not null default 'RASCUNHO',

  data_inicio date not null,
  data_fim date not null,
  objetivo_geral text,
  id_usuario_responsavel uuid references public.usuarios(id) on delete set null,

  criado_em timestamptz not null default now(),
  atualizado_em timestamptz not null default now(),

  unique (id_campanha, versao),
  constraint planejamento_periodo_coerente check (data_fim >= data_inicio)
);

create index planejamentos_org_idx
  on public.planejamentos (id_organizacao, id_campanha, status);

-- --- Linha narrativa ---------------------------------------------------------

create table public.eixos_narrativos (
  id uuid primary key default gen_random_uuid(),
  id_organizacao uuid not null references public.organizacoes(id) on delete cascade,
  id_campanha uuid not null references public.campanhas(id) on delete cascade,
  id_planejamento uuid references public.planejamentos(id) on delete cascade,

  titulo text not null,
  sintese text not null,
  publico_alvo text,

  /*
   * Arrays em vez de tabelas-filhas.
   *
   * Mensagem-chave, prova e risco são listas curtas de texto que só existem
   * dentro do eixo, nunca são consultadas isoladamente e nunca são
   * referenciadas por outra tabela. Três tabelas de uma coluna cada seriam
   * cerimônia sem retorno.
   */
  mensagens text[] not null default '{}',
  provas text[] not null default '{}',
  riscos text[] not null default '{}',

  prioridade public.prioridade not null default 'MEDIA',

  -- Rastreabilidade da sugestão: qual chamada de IA produziu este eixo, e
  -- quanto ela custou. Sem isso não há como auditar depois o que veio da
  -- máquina nem quanto se gastou para chegar à narrativa.
  gerado_por_ia boolean not null default false,
  id_uso_ia bigint references public.usos_ia(id) on delete set null,

  aprovado_em timestamptz,
  aprovado_por uuid references public.usuarios(id) on delete set null,

  criado_em timestamptz not null default now(),
  atualizado_em timestamptz not null default now()
);

create index eixos_org_idx
  on public.eixos_narrativos (id_organizacao, id_campanha, prioridade);

/*
 * O elo que dá valor à cadeia: de qual problema levantado em campo saiu este
 * eixo. É o que transforma "achamos que saneamento pega bem" em "saneamento
 * apareceu em seis bairros, com 61 relatos".
 */
create table public.eixo_problemas (
  id_organizacao uuid not null references public.organizacoes(id) on delete cascade,
  id_eixo uuid not null references public.eixos_narrativos(id) on delete cascade,
  id_problema uuid not null references public.diagnostico_problemas(id) on delete cascade,
  criado_em timestamptz not null default now(),
  primary key (id_eixo, id_problema)
);

create index eixo_problemas_org_idx on public.eixo_problemas (id_organizacao, id_eixo);

-- --- Plano de ações ----------------------------------------------------------

create table public.acoes_campanha (
  id uuid primary key default gen_random_uuid(),
  id_organizacao uuid not null references public.organizacoes(id) on delete cascade,
  id_campanha uuid not null references public.campanhas(id) on delete cascade,

  id_planejamento uuid references public.planejamentos(id) on delete cascade,
  -- As três origens possíveis. Todas opcionais: uma ação pode nascer de uma
  -- decisão do coordenador sem passar pelo diagnóstico.
  id_eixo uuid references public.eixos_narrativos(id) on delete set null,
  id_area uuid references public.areas_estrategicas(id) on delete set null,
  id_problema uuid references public.diagnostico_problemas(id) on delete set null,

  titulo text not null,
  descricao text,
  status public.status_acao not null default 'PLANEJADA',
  prioridade public.prioridade not null default 'MEDIA',

  -- Prazo, e não data-hora: é o que separa ação de atividade.
  prazo date,
  id_responsavel uuid references public.usuarios(id) on delete set null,
  id_equipe uuid references public.equipes(id) on delete set null,

  custo_estimado numeric(14,2),
  resultado_esperado text,
  resultado_obtido text,
  concluida_em timestamptz,

  criado_em timestamptz not null default now(),
  atualizado_em timestamptz not null default now()
);

create index acoes_org_idx
  on public.acoes_campanha (id_organizacao, id_campanha, status, prazo);
create index acoes_responsavel_idx on public.acoes_campanha (id_organizacao, id_responsavel);
create index acoes_eixo_idx on public.acoes_campanha (id_organizacao, id_eixo);

/*
 * Fecha o último elo. A coluna foi criada na 0021 sem FK porque
 * `acoes_campanha` ainda não existia — agora existe.
 */
alter table public.atividades
  add constraint atividades_acao_fk
  foreign key (id_acao) references public.acoes_campanha(id) on delete set null;

create index atividades_acao_idx on public.atividades (id_organizacao, id_acao);

-- --- Gatilhos ----------------------------------------------------------------

do $$
declare
  tabela text;
begin
  foreach tabela in array array['planejamentos', 'eixos_narrativos', 'acoes_campanha']
  loop
    execute format(
      'create trigger %I before update on public.%I
         for each row execute function public.marcar_atualizado_em()',
      tabela || '_atualizado_em', tabela
    );
  end loop;
end;
$$;

-- --- RLS ---------------------------------------------------------------------

/*
 * Plano, narrativa e eixos usam o padrão: são a estratégia declarada da
 * campanha, e quem executa precisa vê-la inteira para entender o próprio papel.
 *
 * `acoes_campanha` NÃO usa. Ação tem responsável e prazo, e é a lista de
 * pendências de alguém — com `aplicar_rls_padrao`, um entrevistador com escopo
 * PROPRIO enxergaria o quadro de tarefas da campanha inteira. Usa
 * `visivel_no_escopo`, como atividades.
 */
select autenticacao.aplicar_rls_padrao(
  'planejamentos', 'planejamento.ler', 'planejamento.gerenciar'
);
select autenticacao.aplicar_rls_padrao(
  'eixos_narrativos', 'planejamento.ler', 'planejamento.gerenciar'
);
select autenticacao.aplicar_rls_padrao(
  'eixo_problemas', 'planejamento.ler', 'planejamento.gerenciar', false
);

alter table public.acoes_campanha enable row level security;
alter table public.acoes_campanha force row level security;

create policy acoes_ler on public.acoes_campanha
  for select using (
    autenticacao.pertence(id_organizacao, id_campanha)
    and autenticacao.visivel_no_escopo(
          'planejamento.ler', id_responsavel, id_equipe, null::uuid
        )
  );

create policy acoes_inserir on public.acoes_campanha
  for insert with check (
    autenticacao.pertence(id_organizacao, id_campanha)
    and autenticacao.escopo_de('planejamento.gerenciar') is not null
  );

create policy acoes_alterar on public.acoes_campanha
  for update using (
    autenticacao.pertence(id_organizacao, id_campanha)
    and autenticacao.visivel_no_escopo(
          'planejamento.gerenciar', id_responsavel, id_equipe, null::uuid
        )
  ) with check (autenticacao.pertence(id_organizacao, id_campanha));

create policy acoes_excluir on public.acoes_campanha
  for delete using (
    autenticacao.pertence(id_organizacao, id_campanha)
    and autenticacao.escopo_de('planejamento.gerenciar') = 'CAMPANHA'
  );

create policy acoes_suporte on public.acoes_campanha
  for select using (autenticacao.suporte_ativo(id_organizacao));

comment on table public.acoes_campanha is
  'Acao de campanha. Tem PRAZO e nao data-hora, e e 1:N com atividades — por '
  'isso nao cabe em public.atividades. Carrega o PORQUE (eixo, problema, area); '
  'a atividade carrega o quando/onde/quem.';

comment on table public.eixo_problemas is
  'De qual problema levantado em campo saiu o eixo narrativo. E o elo que '
  'transforma intuicao em evidencia rastreavel.';
