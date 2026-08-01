-- =============================================================================
-- 0005 — Estrutura eleitoral oficial (TSE)
--
-- Tudo aqui é dado público e AGREGADO. Não existe e não existirá tabela de
-- eleitores nominais: o cadastro eleitoral do TSE não é público e reconstruí-lo
-- seria ilícito (seção 2.3 do escopo). Trabalhamos com totais por seção.
--
-- Carga sob demanda por UF das campanhas ativas — decisão da Fase 0. Os CSVs do
-- TSE já vêm separados por UF, o que torna essa granularidade natural.
-- =============================================================================

create type public.tipo_voto as enum ('NOMINAL', 'LEGENDA', 'BRANCO', 'NULO', 'ABSTENCAO');

create table public.zonas_eleitorais (
  id uuid primary key default gen_random_uuid(),
  id_estado integer not null references public.estados(id_ibge),
  numero integer not null,
  nome text,
  id_municipio_sede integer references public.municipios(id_ibge),
  unique (id_estado, numero)
);

create table public.locais_votacao (
  id uuid primary key default gen_random_uuid(),
  id_zona uuid not null references public.zonas_eleitorais(id) on delete cascade,
  id_municipio integer not null references public.municipios(id_ibge),
  codigo integer not null,
  nome text not null,
  endereco text,
  bairro_declarado text,
  cep char(8),
  latitude double precision,
  longitude double precision,
  unique (id_zona, codigo)
);

create index locais_votacao_municipio_idx on public.locais_votacao (id_municipio);

create table public.secoes_eleitorais (
  id uuid primary key default gen_random_uuid(),
  id_zona uuid not null references public.zonas_eleitorais(id) on delete cascade,
  id_local_votacao uuid not null references public.locais_votacao(id) on delete cascade,
  id_municipio integer not null references public.municipios(id_ibge),
  numero integer not null,
  -- Seção agregadora recebe eleitores de outras seções na urna. Ignorar isso
  -- faz a projeção errar o denominador em locais pequenos.
  agregadora boolean not null default false,
  id_secao_agregadora uuid references public.secoes_eleitorais(id),
  unique (id_zona, numero)
);

create index secoes_local_idx on public.secoes_eleitorais (id_local_votacao);
create index secoes_municipio_idx on public.secoes_eleitorais (id_municipio);

/**
 * Perfil do eleitorado por seção. Fonte: dataset `eleitorado-2026` do TSE
 * Dados Abertos (CSV por UF, publicado em 21/07/2026). É o denominador de toda
 * projeção: sem ele não há como dizer "78% da seção", só "78% de quem eu
 * entrevistei".
 */
create table public.eleitorado_secao (
  id_secao uuid not null references public.secoes_eleitorais(id) on delete cascade,
  ano_referencia integer not null,
  total_eleitores integer not null check (total_eleitores >= 0),
  faixa_etaria jsonb not null default '{}'::jsonb,
  genero jsonb not null default '{}'::jsonb,
  escolaridade jsonb not null default '{}'::jsonb,
  estado_civil jsonb not null default '{}'::jsonb,
  total_deficiencia integer,
  total_biometria integer,
  atualizado_em timestamptz not null default now(),
  primary key (id_secao, ano_referencia)
);

/**
 * Resultado oficial por seção. Base do comparativo histórico e insumo do método
 * HISTORICO_PONDERADO do motor de projeção.
 *
 * `id_candidato_tse` é o identificador do TSE, não o `id` interno de
 * `candidatos` — resultados existem para candidatos que a campanha nunca
 * cadastrou, e a tabela precisa ser independente do cadastro do cliente.
 */
create table public.resultados_oficiais (
  id bigint generated always as identity primary key,
  ano integer not null,
  turno smallint not null check (turno in (1, 2)),
  id_secao uuid not null references public.secoes_eleitorais(id) on delete cascade,
  codigo_cargo integer not null,
  id_candidato_tse bigint,
  numero_urna text,
  nome_urna text,
  sigla_partido text,
  votos integer not null check (votos >= 0),
  tipo public.tipo_voto not null default 'NOMINAL'
);

create index resultados_secao_idx
  on public.resultados_oficiais (id_secao, ano, turno, codigo_cargo);
create index resultados_candidato_idx
  on public.resultados_oficiais (ano, turno, codigo_cargo, id_candidato_tse);
create unique index resultados_unicidade_idx
  on public.resultados_oficiais
     (ano, turno, id_secao, codigo_cargo, (coalesce(id_candidato_tse, 0)), tipo);

select autenticacao.aplicar_rls_referencia('zonas_eleitorais');
select autenticacao.aplicar_rls_referencia('locais_votacao');
select autenticacao.aplicar_rls_referencia('secoes_eleitorais');
select autenticacao.aplicar_rls_referencia('eleitorado_secao');
select autenticacao.aplicar_rls_referencia('resultados_oficiais');

/**
 * Vínculo entre a estrutura oficial e o território mapeado pela campanha.
 * É dado do cliente (a campanha é que descobre, em campo, que a Rua X vota na
 * seção Y), portanto carrega `id_organizacao` e RLS completa.
 */
create table public.secao_bairros (
  id uuid primary key default gen_random_uuid(),
  id_organizacao uuid not null references public.organizacoes(id) on delete cascade,
  id_campanha uuid not null references public.campanhas(id) on delete cascade,
  id_secao uuid not null references public.secoes_eleitorais(id) on delete cascade,
  id_bairro uuid not null references public.bairros(id) on delete cascade,
  -- Peso da relação: um bairro pode votar em várias seções e vice-versa.
  proporcao_estimada numeric(5, 4) not null default 1 check (proporcao_estimada between 0 and 1),
  criado_em timestamptz not null default now(),
  atualizado_em timestamptz not null default now(),
  unique (id_campanha, id_secao, id_bairro)
);

create index secao_bairros_org_idx on public.secao_bairros (id_organizacao, id_campanha, id_bairro);

select autenticacao.aplicar_rls_padrao('secao_bairros', 'territorio.ler', 'territorio.gerenciar');
