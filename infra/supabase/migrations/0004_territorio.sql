-- =============================================================================
-- 0004 — Território
--
-- Duas naturezas de tabela convivem aqui e o tratamento de RLS é diferente:
--
--  * REFERÊNCIA (estados, municípios, distritos, subdistritos): dado público do
--    IBGE, igual para todo mundo, sem `id_organizacao`. Leitura liberada a
--    qualquer autenticado; escrita só pelo ETL.
--  * DADOS DA CAMPANHA (bairros, logradouros, localidades, pontos de
--    referência): nascem do trabalho de campo do cliente, carregam
--    `id_organizacao` e são isolados como tudo o mais.
--
-- Bairro NÃO vem do IBGE: a API de Localidades para no subdistrito (verificado
-- em 31/07/2026 — a rota /municipios/{id}/bairros retorna 404). Bairro é
-- construído a partir de CEP e do cadastro em campo, e por isso precisa de
-- curadoria.
-- =============================================================================

-- --- Função utilitária de RLS ------------------------------------------------

/**
 * Aplica a política padrão de tenant a uma tabela.
 *
 * Existe para eliminar a repetição de 40 blocos idênticos de `create policy` —
 * e, mais importante, para que a regra de isolamento tenha UMA implementação.
 * Corrigir o padrão em um lugar corrige em todas as tabelas.
 */
create or replace function autenticacao.aplicar_rls_padrao(
  p_tabela text,
  p_permissao_leitura text,
  p_permissao_escrita text default null,
  p_tem_campanha boolean default true
)
returns void
language plpgsql
as $$
declare
  v_predicado_pertence text;
  v_escrita text := coalesce(p_permissao_escrita, p_permissao_leitura);
begin
  v_predicado_pertence := case
    when p_tem_campanha then 'autenticacao.pertence(id_organizacao, id_campanha)'
    else 'id_organizacao = autenticacao.id_organizacao()'
  end;

  execute format('alter table public.%I enable row level security', p_tabela);
  execute format('alter table public.%I force row level security', p_tabela);

  execute format(
    'create policy %I on public.%I for select using (%s and autenticacao.escopo_de(%L) is not null)',
    p_tabela || '_ler', p_tabela, v_predicado_pertence, p_permissao_leitura
  );

  execute format(
    'create policy %I on public.%I for insert with check (%s and autenticacao.escopo_de(%L) is not null)',
    p_tabela || '_inserir', p_tabela, v_predicado_pertence, v_escrita
  );

  execute format(
    'create policy %I on public.%I for update using (%s and autenticacao.escopo_de(%L) is not null) with check (%s)',
    p_tabela || '_alterar', p_tabela, v_predicado_pertence, v_escrita, v_predicado_pertence
  );

  execute format(
    'create policy %I on public.%I for delete using (%s and autenticacao.escopo_de(%L) = ''CAMPANHA'')',
    p_tabela || '_excluir', p_tabela, v_predicado_pertence, v_escrita
  );

  -- Porta única do backoffice: só com autorização vigente do cliente.
  execute format(
    'create policy %I on public.%I for select using (autenticacao.suporte_ativo(id_organizacao))',
    p_tabela || '_suporte', p_tabela
  );
end;
$$;

/** Tabela de referência pública (IBGE/TSE): leitura para todos, escrita pelo ETL. */
create or replace function autenticacao.aplicar_rls_referencia(p_tabela text)
returns void
language plpgsql
as $$
begin
  execute format('alter table public.%I enable row level security', p_tabela);
  execute format('alter table public.%I force row level security', p_tabela);
  execute format(
    'create policy %I on public.%I for select using (autenticacao.id_organizacao() is not null or autenticacao.eh_provedor())',
    p_tabela || '_ler', p_tabela
  );
  -- Sem política de escrita: o ETL roda com a chave de serviço, que não se
  -- aplica a tabela multi-tenant e é permitida apenas aqui.
end;
$$;

-- --- Referência do IBGE ------------------------------------------------------

create table public.estados (
  id_ibge integer primary key,
  sigla char(2) not null unique,
  nome text not null,
  regiao text not null
);

create table public.municipios (
  id_ibge integer primary key,
  id_estado integer not null references public.estados(id_ibge),
  nome text not null,
  nome_normalizado text generated always as (public.normalizar_texto(nome)) stored,
  id_microrregiao integer,
  nome_microrregiao text,
  id_mesorregiao integer,
  nome_mesorregiao text,
  populacao integer
);

create index municipios_estado_idx on public.municipios (id_estado, nome);
create index municipios_nome_trgm_idx on public.municipios using gin (nome_normalizado gin_trgm_ops);

create table public.distritos (
  id_ibge integer primary key,
  id_municipio integer not null references public.municipios(id_ibge),
  nome text not null
);

create table public.subdistritos (
  id_ibge integer primary key,
  id_distrito integer not null references public.distritos(id_ibge),
  nome text not null
);

create index distritos_municipio_idx on public.distritos (id_municipio);
create index subdistritos_distrito_idx on public.subdistritos (id_distrito);

select autenticacao.aplicar_rls_referencia('estados');
select autenticacao.aplicar_rls_referencia('municipios');
select autenticacao.aplicar_rls_referencia('distritos');
select autenticacao.aplicar_rls_referencia('subdistritos');

-- --- Enums do território -----------------------------------------------------

create type public.origem_registro_territorial as enum
  ('IBGE', 'CEP', 'TSE', 'CNEFE', 'USUARIO');
create type public.tipo_localidade as enum
  ('POVOADO', 'ASSENTAMENTO', 'SITIO', 'COMUNIDADE', 'RURAL');

-- --- Bairros -----------------------------------------------------------------

create table public.bairros (
  id uuid primary key default gen_random_uuid(),
  id_organizacao uuid not null references public.organizacoes(id) on delete cascade,
  id_campanha uuid references public.campanhas(id) on delete cascade,
  id_municipio integer not null references public.municipios(id_ibge),
  nome text not null,
  nome_normalizado text generated always as (public.normalizar_texto(nome)) stored,
  origem public.origem_registro_territorial not null default 'USUARIO',
  id_usuario_criador uuid references public.usuarios(id),
  -- Bairro criado em campo entra como não validado e vai para a fila de
  -- curadoria do coordenador, para evitar "Centro" × "centro" × "CENTRO".
  validado boolean not null default false,
  id_bairro_mesclado_em uuid references public.bairros(id),
  total_domicilios_estimado integer,
  criado_em timestamptz not null default now(),
  atualizado_em timestamptz not null default now()
);

create index bairros_org_municipio_idx on public.bairros (id_organizacao, id_municipio);
create index bairros_curadoria_idx
  on public.bairros (id_organizacao, id_municipio) where validado = false;
create index bairros_nome_trgm_idx on public.bairros using gin (nome_normalizado gin_trgm_ops);

-- --- Logradouros -------------------------------------------------------------

create table public.logradouros (
  id uuid primary key default gen_random_uuid(),
  id_organizacao uuid not null references public.organizacoes(id) on delete cascade,
  id_campanha uuid references public.campanhas(id) on delete cascade,
  id_bairro uuid not null references public.bairros(id) on delete cascade,
  tipo text,
  nome text not null,
  -- Forma canônica usada na deduplicação. Espelha `normalizarLogradouro` do
  -- pacote de utilitários, incluindo a expansão de abreviaturas, que é feita na
  -- aplicação antes de gravar.
  nome_canonico text not null,
  cep char(8),
  origem public.origem_registro_territorial not null default 'USUARIO',
  id_usuario_criador uuid references public.usuarios(id),
  validado boolean not null default false,
  id_logradouro_mesclado_em uuid references public.logradouros(id),
  criado_em timestamptz not null default now(),
  atualizado_em timestamptz not null default now()
);

create index logradouros_org_bairro_idx on public.logradouros (id_organizacao, id_bairro);
create index logradouros_cep_idx on public.logradouros (id_organizacao, cep) where cep is not null;
create index logradouros_canonico_trgm_idx
  on public.logradouros using gin (nome_canonico gin_trgm_ops);
-- Impede duplicata exata dentro do mesmo bairro; a fuzzy fica com a curadoria.
create unique index logradouros_unicidade_idx
  on public.logradouros (id_bairro, nome_canonico) where id_logradouro_mesclado_em is null;

create table public.localidades (
  id uuid primary key default gen_random_uuid(),
  id_organizacao uuid not null references public.organizacoes(id) on delete cascade,
  id_campanha uuid references public.campanhas(id) on delete cascade,
  id_municipio integer not null references public.municipios(id_ibge),
  nome text not null,
  nome_normalizado text generated always as (public.normalizar_texto(nome)) stored,
  tipo public.tipo_localidade not null default 'COMUNIDADE',
  latitude double precision,
  longitude double precision,
  criado_em timestamptz not null default now(),
  atualizado_em timestamptz not null default now()
);

create index localidades_org_municipio_idx on public.localidades (id_organizacao, id_municipio);

create table public.pontos_referencia (
  id uuid primary key default gen_random_uuid(),
  id_organizacao uuid not null references public.organizacoes(id) on delete cascade,
  id_campanha uuid references public.campanhas(id) on delete cascade,
  id_logradouro uuid references public.logradouros(id) on delete cascade,
  descricao text not null,
  latitude double precision,
  longitude double precision,
  criado_em timestamptz not null default now(),
  atualizado_em timestamptz not null default now()
);

create index pontos_referencia_logradouro_idx
  on public.pontos_referencia (id_organizacao, id_logradouro);

-- --- Cache de CEP ------------------------------------------------------------

/**
 * Cache permanente de CEP. Sem `id_organizacao`: CEP é dado público e a
 * consulta de uma organização aproveita para todas — reduz drasticamente as
 * chamadas ao BrasilAPI/ViaCEP e o sistema segue funcionando se as duas fontes
 * caírem.
 */
create table public.cache_cep (
  cep char(8) primary key,
  logradouro text,
  complemento text,
  bairro text,
  id_municipio integer references public.municipios(id_ibge),
  nome_municipio text,
  uf char(2),
  latitude double precision,
  longitude double precision,
  fonte text not null,
  consultado_em timestamptz not null default now()
);

select autenticacao.aplicar_rls_referencia('cache_cep');

-- --- Aplicação da RLS padrão -------------------------------------------------

select autenticacao.aplicar_rls_padrao('bairros', 'territorio.ler', 'territorio.gerenciar');
select autenticacao.aplicar_rls_padrao('logradouros', 'territorio.ler', 'territorio.gerenciar');
select autenticacao.aplicar_rls_padrao('localidades', 'territorio.ler', 'territorio.gerenciar');
select autenticacao.aplicar_rls_padrao('pontos_referencia', 'territorio.ler', 'territorio.gerenciar');

do $$
declare
  tabela text;
begin
  foreach tabela in array array['bairros', 'logradouros', 'localidades', 'pontos_referencia']
  loop
    execute format(
      'create trigger %I_atualizado_em before update on public.%I
         for each row execute function public.marcar_atualizado_em();',
      tabela, tabela
    );
  end loop;
end;
$$;

-- --- Sugestão de duplicatas --------------------------------------------------

/**
 * Devolve os logradouros mais parecidos com o nome informado, dentro do mesmo
 * município e da mesma organização. Chamada antes de permitir o cadastro de um
 * logradouro novo — o entrevistador vê "você quis dizer?" em vez de criar a
 * terceira grafia da mesma rua.
 *
 * Usa `similarity` do pg_trgm, o mesmo algoritmo que a função `similaridade`
 * do pacote de utilitários reproduz no cliente.
 */
create or replace function public.sugerir_logradouros_similares(
  p_id_organizacao uuid,
  p_id_municipio integer,
  p_nome_canonico text,
  p_limiar real default 0.45,
  p_limite integer default 5
)
returns table (
  id uuid,
  nome text,
  nome_bairro text,
  similaridade real
)
language sql
stable
as $$
  select l.id, l.nome, b.nome, similarity(l.nome_canonico, p_nome_canonico) as sim
  from public.logradouros l
  join public.bairros b on b.id = l.id_bairro
  where l.id_organizacao = p_id_organizacao
    and b.id_municipio = p_id_municipio
    and l.id_logradouro_mesclado_em is null
    and similarity(l.nome_canonico, p_nome_canonico) >= p_limiar
  order by sim desc, l.nome
  limit p_limite;
$$;
