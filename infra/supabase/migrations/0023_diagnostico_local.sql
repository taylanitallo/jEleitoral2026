-- =============================================================================
-- 0023 — Diagnóstico local
--
-- O que a campanha ouve na rua, registrado de forma que dê para CONTAR.
--
-- A decisão que governa este arquivo: `tema` é enum, não texto livre. A cadeia
-- que vem depois — diagnóstico alimenta a linha narrativa — depende de somar
-- "problemas mais citados". Com texto livre, "falta de médico", "saúde ruim" e
-- "posto fechado" viram três temas distintos, o agregado perde sentido e o que
-- chega à IA é ruído. `OUTRO` mais `tema_livre` é a válvula de escape para o
-- que não couber.
--
-- O que NÃO existe aqui, de propósito: nenhuma coluna identificando quem
-- relatou o problema. Registrar o morador que reclamou criaria titular de dado
-- sem consentimento colhido e sem finalidade declarada. Quem registra é usuário
-- do sistema; quem relatou fica no agregado.
-- =============================================================================

create type public.status_diagnostico as enum ('EM_COLETA', 'CONSOLIDADO', 'ARQUIVADO');

create type public.tema_problema as enum (
  'SAUDE', 'EDUCACAO', 'SEGURANCA', 'INFRAESTRUTURA', 'MOBILIDADE', 'SANEAMENTO',
  'EMPREGO_RENDA', 'ASSISTENCIA_SOCIAL', 'CULTURA_ESPORTE', 'MEIO_AMBIENTE',
  'AGRICULTURA', 'HABITACAO', 'GESTAO_PUBLICA', 'OUTRO'
);

create type public.origem_problema as enum (
  'ENTREVISTA', 'REUNIAO', 'VISITA', 'LIDERANCA', 'OBSERVACAO', 'DADO_PUBLICO'
);

create table public.diagnosticos (
  id uuid primary key default gen_random_uuid(),
  id_organizacao uuid not null references public.organizacoes(id) on delete cascade,
  id_campanha uuid not null references public.campanhas(id) on delete cascade,

  titulo text not null,
  id_area uuid references public.areas_estrategicas(id) on delete set null,
  -- Escopo alternativo à área, no mesmo polimorfismo de `metas` e
  -- `area_territorios`: nem todo diagnóstico nasce dentro de uma área.
  nivel public.nivel_territorial,
  id_referencia text,

  metodo text,
  status public.status_diagnostico not null default 'EM_COLETA',
  periodo_inicio date,
  periodo_fim date,
  id_usuario_responsavel uuid references public.usuarios(id) on delete set null,
  sintese text,

  criado_em timestamptz not null default now(),
  atualizado_em timestamptz not null default now(),

  constraint diagnostico_periodo_coerente
    check (periodo_fim is null or periodo_inicio is null or periodo_fim >= periodo_inicio),
  -- Ou aponta para uma área, ou para um território, ou para nenhum dos dois
  -- (diagnóstico da campanha inteira). O que não pode é nível sem referência.
  constraint diagnostico_nivel_com_referencia
    check ((nivel is null) = (id_referencia is null))
);

create index diagnosticos_org_idx
  on public.diagnosticos (id_organizacao, id_campanha, status);
create index diagnosticos_area_idx on public.diagnosticos (id_organizacao, id_area);

create table public.diagnostico_problemas (
  id uuid primary key default gen_random_uuid(),
  id_organizacao uuid not null references public.organizacoes(id) on delete cascade,
  id_campanha uuid not null references public.campanhas(id) on delete cascade,
  id_diagnostico uuid not null references public.diagnosticos(id) on delete cascade,

  tema public.tema_problema not null,
  -- Só quando o tema é OUTRO. O `check` impede que vire texto livre paralelo.
  tema_livre text,

  titulo text not null,
  descricao text,

  gravidade smallint not null default 3 check (gravidade between 1 and 5),
  -- Quantas vezes o problema foi relatado. É o peso do tema no agregado: um
  -- problema grave citado uma vez não vale o mesmo que um problema médio
  -- citado quarenta.
  frequencia_relatos integer not null default 1 check (frequencia_relatos >= 1),

  origem public.origem_problema not null default 'REUNIAO',
  nivel public.nivel_territorial,
  id_referencia text,

  id_usuario_registro uuid not null references public.usuarios(id),

  criado_em timestamptz not null default now(),
  atualizado_em timestamptz not null default now(),

  constraint problema_tema_livre_so_em_outro
    check (tema = 'OUTRO' or tema_livre is null),
  constraint problema_nivel_com_referencia
    check ((nivel is null) = (id_referencia is null))
);

create index problemas_diagnostico_idx
  on public.diagnostico_problemas (id_organizacao, id_diagnostico, tema);
-- Índice do agregado: "temas mais citados, por gravidade" é a consulta que
-- alimenta tanto o gráfico quanto a sugestão de eixos narrativos.
create index problemas_tema_idx
  on public.diagnostico_problemas (id_organizacao, id_campanha, tema, gravidade desc);

do $$
declare
  tabela text;
begin
  foreach tabela in array array['diagnosticos', 'diagnostico_problemas']
  loop
    execute format(
      'create trigger %I before update on public.%I
         for each row execute function public.marcar_atualizado_em()',
      tabela || '_atualizado_em', tabela
    );
  end loop;
end;
$$;

-- --- Permissões --------------------------------------------------------------

/*
 * `diagnostico.*` é separado de `planejamento.*` de propósito.
 *
 * O mobilizador precisa REGISTRAR o que ouviu no território dele, e não pode
 * editar a linha narrativa da campanha. Fossem a mesma chave, ou ele ficaria
 * sem registrar o que ouve — perdendo a fonte primária do diagnóstico — ou
 * ganharia poder sobre o discurso.
 */
insert into public.permissoes (chave, modulo, descricao) values
  ('diagnostico.ler',       'Planejamento', 'Consultar diagnósticos locais e problemas levantados'),
  ('diagnostico.gerenciar', 'Planejamento', 'Registrar e consolidar diagnósticos locais')
on conflict (chave) do nothing;

select public.conceder_permissao_padrao('ADMINISTRADOR', 'diagnostico.ler',       'CAMPANHA');
select public.conceder_permissao_padrao('ADMINISTRADOR', 'diagnostico.gerenciar', 'CAMPANHA');
select public.conceder_permissao_padrao('COORDENADOR',   'diagnostico.ler',       'CAMPANHA');
select public.conceder_permissao_padrao('COORDENADOR',   'diagnostico.gerenciar', 'CAMPANHA');
select public.conceder_permissao_padrao('MOBILIZADOR',   'diagnostico.ler',       'CAMPANHA');
select public.conceder_permissao_padrao('MOBILIZADOR',   'diagnostico.gerenciar', 'TERRITORIO');
-- O entrevistador ouve reclamação em toda porta que bate; registrar o que ouviu
-- é o caminho mais barato de alimentar o diagnóstico com volume real.
select public.conceder_permissao_padrao('ENTREVISTADOR', 'diagnostico.gerenciar', 'PROPRIO');
select public.conceder_permissao_padrao('ANALISTA',      'diagnostico.ler',       'CAMPANHA');
select public.conceder_permissao_padrao('CANDIDATO',     'diagnostico.ler',       'CAMPANHA');

-- --- RLS ---------------------------------------------------------------------

/*
 * Padrão, e não escopo por dono.
 *
 * Problema levantado no bairro não é dado pessoal — é pauta. Esconder de quem
 * trabalha noutra área destruiria justamente o valor do módulo: a campanha
 * precisa ver que "saneamento" aparece em seis bairros diferentes para
 * transformar isso em eixo de discurso. Um diagnóstico visível só a quem o
 * registrou seria um caderno de anotações, não um diagnóstico.
 */
select autenticacao.aplicar_rls_padrao(
  'diagnosticos', 'diagnostico.ler', 'diagnostico.gerenciar'
);
select autenticacao.aplicar_rls_padrao(
  'diagnostico_problemas', 'diagnostico.ler', 'diagnostico.gerenciar'
);

comment on table public.diagnostico_problemas is
  'Problemas levantados em campo. `tema` e enum e nao texto livre porque a '
  'cadeia diagnostico -> narrativa depende de CONTAR temas; texto livre '
  'fragmentaria o agregado. Nenhuma coluna identifica quem relatou.';
