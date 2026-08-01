-- =============================================================================
-- 0009 — Financeiro e artes gráficas
--
-- O módulo financeiro é de CONTROLE GERENCIAL INTERNO. Não substitui a
-- prestação de contas à Justiça Eleitoral — a UI diz isso explicitamente. O
-- `codigo_tse` na categoria existe para facilitar a conciliação posterior pelo
-- contador, não para gerar a prestação.
-- =============================================================================

create type public.tipo_lancamento as enum ('RECEITA', 'DESPESA');
create type public.status_lancamento as enum ('PREVISTO', 'CONFIRMADO', 'PAGO', 'CANCELADO');
create type public.forma_pagamento as enum
  ('PIX', 'TRANSFERENCIA', 'DINHEIRO', 'CARTAO', 'BOLETO', 'CHEQUE');
create type public.tipo_material_grafico as enum
  ('SANTINHO', 'ADESIVO', 'BANNER', 'CARD_REDE', 'PANFLETO', 'BONE', 'CAMISA');

create table public.centros_custo (
  id uuid primary key default gen_random_uuid(),
  id_organizacao uuid not null references public.organizacoes(id) on delete cascade,
  id_campanha uuid not null references public.campanhas(id) on delete cascade,
  nome text not null,
  ativo boolean not null default true,
  criado_em timestamptz not null default now(),
  atualizado_em timestamptz not null default now(),
  unique (id_campanha, nome)
);

create table public.categorias_lancamento (
  id uuid primary key default gen_random_uuid(),
  id_organizacao uuid not null references public.organizacoes(id) on delete cascade,
  id_campanha uuid references public.campanhas(id) on delete cascade,
  nome text not null,
  tipo public.tipo_lancamento not null,
  codigo_tse text,
  criado_em timestamptz not null default now(),
  atualizado_em timestamptz not null default now()
);

create table public.fornecedores (
  id uuid primary key default gen_random_uuid(),
  id_organizacao uuid not null references public.organizacoes(id) on delete cascade,
  id_campanha uuid not null references public.campanhas(id) on delete cascade,
  nome text not null,
  cnpj_cpf_criptografado text,
  cnpj_cpf_hmac text,
  contato text,
  telefone text,
  email citext,
  criado_em timestamptz not null default now(),
  atualizado_em timestamptz not null default now()
);

create unique index fornecedores_documento_idx
  on public.fornecedores (id_campanha, cnpj_cpf_hmac) where cnpj_cpf_hmac is not null;

create table public.lancamentos (
  id uuid primary key default gen_random_uuid(),
  id_organizacao uuid not null references public.organizacoes(id) on delete cascade,
  id_campanha uuid not null references public.campanhas(id) on delete cascade,
  tipo public.tipo_lancamento not null,
  id_categoria uuid references public.categorias_lancamento(id),
  id_centro_custo uuid references public.centros_custo(id),
  id_fornecedor uuid references public.fornecedores(id),
  descricao text not null,
  valor numeric(14, 2) not null check (valor > 0),
  data_competencia date not null,
  data_pagamento date,
  forma_pagamento public.forma_pagamento,
  -- Território ao qual a despesa se refere. É o que permite calcular custo por
  -- eleitor mapeado e custo por voto projetado por bairro.
  nivel_territorio public.nivel_territorial,
  id_territorio text,
  comprovante_url text,
  status public.status_lancamento not null default 'PREVISTO',
  id_usuario_cadastro uuid not null references public.usuarios(id),
  criado_em timestamptz not null default now(),
  atualizado_em timestamptz not null default now(),
  constraint lancamentos_pagamento_check
    check (status <> 'PAGO' or data_pagamento is not null)
);

create index lancamentos_campanha_idx
  on public.lancamentos (id_organizacao, id_campanha, data_competencia desc);
create index lancamentos_territorio_idx
  on public.lancamentos (id_organizacao, id_campanha, nivel_territorio, id_territorio);
create index lancamentos_centro_custo_idx on public.lancamentos (id_organizacao, id_centro_custo);

create table public.orcamentos (
  id uuid primary key default gen_random_uuid(),
  id_organizacao uuid not null references public.organizacoes(id) on delete cascade,
  id_campanha uuid not null references public.campanhas(id) on delete cascade,
  id_centro_custo uuid not null references public.centros_custo(id) on delete cascade,
  mes_referencia date not null,
  valor_previsto numeric(14, 2) not null check (valor_previsto >= 0),
  criado_em timestamptz not null default now(),
  atualizado_em timestamptz not null default now(),
  unique (id_centro_custo, mes_referencia)
);

-- --- Artes gráficas ----------------------------------------------------------

create table public.materiais_graficos (
  id uuid primary key default gen_random_uuid(),
  id_organizacao uuid not null references public.organizacoes(id) on delete cascade,
  id_campanha uuid not null references public.campanhas(id) on delete cascade,
  id_candidato uuid references public.candidatos(id) on delete set null,
  tipo public.tipo_material_grafico not null,
  titulo text not null,
  descricao text,
  publicado boolean not null default false,
  id_usuario_criador uuid not null references public.usuarios(id),
  criado_em timestamptz not null default now(),
  atualizado_em timestamptz not null default now()
);

create index materiais_campanha_idx
  on public.materiais_graficos (id_organizacao, id_campanha, tipo) where publicado = true;

create table public.versoes_arte (
  id uuid primary key default gen_random_uuid(),
  id_organizacao uuid not null references public.organizacoes(id) on delete cascade,
  id_campanha uuid not null references public.campanhas(id) on delete cascade,
  id_material uuid not null references public.materiais_graficos(id) on delete cascade,
  versao integer not null,
  -- Caminho no bucket PRIVADO do Supabase Storage. O acesso é sempre por URL
  -- assinada de curta duração, gerada pela API — nunca link permanente.
  caminho_arquivo text not null,
  formato text not null,
  largura integer,
  altura integer,
  tamanho_bytes bigint not null check (tamanho_bytes > 0),
  previa_caminho text,
  id_usuario_upload uuid not null references public.usuarios(id),
  criado_em timestamptz not null default now(),
  unique (id_material, versao)
);

/**
 * Todo download é registrado. Material gráfico vaza para adversário com
 * frequência, e a auditoria é o que permite descobrir por onde.
 */
create table public.downloads_arte (
  id bigint generated always as identity primary key,
  id_organizacao uuid not null references public.organizacoes(id) on delete cascade,
  id_campanha uuid not null references public.campanhas(id) on delete cascade,
  id_versao uuid not null references public.versoes_arte(id) on delete cascade,
  id_usuario uuid not null references public.usuarios(id),
  ip inet,
  user_agent text,
  criado_em timestamptz not null default now()
);

create index downloads_arte_versao_idx
  on public.downloads_arte (id_organizacao, id_versao, criado_em desc);

-- --- RLS ---------------------------------------------------------------------

select autenticacao.aplicar_rls_padrao('centros_custo', 'financeiro.ler', 'financeiro.gerenciar');
select autenticacao.aplicar_rls_padrao('categorias_lancamento', 'financeiro.ler', 'financeiro.gerenciar');
select autenticacao.aplicar_rls_padrao('fornecedores', 'financeiro.ler', 'financeiro.gerenciar');
select autenticacao.aplicar_rls_padrao('lancamentos', 'financeiro.ler', 'financeiro.gerenciar');
select autenticacao.aplicar_rls_padrao('orcamentos', 'financeiro.ler', 'financeiro.gerenciar');
select autenticacao.aplicar_rls_padrao('materiais_graficos', 'artes.ler', 'artes.gerenciar');
select autenticacao.aplicar_rls_padrao('versoes_arte', 'artes.ler', 'artes.gerenciar');

alter table public.downloads_arte enable row level security;
alter table public.downloads_arte force row level security;
create policy downloads_arte_ler on public.downloads_arte
  for select using (
    autenticacao.pertence(id_organizacao, id_campanha)
    and autenticacao.escopo_de('auditoria.ler') = 'CAMPANHA'
  );
create policy downloads_arte_registrar on public.downloads_arte
  for insert with check (
    autenticacao.pertence(id_organizacao, id_campanha)
    and id_usuario = autenticacao.id_usuario()
  );

do $$
declare
  tabela text;
begin
  foreach tabela in array array[
    'centros_custo', 'categorias_lancamento', 'fornecedores',
    'lancamentos', 'orcamentos', 'materiais_graficos'
  ] loop
    execute format(
      'create trigger %I_atualizado_em before update on public.%I
         for each row execute function public.marcar_atualizado_em();',
      tabela, tabela
    );
  end loop;
end;
$$;
