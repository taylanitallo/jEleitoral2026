-- =============================================================================
-- 0021 — Agenda: atividades e participantes
--
-- Uma tabela para quatro coisas que o pedido listava separadas: cronograma,
-- encontro com candidato, visita de conscientização e reunião de capacitação.
-- São todas *evento com data-hora, local, responsável e lista de presença*, e o
-- que as distingue cabe em `tipo` mais colunas anuláveis — `roteiro` serve de
-- pauta do encontro e de conteúdo da capacitação; `id_candidato` só é
-- preenchido quando há candidato envolvido.
--
-- Modelá-las separadas geraria quatro telas quase idênticas e quatro relatórios
-- que não se somam. O coordenador quer UMA agenda.
--
-- O que NÃO cabe aqui é "ação de campanha" (fase 6): ação tem prazo e não
-- data-hora, e é 1:N com atividades. Fica em tabela própria, e `id_acao` abaixo
-- já reserva o vínculo.
--
-- `public.visitas` (0007) continua existindo e NÃO é substituída: aquela é
-- visita porta-a-porta, exige `id_domicilio` e vive sob as políticas de
-- `campo.*`. Visita de conscientização a uma praça ou escola não tem domicílio.
-- =============================================================================

create type public.tipo_atividade as enum (
  'REUNIAO_EQUIPE', 'ENCONTRO_CANDIDATO', 'VISITA_CONSCIENTIZACAO', 'CAPACITACAO',
  'REUNIAO_COMITE', 'MUTIRAO', 'CARREATA', 'EVENTO_PUBLICO', 'AGENDA_EXTERNA', 'OUTRA'
);

create type public.status_atividade as enum (
  'PLANEJADA', 'CONFIRMADA', 'REALIZADA', 'CANCELADA', 'ADIADA'
);

create type public.situacao_participante as enum (
  'CONVIDADO', 'CONFIRMADO', 'PRESENTE', 'AUSENTE', 'JUSTIFICADO'
);

create table public.atividades (
  id uuid primary key default gen_random_uuid(),
  id_organizacao uuid not null references public.organizacoes(id) on delete cascade,
  id_campanha uuid not null references public.campanhas(id) on delete cascade,

  tipo public.tipo_atividade not null,
  status public.status_atividade not null default 'PLANEJADA',
  titulo text not null,

  inicio_em timestamptz not null,
  fim_em timestamptz,

  id_comite uuid references public.comites(id) on delete set null,
  id_candidato uuid references public.candidatos(id) on delete set null,
  -- Reservado para a fase 6. A FK entra depois, junto com a tabela.
  id_acao uuid,

  local_descricao text,
  id_bairro uuid references public.bairros(id),
  id_logradouro uuid references public.logradouros(id),

  -- Pauta do encontro, conteúdo da capacitação, roteiro da carreata: o mesmo
  -- campo, porque o coordenador escreve a mesma coisa nos três.
  roteiro text,
  encaminhamentos text,

  /*
   * Público externo entra como CONTAGEM, nunca nominalmente.
   *
   * Registrar quem apareceu numa carreata criaria titular de dado sem base
   * legal e sem consentimento colhido. Quem tem nome aqui é usuário do sistema
   * ou ativista cadastrado, ambos com vínculo formal com a campanha.
   */
  publico_estimado integer check (publico_estimado >= 0),
  publico_confirmado integer check (publico_confirmado >= 0),

  id_responsavel uuid not null references public.usuarios(id),
  id_equipe uuid references public.equipes(id) on delete set null,

  custo_estimado numeric(14,2),
  -- Amarra a despesa real ao financeiro que já existe, em vez de criar um
  -- segundo lugar onde se anota quanto custou.
  id_lancamento uuid references public.lancamentos(id) on delete set null,

  observacoes text,
  criado_em timestamptz not null default now(),
  atualizado_em timestamptz not null default now(),

  constraint atividade_fim_depois_do_inicio check (fim_em is null or fim_em >= inicio_em)
);

create index atividades_agenda_idx
  on public.atividades (id_organizacao, id_campanha, inicio_em desc);
create index atividades_responsavel_idx
  on public.atividades (id_organizacao, id_responsavel, inicio_em desc);
create index atividades_tipo_idx
  on public.atividades (id_organizacao, id_campanha, tipo, status);
-- Necessário para o escopo TERRITORIO da política: sem ele, cada consulta de
-- agenda de mobilizador vira varredura.
create index atividades_bairro_idx on public.atividades (id_organizacao, id_bairro);
create index atividades_comite_idx on public.atividades (id_organizacao, id_comite);

create table public.atividade_participantes (
  id uuid primary key default gen_random_uuid(),
  id_organizacao uuid not null references public.organizacoes(id) on delete cascade,
  id_campanha uuid not null references public.campanhas(id) on delete cascade,
  id_atividade uuid not null references public.atividades(id) on delete cascade,

  -- Mesmo XOR de `comite_membros`: usuário do sistema OU ativista sem login.
  id_usuario uuid references public.usuarios(id) on delete cascade,
  id_ativista uuid references public.ativistas(id) on delete cascade,

  situacao public.situacao_participante not null default 'CONVIDADO',
  papel text,
  -- Certificado de capacitação é uma COLUNA, não uma tabela: o que se precisa
  -- saber é se foi emitido e quando. O documento em si, se um dia existir, sai
  -- do módulo de relatórios a partir daqui.
  certificado_emitido_em timestamptz,
  justificativa text,

  criado_em timestamptz not null default now(),
  atualizado_em timestamptz not null default now(),

  constraint participante_usuario_ou_ativista
    check (num_nonnulls(id_usuario, id_ativista) = 1)
);

create index atividade_participantes_org_idx
  on public.atividade_participantes (id_organizacao, id_atividade);
create unique index atividade_participantes_usuario_idx
  on public.atividade_participantes (id_atividade, id_usuario) where id_usuario is not null;
create unique index atividade_participantes_ativista_idx
  on public.atividade_participantes (id_atividade, id_ativista) where id_ativista is not null;

do $$
declare
  tabela text;
begin
  foreach tabela in array array['atividades', 'atividade_participantes']
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

insert into public.permissoes (chave, modulo, descricao) values
  ('agenda.ler',       'Agenda', 'Consultar cronograma, encontros, visitas e capacitações'),
  ('agenda.gerenciar', 'Agenda', 'Criar atividades e registrar presença')
on conflict (chave) do nothing;

select public.conceder_permissao_padrao('ADMINISTRADOR', 'agenda.ler',       'CAMPANHA');
select public.conceder_permissao_padrao('ADMINISTRADOR', 'agenda.gerenciar', 'CAMPANHA');
select public.conceder_permissao_padrao('COORDENADOR',   'agenda.ler',       'CAMPANHA');
select public.conceder_permissao_padrao('COORDENADOR',   'agenda.gerenciar', 'EQUIPE');
select public.conceder_permissao_padrao('MOBILIZADOR',   'agenda.ler',       'TERRITORIO');
select public.conceder_permissao_padrao('MOBILIZADOR',   'agenda.gerenciar', 'TERRITORIO');
-- O entrevistador precisa saber onde ele mesmo foi escalado, e nada além disso.
select public.conceder_permissao_padrao('ENTREVISTADOR', 'agenda.ler',       'PROPRIO');
select public.conceder_permissao_padrao('ANALISTA',      'agenda.ler',       'CAMPANHA');
select public.conceder_permissao_padrao('CANDIDATO',     'agenda.ler',       'CAMPANHA');
-- Atividade tem custo estimado e lançamento vinculado.
select public.conceder_permissao_padrao('FINANCEIRO',    'agenda.ler',       'CAMPANHA');

-- --- RLS ---------------------------------------------------------------------

/*
 * `atividades` NÃO usa `aplicar_rls_padrao`.
 *
 * Aquela função só exige `escopo_de(...) is not null`, então um entrevistador
 * com `agenda.ler: PROPRIO` enxergaria a agenda inteira da campanha —
 * incluindo compromissos privados do candidato, que é exatamente o tipo de
 * informação que vaza para a imprensa. Aqui vale `visivel_no_escopo`, com o
 * responsável como dono, a equipe e o bairro como território.
 */
alter table public.atividades enable row level security;
alter table public.atividades force row level security;

create policy atividades_ler on public.atividades
  for select using (
    autenticacao.pertence(id_organizacao, id_campanha)
    and autenticacao.visivel_no_escopo('agenda.ler', id_responsavel, id_equipe, id_bairro)
  );

create policy atividades_inserir on public.atividades
  for insert with check (
    autenticacao.pertence(id_organizacao, id_campanha)
    and autenticacao.escopo_de('agenda.gerenciar') is not null
    and id_responsavel = autenticacao.id_usuario()
  );

create policy atividades_alterar on public.atividades
  for update using (
    autenticacao.pertence(id_organizacao, id_campanha)
    and autenticacao.visivel_no_escopo('agenda.gerenciar', id_responsavel, id_equipe, id_bairro)
  ) with check (autenticacao.pertence(id_organizacao, id_campanha));

create policy atividades_excluir on public.atividades
  for delete using (
    autenticacao.pertence(id_organizacao, id_campanha)
    and autenticacao.escopo_de('agenda.gerenciar') = 'CAMPANHA'
  );

create policy atividades_suporte on public.atividades
  for select using (autenticacao.suporte_ativo(id_organizacao));

/*
 * Participantes herdam a visibilidade da atividade-pai.
 *
 * Repetir aqui o `visivel_no_escopo` daria divergência na primeira vez que uma
 * das duas regras mudasse. Perguntar pela linha-pai mantém uma regra só, e o
 * `exists` usa o índice de `atividades`.
 */
alter table public.atividade_participantes enable row level security;
alter table public.atividade_participantes force row level security;

create policy atividade_participantes_ler on public.atividade_participantes
  for select using (
    exists (select 1 from public.atividades a where a.id = id_atividade)
  );

create policy atividade_participantes_gravar on public.atividade_participantes
  for all using (
    autenticacao.pertence(id_organizacao, id_campanha)
    and autenticacao.escopo_de('agenda.gerenciar') is not null
    and exists (select 1 from public.atividades a where a.id = id_atividade)
  ) with check (autenticacao.pertence(id_organizacao, id_campanha));

create policy atividade_participantes_suporte on public.atividade_participantes
  for select using (autenticacao.suporte_ativo(id_organizacao));

comment on table public.atividades is
  'Agenda da campanha: cronograma, encontros com candidato, visitas de '
  'conscientização, capacitações e eventos. Uma tabela porque são todos evento '
  'com data, local, responsável e presença. Não substitui public.visitas, que é '
  'porta-a-porta e exige domicílio.';

comment on column public.atividades.publico_confirmado is
  'Contagem do público externo. Nome de quem compareceu a evento aberto NÃO é '
  'registrado: seria titular de dado sem base legal nem consentimento.';
