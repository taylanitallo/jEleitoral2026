-- =============================================================================
-- 0022 — Áreas estratégicas e coordenação por área
--
-- O pedido trazia "coordenação política dividida por áreas" e "áreas
-- estratégicas" como duas coisas. São a mesma estrutura com naturezas
-- diferentes: uma recorta o mapa (Zona Norte, Rural), a outra recorta o
-- público (Saúde, Juventude, Mulheres). Ambas têm coordenador, ações,
-- atividades e diagnóstico; o que muda são duas colunas anuláveis. Duas
-- tabelas dariam duas telas quase idênticas e nenhum relatório que some as
-- duas.
--
-- IMPORTANTE, e é o ponto de arquitetura: **área não é um novo nível
-- territorial**. Já existem três noções de território no sistema — a malha
-- física (bairros/seções), a referência polimórfica `nivel + id_referencia`
-- usada por `metas` e `lancamentos`, e o claim `territorios` do JWT, montado
-- pelo hook 0014 a partir de `secao_bairros`.
--
-- Área é um AGRUPAMENTO NOMEADO sobre o que já existe. O hook do token NÃO
-- muda: fazê-lo derivar território de área obrigaria a reemitir todos os
-- tokens, que é a alteração de maior risco deste sistema.
-- =============================================================================

create type public.natureza_area as enum ('TERRITORIAL', 'TEMATICA', 'SEGMENTO');
create type public.prioridade as enum ('ALTA', 'MEDIA', 'BAIXA');

create table public.areas_estrategicas (
  id uuid primary key default gen_random_uuid(),
  id_organizacao uuid not null references public.organizacoes(id) on delete cascade,
  id_campanha uuid not null references public.campanhas(id) on delete cascade,

  nome text not null,
  nome_normalizado text generated always as (public.normalizar_texto(nome)) stored,
  natureza public.natureza_area not null default 'TERRITORIAL',
  -- Só faz sentido quando a natureza é temática. Fica nulo no resto.
  tema text,
  prioridade public.prioridade not null default 'MEDIA',

  id_coordenador uuid references public.usuarios(id) on delete set null,
  /*
   * A equipe é o que liga a área ao escopo do JWT.
   *
   * Quem trabalha a área entra em `equipe_membros`, e o hook 0014 já deriva o
   * território dessa equipe. O alinhamento entre área e território do token é
   * OPERACIONAL — atribuir à equipe as seções da área — e não automático. Isso
   * é deliberado: automatizar exigiria mexer no hook.
   */
  id_equipe uuid references public.equipes(id) on delete set null,

  meta_votos integer check (meta_votos >= 0),
  descricao text,
  ativa boolean not null default true,

  criado_em timestamptz not null default now(),
  atualizado_em timestamptz not null default now(),

  unique (id_campanha, nome_normalizado),
  constraint area_tema_so_em_tematica
    check (natureza = 'TEMATICA' or tema is null)
);

create index areas_org_idx on public.areas_estrategicas (id_organizacao, id_campanha, natureza);
create index areas_coordenador_idx on public.areas_estrategicas (id_organizacao, id_coordenador);

/*
 * A composição da área, no mesmo padrão polimórfico de `metas` (0008:26) e
 * `lancamentos` (0009:71).
 *
 * Uma área real é "três bairros, mais duas seções específicas, mais uma zona
 * inteira". Uma FK única impediria isso e forçaria o coordenador a criar áreas
 * artificiais que coincidissem com um único nível.
 *
 * `LOCALIDADE` não entra: o enum `nivel_territorial` não tem esse valor, e
 * acrescentá-lo afetaria `metas`, `lancamentos` e `projecoes`.
 */
create table public.area_territorios (
  id uuid primary key default gen_random_uuid(),
  id_organizacao uuid not null references public.organizacoes(id) on delete cascade,
  id_campanha uuid not null references public.campanhas(id) on delete cascade,
  id_area uuid not null references public.areas_estrategicas(id) on delete cascade,

  nivel public.nivel_territorial not null
    check (nivel in ('SECAO', 'LOCAL', 'BAIRRO', 'ZONA')),
  id_referencia text not null,
  -- Bairro dividido entre duas áreas: cada uma leva a fração que lhe cabe, para
  -- a soma dos eleitorados não contar o mesmo eleitor duas vezes.
  peso numeric(5,4) not null default 1 check (peso > 0 and peso <= 1),

  criado_em timestamptz not null default now(),

  unique (id_area, nivel, id_referencia)
);

create index area_territorios_org_idx on public.area_territorios (id_organizacao, id_area);
create index area_territorios_ref_idx
  on public.area_territorios (id_organizacao, id_campanha, nivel, id_referencia);

do $$
declare
  tabela text;
begin
  foreach tabela in array array['areas_estrategicas']
  loop
    execute format(
      'create trigger %I before update on public.%I
         for each row execute function public.marcar_atualizado_em()',
      tabela || '_atualizado_em', tabela
    );
  end loop;
end;
$$;

-- --- A ponte da área para a malha de bairros ---------------------------------

/*
 * Expande a composição de uma área para a lista de bairros que ela cobre.
 *
 * Existe porque quase tudo que se quer saber de uma área — quantos eleitores,
 * quantos mapeados, qual a cobertura — está indexado por bairro ou por seção,
 * e não por área. Sem esta função, cada consulta reescreveria o mesmo `union`
 * de quatro níveis, e uma delas acabaria divergindo.
 *
 * `stable` e não `immutable`: lê tabelas, e o resultado muda quando a
 * composição da área muda.
 */
create or replace function public.bairros_da_area(p_id_area uuid)
returns table (id_bairro uuid)
language sql
stable
as $$
  select distinct b.id
    from public.area_territorios t
    join public.bairros b on true
   where t.id_area = p_id_area
     and (
       -- Bairro indicado diretamente.
       (t.nivel = 'BAIRRO' and b.id = t.id_referencia::uuid)
       -- Seção: a proporção de cada bairro vem de secao_bairros, que é dado do
       -- cliente e já existe para a projeção.
       or (t.nivel = 'SECAO' and exists (
             select 1 from public.secao_bairros sb
              where sb.id_secao = t.id_referencia::uuid and sb.id_bairro = b.id))
       -- Local de votação e zona: descem até a seção antes de chegar ao bairro.
       or (t.nivel = 'LOCAL' and exists (
             select 1
               from public.secoes_eleitorais s
               join public.secao_bairros sb on sb.id_secao = s.id
              where s.id_local_votacao = t.id_referencia::uuid and sb.id_bairro = b.id))
       or (t.nivel = 'ZONA' and exists (
             select 1
               from public.secoes_eleitorais s
               join public.secao_bairros sb on sb.id_secao = s.id
              where s.id_zona = t.id_referencia::uuid and sb.id_bairro = b.id))
     );
$$;

comment on function public.bairros_da_area(uuid) is
  'Expande a composição de uma área estratégica para os bairros que ela cobre. '
  'Fonte única dessa expansão — reescrevê-la em cada consulta faria as versões '
  'divergirem.';

-- --- Permissões --------------------------------------------------------------

insert into public.permissoes (chave, modulo, descricao) values
  ('planejamento.ler',       'Planejamento', 'Consultar plano, áreas estratégicas, eixos e ações'),
  ('planejamento.gerenciar', 'Planejamento', 'Criar e editar plano, áreas, eixos e ações')
on conflict (chave) do nothing;

select public.conceder_permissao_padrao('ADMINISTRADOR', 'planejamento.ler',       'CAMPANHA');
select public.conceder_permissao_padrao('ADMINISTRADOR', 'planejamento.gerenciar', 'CAMPANHA');
select public.conceder_permissao_padrao('COORDENADOR',   'planejamento.ler',       'CAMPANHA');
select public.conceder_permissao_padrao('COORDENADOR',   'planejamento.gerenciar', 'CAMPANHA');
-- O mobilizador precisa saber a que área pertence e qual a meta dela, mas não
-- redesenha o plano da campanha.
select public.conceder_permissao_padrao('MOBILIZADOR',   'planejamento.ler',       'CAMPANHA');
select public.conceder_permissao_padrao('ANALISTA',      'planejamento.ler',       'CAMPANHA');
select public.conceder_permissao_padrao('CANDIDATO',     'planejamento.ler',       'CAMPANHA');

-- --- RLS ---------------------------------------------------------------------

/*
 * Aqui o padrão serve, ao contrário de `ativistas` e `atividades`.
 *
 * Área estratégica é informação estruturante: quem trabalha numa área precisa
 * saber quais são as outras, quem as coordena e qual a prioridade de cada uma.
 * Esconder isso por escopo produziria telefonema para a coordenação central, e
 * não proteção — não há dado pessoal em nome de área.
 */
select autenticacao.aplicar_rls_padrao(
  'areas_estrategicas', 'planejamento.ler', 'planejamento.gerenciar'
);
select autenticacao.aplicar_rls_padrao(
  'area_territorios', 'planejamento.ler', 'planejamento.gerenciar'
);

comment on table public.areas_estrategicas is
  'Agrupamento nomeado sobre a malha existente — NÃO é um novo nível '
  'territorial. Territorial e temática na mesma tabela porque divergem em duas '
  'colunas anuláveis, não em estrutura.';
