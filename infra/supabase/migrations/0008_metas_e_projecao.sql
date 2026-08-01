-- =============================================================================
-- 0008 — Metas e projeção
--
-- A projeção é auditável por construção: cada linha guarda o método usado, os
-- insumos que a produziram e a COBERTURA AMOSTRAL. Projetar 78% com 3% da
-- seção mapeada é irresponsável, e o número precisa carregar essa informação
-- junto — não numa nota de rodapé que ninguém lê.
-- =============================================================================

create type public.tipo_meta as enum ('VOTOS_ABSOLUTOS', 'PERCENTUAL');
create type public.nivel_territorial as enum
  ('SECAO', 'LOCAL', 'BAIRRO', 'ZONA', 'MUNICIPIO', 'ESTADO');
create type public.metodo_projecao as enum
  ('AMOSTRA_DIRETA', 'HISTORICO_PONDERADO', 'HIBRIDO', 'SEM_BASE');

create table public.metas (
  id uuid primary key default gen_random_uuid(),
  id_organizacao uuid not null references public.organizacoes(id) on delete cascade,
  id_campanha uuid not null references public.campanhas(id) on delete cascade,
  id_candidato uuid not null references public.candidatos(id) on delete cascade,
  id_cargo uuid not null references public.cargos(id),
  tipo public.tipo_meta not null default 'VOTOS_ABSOLUTOS',
  valor numeric(12, 2) not null check (valor > 0),
  nivel public.nivel_territorial not null,
  -- Aponta para a seção, bairro, zona, município ou estado conforme `nivel`.
  -- Polimórfico de propósito: uma FK por nível daria seis colunas quase sempre
  -- nulas e um índice inútil.
  id_referencia text not null,
  prazo date,
  id_responsavel uuid references public.usuarios(id),
  observacoes text,
  criado_em timestamptz not null default now(),
  atualizado_em timestamptz not null default now(),
  unique (id_campanha, id_candidato, nivel, id_referencia)
);

create index metas_campanha_idx on public.metas (id_organizacao, id_campanha, nivel);
create index metas_responsavel_idx on public.metas (id_organizacao, id_responsavel);

create table public.meta_apuracoes (
  id uuid primary key default gen_random_uuid(),
  id_organizacao uuid not null references public.organizacoes(id) on delete cascade,
  id_campanha uuid not null references public.campanhas(id) on delete cascade,
  id_meta uuid not null references public.metas(id) on delete cascade,
  data_referencia date not null,
  realizado numeric(12, 2) not null default 0,
  projetado numeric(12, 2) not null default 0,
  percentual_atingimento numeric(6, 4) not null default 0,
  criado_em timestamptz not null default now(),
  unique (id_meta, data_referencia)
);

create index meta_apuracoes_meta_idx
  on public.meta_apuracoes (id_organizacao, id_meta, data_referencia desc);

create table public.projecoes (
  id uuid primary key default gen_random_uuid(),
  id_organizacao uuid not null references public.organizacoes(id) on delete cascade,
  id_campanha uuid not null references public.campanhas(id) on delete cascade,
  id_cargo uuid not null references public.cargos(id),
  id_candidato uuid not null references public.candidatos(id) on delete cascade,
  nivel public.nivel_territorial not null,
  id_referencia text not null,
  votos_projetados numeric(12, 2) not null check (votos_projetados >= 0),
  intervalo_min numeric(12, 2) not null check (intervalo_min >= 0),
  intervalo_max numeric(12, 2) not null,
  -- 0 a 1. Combina cobertura amostral, consistência com o histórico e grau de
  -- certeza declarado pelos entrevistados.
  indice_confianca numeric(5, 4) not null check (indice_confianca between 0 and 1),
  -- Fração do eleitorado do recorte efetivamente entrevistada. Exibida SEMPRE
  -- ao lado do número projetado.
  cobertura_amostral numeric(5, 4) not null check (cobertura_amostral between 0 and 1),
  eleitorado_base integer not null check (eleitorado_base >= 0),
  amostra_tamanho integer not null check (amostra_tamanho >= 0),
  metodo public.metodo_projecao not null,
  -- Insumos que produziram o número, para reconstituir o cálculo depois.
  insumos jsonb not null default '{}'::jsonb,
  calculado_em timestamptz not null default now(),
  constraint projecoes_intervalo_check check (intervalo_max >= intervalo_min),
  unique (id_campanha, id_candidato, nivel, id_referencia)
);

create index projecoes_campanha_idx
  on public.projecoes (id_organizacao, id_campanha, id_cargo, nivel);
create index projecoes_referencia_idx
  on public.projecoes (id_organizacao, id_campanha, nivel, id_referencia);
-- Ranking de seções por potencial: onde há voto a ganhar.
create index projecoes_potencial_idx
  on public.projecoes (id_organizacao, id_campanha, votos_projetados desc);

select autenticacao.aplicar_rls_padrao('metas', 'metas.ler', 'metas.gerenciar');
select autenticacao.aplicar_rls_padrao('meta_apuracoes', 'metas.ler', 'metas.gerenciar');
select autenticacao.aplicar_rls_padrao('projecoes', 'projecao.ler', 'projecao.gerenciar');

create trigger metas_atualizado_em before update on public.metas
  for each row execute function public.marcar_atualizado_em();

/**
 * Cobertura amostral de uma seção: entrevistados distintos sobre o total de
 * eleitores da seção segundo o TSE.
 *
 * Fica no banco porque tanto o motor de projeção quanto os painéis precisam do
 * mesmo número — duas implementações divergiriam e o usuário veria coberturas
 * diferentes em telas diferentes.
 */
create or replace function public.calcular_cobertura_secao(
  p_id_campanha uuid,
  p_id_secao uuid,
  p_ano_referencia integer default 2026
)
returns numeric
language sql
stable
as $$
  select case
    when coalesce(el.total_eleitores, 0) = 0 then 0
    else least(1, count(distinct e.id)::numeric / el.total_eleitores)
  end
  from public.eleitorado_secao el
  left join public.entrevistados e
    on e.id_secao = el.id_secao
   and e.id_campanha = p_id_campanha
   and e.anonimizado_em is null
  where el.id_secao = p_id_secao
    and el.ano_referencia = p_ano_referencia
  group by el.total_eleitores;
$$;
