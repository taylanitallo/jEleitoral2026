-- =============================================================================
-- 0011 — Backoffice do provedor (Jeos)
--
-- A Jeos NÃO é uma organização dentro da árvore de tenants. Seus usuários vivem
-- em `provedor.usuarios`, autenticam-se separadamente e recebem um token com
-- `perfil_provedor` — sem `id_organizacao`. Como toda política de dados de campo
-- exige `id_organizacao`, o provedor falha em todas elas por construção.
--
-- O acesso a métricas NÃO é feito abrindo exceção nas políticas. É feito por
-- uma tabela de AGREGADOS alimentada por job: o backoffice lê contadores, nunca
-- a tabela de origem. Assim não existe caminho, nem acidental, do provedor até
-- a intenção de voto de um eleitor.
-- =============================================================================

create table provedor.usuarios (
  id uuid primary key,
  nome text not null,
  email citext not null unique,
  perfil text not null check (perfil in ('SUPORTE_PROVEDOR', 'ADMINISTRADOR_PROVEDOR')),
  ativo boolean not null default true,
  mfa_habilitado boolean not null default true,
  ultimo_acesso timestamptz,
  criado_em timestamptz not null default now()
);

create table catalogo.contratos (
  id uuid primary key default gen_random_uuid(),
  id_organizacao uuid not null references public.organizacoes(id) on delete cascade,
  id_plano uuid not null references public.planos(id),
  vigente_de date not null,
  vigente_ate date,
  valor_mensal numeric(12, 2) not null check (valor_mensal >= 0),
  dia_vencimento smallint not null default 10 check (dia_vencimento between 1 and 28),
  status text not null default 'ATIVO' check (status in ('ATIVO', 'INADIMPLENTE', 'ENCERRADO')),
  observacoes text,
  criado_em timestamptz not null default now(),
  atualizado_em timestamptz not null default now()
);

create index contratos_organizacao_idx on catalogo.contratos (id_organizacao, status);

/**
 * Preparação para isolamento físico opcional (venda futura).
 *
 * Se um cliente exigir banco separado por contrato, o caminho é um projeto
 * Supabase dedicado, com o MESMO código e as MESMAS migrations — não schema
 * separado dentro do banco compartilhado. Esta tabela existe apenas para que a
 * camada de conexão saiba resolver o destino a partir da organização. Nada a
 * consome hoje: a porta fica aberta, mas não atravessada.
 */
create table catalogo.instancias (
  id uuid primary key default gen_random_uuid(),
  id_organizacao uuid not null unique references public.organizacoes(id) on delete cascade,
  identificador_projeto text not null,
  url_banco_segredo text not null,
  regiao text,
  dedicada boolean not null default false,
  criado_em timestamptz not null default now()
);

/**
 * Métricas de uso agregadas, alimentadas por job diário.
 *
 * É a ÚNICA fonte do painel do provedor. Contadores, nunca conteúdo.
 */
create table catalogo.metricas_uso (
  id bigint generated always as identity primary key,
  id_organizacao uuid not null references public.organizacoes(id) on delete cascade,
  data_referencia date not null,
  usuarios_ativos integer not null default 0,
  entrevistas_no_mes integer not null default 0,
  entrevistados_total integer not null default 0,
  armazenamento_mb numeric(12, 2) not null default 0,
  chamadas_ia integer not null default 0,
  custo_ia numeric(10, 4) not null default 0,
  ultima_atividade timestamptz,
  criado_em timestamptz not null default now(),
  unique (id_organizacao, data_referencia)
);

create index metricas_uso_data_idx on catalogo.metricas_uso (data_referencia desc);

create table catalogo.saude_integracoes (
  id bigint generated always as identity primary key,
  fonte public.fonte_integracao not null,
  disponivel boolean not null,
  latencia_ms integer,
  detalhe text,
  verificado_em timestamptz not null default now()
);

create index saude_integracoes_fonte_idx
  on catalogo.saude_integracoes (fonte, verificado_em desc);

/**
 * Auditoria em nível de METADADO para o provedor: quem acessou o quê e quando,
 * SEM o conteúdo. As colunas `dados_antes` e `dados_depois` ficam de fora — é a
 * diferença entre "o usuário X exportou 1.243 entrevistas às 14h" e "eis as
 * 1.243 entrevistas".
 */
create or replace view provedor.auditoria_metadados as
  select
    l.id,
    l.id_organizacao,
    o.nome as nome_organizacao,
    l.id_usuario,
    l.acao,
    l.entidade,
    l.quantidade_registros,
    l.criado_em
  from public.logs_auditoria l
  join public.organizacoes o on o.id = l.id_organizacao;

comment on view provedor.auditoria_metadados is
  'Trilha de auditoria sem conteúdo, para o backoffice. Nunca exponha logs_auditoria '
  'diretamente ao provedor: dados_antes/dados_depois contêm dado sensível.';

-- --- RLS do esquema do provedor ----------------------------------------------

alter table provedor.usuarios enable row level security;
alter table provedor.usuarios force row level security;
create policy provedor_usuarios_proprio on provedor.usuarios
  for select using (autenticacao.eh_provedor());
create policy provedor_usuarios_admin on provedor.usuarios
  for all
  using (autenticacao.claims() ->> 'perfil_provedor' = 'ADMINISTRADOR_PROVEDOR')
  with check (autenticacao.claims() ->> 'perfil_provedor' = 'ADMINISTRADOR_PROVEDOR');

do $$
declare
  item record;
begin
  for item in
    select * from (values
      ('contratos'), ('instancias'), ('metricas_uso')
    ) as t(tabela)
  loop
    execute format('alter table catalogo.%I enable row level security', item.tabela);
    execute format('alter table catalogo.%I force row level security', item.tabela);
    -- Provedor lê e escreve; o cliente enxerga apenas o que é dele.
    execute format(
      'create policy %I on catalogo.%I for all using (autenticacao.eh_provedor())
         with check (autenticacao.eh_provedor())',
      item.tabela || '_provedor', item.tabela
    );
    execute format(
      'create policy %I on catalogo.%I for select using (id_organizacao = autenticacao.id_organizacao())',
      item.tabela || '_cliente', item.tabela
    );
  end loop;
end;
$$;

alter table catalogo.saude_integracoes enable row level security;
alter table catalogo.saude_integracoes force row level security;
create policy saude_integracoes_ler on catalogo.saude_integracoes
  for select using (autenticacao.eh_provedor() or autenticacao.id_organizacao() is not null);

create trigger contratos_atualizado_em before update on catalogo.contratos
  for each row execute function public.marcar_atualizado_em();
