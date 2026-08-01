-- =============================================================================
-- 0002 — Núcleo: organizações, planos, campanhas, usuários, perfis e auditoria
--
-- Regra estrutural do projeto: TODA tabela de dados carrega `id_organizacao`,
-- mesmo quando já tem `id_campanha`. A repetição é intencional — deixa a
-- política RLS trivial e permite um índice composto que começa sempre pela
-- coluna de tenant.
-- =============================================================================

-- --- Enums -------------------------------------------------------------------

create type public.status_organizacao as enum ('ATIVA', 'SUSPENSA', 'CANCELADA');
create type public.abrangencia_campanha as enum ('FEDERAL', 'ESTADUAL', 'MUNICIPAL');
create type public.acao_auditoria as enum (
  'LER', 'CRIAR', 'ALTERAR', 'EXCLUIR', 'EXPORTAR', 'IMPRIMIR',
  'AUTENTICAR', 'FALHA_AUTENTICACAO',
  'CONCEDER_ACESSO_SUPORTE', 'REVOGAR_ACESSO_SUPORTE'
);

-- --- Planos ------------------------------------------------------------------

create table public.planos (
  id uuid primary key default gen_random_uuid(),
  nome text not null unique,
  limite_usuarios integer not null check (limite_usuarios > 0),
  limite_entrevistas_mes integer not null check (limite_entrevistas_mes > 0),
  limite_armazenamento_mb integer not null check (limite_armazenamento_mb > 0),
  limite_creditos_ia integer not null default 0 check (limite_creditos_ia >= 0),
  valor_mensal numeric(12, 2) not null check (valor_mensal >= 0),
  ativo boolean not null default true,
  criado_em timestamptz not null default now(),
  atualizado_em timestamptz not null default now()
);

comment on table public.planos is
  'Catálogo comercial. Não tem `id_organizacao`: é uma tabela de referência do provedor, '
  'legível por qualquer usuário autenticado e gravável apenas pelo backoffice.';

-- --- Organizações (o tenant) -------------------------------------------------

create table public.organizacoes (
  id uuid primary key default gen_random_uuid(),
  nome text not null,
  razao_social text,
  -- CNPJ nunca em texto claro: cifrado na aplicação (AES-256-GCM) + HMAC para busca.
  cnpj_criptografado text,
  cnpj_hmac text,
  id_plano uuid not null references public.planos(id),
  cor_acento text check (cor_acento ~ '^\d{1,3} \d{1,3}% \d{1,3}%$'),
  logo_url text,
  status public.status_organizacao not null default 'ATIVA',
  contratado_em date not null default current_date,
  expira_em date,
  criado_em timestamptz not null default now(),
  atualizado_em timestamptz not null default now()
);

create unique index organizacoes_cnpj_hmac_idx
  on public.organizacoes (cnpj_hmac) where cnpj_hmac is not null;
comment on column public.organizacoes.cor_acento is
  'Cor da campanha em HSL sem a função, ex.: "142 71% 32%". Injetada no token --acento.';

-- --- Campanhas ---------------------------------------------------------------

create table public.campanhas (
  id uuid primary key default gen_random_uuid(),
  id_organizacao uuid not null references public.organizacoes(id) on delete cascade,
  nome text not null,
  abrangencia public.abrangencia_campanha not null,
  uf char(2),
  id_municipio_base integer,
  ano_pleito integer not null check (ano_pleito between 1994 and 2100),
  natureza_padrao text not null default 'LEVANTAMENTO_INTERNO',
  ativa boolean not null default true,
  criado_em timestamptz not null default now(),
  atualizado_em timestamptz not null default now(),
  -- Campanha estadual ou municipal sem UF não faz sentido e quebraria o filtro
  -- territorial silenciosamente.
  constraint campanhas_uf_obrigatoria_check
    check (abrangencia = 'FEDERAL' or uf is not null)
);

create index campanhas_organizacao_idx on public.campanhas (id_organizacao, ativa);

-- --- Perfis e permissões -----------------------------------------------------

create table public.perfis_acesso (
  id uuid primary key default gen_random_uuid(),
  id_organizacao uuid not null references public.organizacoes(id) on delete cascade,
  nome text not null,
  descricao text,
  -- Perfil-semente criado pelo seed. Pode ser editado, mas não excluído.
  sistema_padrao boolean not null default false,
  criado_em timestamptz not null default now(),
  atualizado_em timestamptz not null default now(),
  unique (id_organizacao, nome)
);

create table public.permissoes (
  id uuid primary key default gen_random_uuid(),
  chave text not null unique,
  modulo text not null,
  descricao text not null
);

comment on table public.permissoes is
  'Catálogo global de permissões, igual para todas as organizações. O que varia por '
  'organização é a associação perfil→permissão→escopo — permissões são dados, não código.';

create table public.perfil_permissoes (
  id_perfil uuid not null references public.perfis_acesso(id) on delete cascade,
  id_permissao uuid not null references public.permissoes(id) on delete cascade,
  escopo autenticacao.escopo_permissao not null default 'PROPRIO',
  primary key (id_perfil, id_permissao)
);

-- --- Usuários ----------------------------------------------------------------

create table public.usuarios (
  -- O id espelha `auth.users.id` do Supabase Auth.
  id uuid primary key,
  id_organizacao uuid not null references public.organizacoes(id) on delete cascade,
  nome text not null,
  email citext not null,
  telefone text,
  cpf_criptografado text,
  cpf_hmac text,
  id_perfil uuid not null references public.perfis_acesso(id),
  ativo boolean not null default true,
  mfa_habilitado boolean not null default false,
  preferencia_tema text not null default 'sistema'
    check (preferencia_tema in ('claro', 'escuro', 'sistema')),
  ultimo_acesso timestamptz,
  criado_em timestamptz not null default now(),
  atualizado_em timestamptz not null default now(),
  unique (id_organizacao, email)
);

create index usuarios_organizacao_idx on public.usuarios (id_organizacao, ativo);
create unique index usuarios_cpf_hmac_idx
  on public.usuarios (id_organizacao, cpf_hmac) where cpf_hmac is not null;

comment on table public.usuarios is
  'Um usuário pertence a EXATAMENTE UMA organização. Atender duas campanhas adversárias '
  'exige duas contas — por decisão de projeto, não por limitação técnica.';

-- Acesso por campanha dentro da organização, com perfil possivelmente distinto
-- do perfil-base (um analista da campanha A pode ser só leitor na campanha B).
create table public.usuario_campanhas (
  id_usuario uuid not null references public.usuarios(id) on delete cascade,
  id_campanha uuid not null references public.campanhas(id) on delete cascade,
  id_organizacao uuid not null references public.organizacoes(id) on delete cascade,
  id_perfil uuid references public.perfis_acesso(id),
  criado_em timestamptz not null default now(),
  primary key (id_usuario, id_campanha)
);

create index usuario_campanhas_campanha_idx
  on public.usuario_campanhas (id_organizacao, id_campanha);

-- --- Equipes -----------------------------------------------------------------

create table public.equipes (
  id uuid primary key default gen_random_uuid(),
  id_organizacao uuid not null references public.organizacoes(id) on delete cascade,
  id_campanha uuid not null references public.campanhas(id) on delete cascade,
  nome text not null,
  id_coordenador uuid references public.usuarios(id),
  ativa boolean not null default true,
  criado_em timestamptz not null default now(),
  atualizado_em timestamptz not null default now(),
  unique (id_campanha, nome)
);

create index equipes_organizacao_idx on public.equipes (id_organizacao, id_campanha);

create table public.equipe_membros (
  id_equipe uuid not null references public.equipes(id) on delete cascade,
  id_usuario uuid not null references public.usuarios(id) on delete cascade,
  id_organizacao uuid not null references public.organizacoes(id) on delete cascade,
  papel text not null default 'MEMBRO',
  criado_em timestamptz not null default now(),
  primary key (id_equipe, id_usuario)
);

create index equipe_membros_usuario_idx on public.equipe_membros (id_organizacao, id_usuario);

-- --- Convites ----------------------------------------------------------------

create table public.convites (
  id uuid primary key default gen_random_uuid(),
  id_organizacao uuid not null references public.organizacoes(id) on delete cascade,
  email citext not null,
  id_perfil uuid not null references public.perfis_acesso(id),
  id_campanha uuid references public.campanhas(id) on delete cascade,
  -- Guardamos só o hash do token: vazamento da tabela não permite aceitar convite.
  token_hash text not null,
  expira_em timestamptz not null,
  aceito_em timestamptz,
  id_usuario_criador uuid not null references public.usuarios(id),
  criado_em timestamptz not null default now()
);

create index convites_organizacao_idx on public.convites (id_organizacao, email);
create unique index convites_token_idx on public.convites (token_hash);

-- --- Auditoria ---------------------------------------------------------------

/**
 * Trilha imutável. Não há UPDATE nem DELETE liberado para ninguém — nem para o
 * administrador da organização, nem para o provedor. Expurgo, quando houver,
 * será por rotina de retenção documentada, jamais por operação de tela.
 */
create table public.logs_auditoria (
  id bigint generated always as identity primary key,
  id_organizacao uuid references public.organizacoes(id) on delete set null,
  id_campanha uuid references public.campanhas(id) on delete set null,
  id_usuario uuid references public.usuarios(id) on delete set null,
  acao public.acao_auditoria not null,
  entidade text not null,
  id_entidade text,
  dados_antes jsonb,
  dados_depois jsonb,
  -- Contexto da exportação: filtro por extenso e quantidade de registros.
  filtro_aplicado jsonb,
  quantidade_registros integer,
  ip inet,
  user_agent text,
  id_correlacao uuid,
  criado_em timestamptz not null default now()
);

create index logs_auditoria_org_data_idx
  on public.logs_auditoria (id_organizacao, criado_em desc);
create index logs_auditoria_usuario_idx
  on public.logs_auditoria (id_organizacao, id_usuario, criado_em desc);
create index logs_auditoria_entidade_idx
  on public.logs_auditoria (id_organizacao, entidade, id_entidade);

-- --- Acesso de suporte do provedor -------------------------------------------

/**
 * Acesso temporário da Jeos aos dados de uma organização.
 *
 * Nunca é concedido pelo provedor a si mesmo: exige autorização explícita de
 * um administrador da organização, tem prazo de expiração, motivo registrado e
 * dispara notificação por e-mail ao cliente. Intenção de voto é dado sensível
 * (LGPD art. 5º, II) e o sistema atende campanhas adversárias simultaneamente —
 * o acesso irrestrito do provedor seria um risco jurídico real, não teórico.
 */
create table public.acessos_suporte (
  id uuid primary key default gen_random_uuid(),
  id_organizacao uuid not null references public.organizacoes(id) on delete cascade,
  id_usuario_provedor uuid not null,
  email_provedor citext not null,
  motivo text not null check (length(trim(motivo)) >= 20),
  autorizado_por uuid not null references public.usuarios(id),
  autorizado_em timestamptz not null default now(),
  expira_em timestamptz not null,
  revogado_em timestamptz,
  revogado_por uuid references public.usuarios(id),
  criado_em timestamptz not null default now(),
  constraint acessos_suporte_prazo_check check (expira_em > autorizado_em),
  -- Prazo máximo de 7 dias por concessão. Suporte que precisa de mais que isso
  -- precisa de nova autorização, e o cliente é notificado de novo.
  constraint acessos_suporte_prazo_maximo_check
    check (expira_em <= autorizado_em + interval '7 days')
);

create index acessos_suporte_vigentes_idx
  on public.acessos_suporte (id_organizacao, expira_em)
  where revogado_em is null;

/**
 * Verdadeiro quando o token atual é de um usuário do provedor com autorização
 * vigente para a organização informada. É a ÚNICA porta pela qual o backoffice
 * enxerga dado de campo.
 */
create or replace function autenticacao.suporte_ativo(p_id_organizacao uuid)
returns boolean
language sql
stable
security definer
set search_path = public, autenticacao, pg_temp
as $$
  select autenticacao.eh_provedor()
     and exists (
       select 1
       from public.acessos_suporte a
       where a.id_organizacao = p_id_organizacao
         and a.id_usuario_provedor = autenticacao.id_usuario()
         and a.revogado_em is null
         and a.expira_em > now()
     );
$$;

-- --- Gatilhos de atualizado_em -----------------------------------------------

do $$
declare
  tabela text;
begin
  foreach tabela in array array[
    'planos', 'organizacoes', 'campanhas', 'perfis_acesso',
    'usuarios', 'equipes'
  ]
  loop
    execute format(
      'create trigger %I_atualizado_em before update on public.%I
         for each row execute function public.marcar_atualizado_em();',
      tabela, tabela
    );
  end loop;
end;
$$;
