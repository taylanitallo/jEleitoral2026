-- =============================================================================
-- 0006 — Partidos, federações, cargos e candidatos
--
-- Duas vias de origem, conforme decidido na Fase 0:
--   MANUAL        — pré-candidatos, operacional desde já;
--   DADOS_ABERTOS — CSV oficial do dataset `candidatos-2026` (fonte primária);
--   DIVULGACAND   — complemento sob demanda (foto e detalhe individual).
--
-- A mesclagem entre as vias nunca é silenciosa: colisão vai para fila de
-- revisão. Duplicar candidato corrompe toda a projeção do cargo.
-- =============================================================================

create type public.origem_candidato as enum ('MANUAL', 'DIVULGACAND', 'DADOS_ABERTOS');

create table public.partidos (
  id uuid primary key default gen_random_uuid(),
  numero integer not null unique,
  sigla text not null unique,
  nome text not null
);

create table public.federacoes (
  id uuid primary key default gen_random_uuid(),
  ano integer not null,
  nome text not null,
  sigla text not null,
  unique (ano, sigla)
);

create table public.federacao_partidos (
  id_federacao uuid not null references public.federacoes(id) on delete cascade,
  id_partido uuid not null references public.partidos(id) on delete cascade,
  primary key (id_federacao, id_partido)
);

/**
 * Cargos em disputa. `quantidade_votos_permitida` existe por causa do Senado:
 * em 2026 renovam-se 2/3 das cadeiras, ou seja, o eleitor vota em DOIS
 * senadores. Tratar como voto único produziria intenção de voto pela metade.
 */
create table public.cargos (
  id uuid primary key default gen_random_uuid(),
  codigo_tse integer not null unique,
  nome text not null,
  abrangencia public.abrangencia_campanha not null,
  quantidade_votos_permitida smallint not null default 1
    check (quantidade_votos_permitida between 1 and 2),
  digitos_numero_urna smallint not null check (digitos_numero_urna between 2 and 5)
);

select autenticacao.aplicar_rls_referencia('partidos');
select autenticacao.aplicar_rls_referencia('federacoes');
select autenticacao.aplicar_rls_referencia('federacao_partidos');
select autenticacao.aplicar_rls_referencia('cargos');

create table public.candidatos (
  id uuid primary key default gen_random_uuid(),
  id_organizacao uuid not null references public.organizacoes(id) on delete cascade,
  id_campanha uuid not null references public.campanhas(id) on delete cascade,
  id_cargo uuid not null references public.cargos(id),
  nome_completo text not null,
  nome_urna text not null,
  nome_urna_normalizado text generated always as (public.normalizar_texto(nome_urna)) stored,
  numero_urna text not null,
  id_partido uuid references public.partidos(id),
  id_federacao uuid references public.federacoes(id),
  uf char(2),
  foto_url text,
  -- Identificador do TSE. Nulo enquanto o candidato só existe como
  -- pré-candidatura no cadastro manual.
  id_tse bigint,
  origem public.origem_candidato not null default 'MANUAL',
  situacao text,
  -- Marca o(s) candidato(s) da própria campanha; os demais são concorrentes
  -- acompanhados.
  proprio boolean not null default false,
  ativo boolean not null default true,
  sincronizado_em timestamptz,
  criado_em timestamptz not null default now(),
  atualizado_em timestamptz not null default now()
);

create index candidatos_campanha_cargo_idx
  on public.candidatos (id_organizacao, id_campanha, id_cargo);
create index candidatos_proprio_idx
  on public.candidatos (id_organizacao, id_campanha) where proprio = true;
create index candidatos_nome_trgm_idx
  on public.candidatos using gin (nome_urna_normalizado gin_trgm_ops);
-- Dentro de uma campanha, o número de urna identifica o candidato em cada cargo.
create unique index candidatos_numero_idx
  on public.candidatos (id_campanha, id_cargo, numero_urna) where ativo = true;
create unique index candidatos_tse_idx
  on public.candidatos (id_campanha, id_tse) where id_tse is not null;

select autenticacao.aplicar_rls_padrao('candidatos', 'candidatos.ler', 'candidatos.gerenciar');

/**
 * Fila de revisão de mesclagem.
 *
 * Quando a sincronização encontra um candidato oficial que se parece com um
 * pré-candidato cadastrado à mão, ela NÃO decide sozinha: registra aqui a
 * sugestão com o grau de similaridade e espera o coordenador. Mesclar errado
 * dois candidatos de partidos diferentes é pior do que ter uma linha duplicada
 * por alguns dias.
 */
create table public.mesclagens_candidato (
  id uuid primary key default gen_random_uuid(),
  id_organizacao uuid not null references public.organizacoes(id) on delete cascade,
  id_campanha uuid not null references public.campanhas(id) on delete cascade,
  id_candidato_manual uuid not null references public.candidatos(id) on delete cascade,
  id_tse_sugerido bigint not null,
  dados_oficiais jsonb not null,
  similaridade_nome real not null,
  numero_confere boolean not null,
  partido_confere boolean not null,
  status text not null default 'PENDENTE'
    check (status in ('PENDENTE', 'ACEITA', 'RECUSADA')),
  decidido_por uuid references public.usuarios(id),
  decidido_em timestamptz,
  criado_em timestamptz not null default now(),
  atualizado_em timestamptz not null default now(),
  unique (id_campanha, id_candidato_manual, id_tse_sugerido)
);

create index mesclagens_pendentes_idx
  on public.mesclagens_candidato (id_organizacao, id_campanha) where status = 'PENDENTE';

select autenticacao.aplicar_rls_padrao(
  'mesclagens_candidato', 'candidatos.ler', 'candidatos.gerenciar'
);

do $$
declare
  tabela text;
begin
  foreach tabela in array array['candidatos', 'mesclagens_candidato']
  loop
    execute format(
      'create trigger %I_atualizado_em before update on public.%I
         for each row execute function public.marcar_atualizado_em();',
      tabela, tabela
    );
  end loop;
end;
$$;

-- --- Semente de cargos de 2026 ----------------------------------------------

insert into public.cargos (codigo_tse, nome, abrangencia, quantidade_votos_permitida, digitos_numero_urna)
values
  (1, 'Presidente', 'FEDERAL', 1, 2),
  (3, 'Governador', 'ESTADUAL', 1, 2),
  -- 2026 renova 2/3 do Senado: dois votos por eleitor.
  (5, 'Senador', 'ESTADUAL', 2, 3),
  (6, 'Deputado Federal', 'FEDERAL', 1, 4),
  (7, 'Deputado Estadual', 'ESTADUAL', 1, 5),
  (8, 'Deputado Distrital', 'ESTADUAL', 1, 5)
on conflict (codigo_tse) do nothing;
