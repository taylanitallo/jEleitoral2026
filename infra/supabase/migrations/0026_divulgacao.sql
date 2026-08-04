-- =============================================================================
-- 0026 — Divulgação em redes sociais
--
-- **Planeja e aprova; não publica.** Decisão do usuário, e a única viável para
-- o pleito de 2026: publicar de fato exige OAuth e revisão de aplicativo da
-- Meta, que leva semanas e não sairia a tempo. O sistema organiza o calendário
-- de conteúdo, prende cada peça ao eixo narrativo que ela serve e recebe as
-- métricas de volta; quem posta é a pessoa, na conta dela.
--
-- O que isso ainda entrega, e que hoje não existe em lugar nenhum: saber que a
-- campanha publicou onze peças sobre saneamento e três sobre saúde, quando o
-- diagnóstico diz que saúde tem 88 relatos e saneamento 61.
-- =============================================================================

create type public.rede_social as enum (
  'INSTAGRAM', 'FACEBOOK', 'WHATSAPP', 'TIKTOK', 'YOUTUBE', 'X', 'SITE', 'OUTRA'
);

create type public.status_publicacao as enum (
  'RASCUNHO', 'EM_APROVACAO', 'APROVADA', 'PUBLICADA', 'CANCELADA'
);

create table public.publicacoes (
  id uuid primary key default gen_random_uuid(),
  id_organizacao uuid not null references public.organizacoes(id) on delete cascade,
  id_campanha uuid not null references public.campanhas(id) on delete cascade,

  rede public.rede_social not null,
  titulo text not null,
  -- A legenda em si. Pode nascer de `POST /ia/revisar-texto` ou da sugestão a
  -- partir do eixo; em ambos os casos quem grava é a pessoa.
  texto text,
  status public.status_publicacao not null default 'RASCUNHO',

  /*
   * As duas âncoras que dão sentido ao módulo.
   *
   * `id_eixo` é o que permite a pergunta que ninguém consegue responder hoje:
   * "estamos falando, nas redes, do que levantamos em campo?". `id_material`
   * reusa `materiais_graficos` em vez de criar um segundo repositório de arte —
   * a arte já tem versionamento, bucket privado e URL assinada.
   */
  id_eixo uuid references public.eixos_narrativos(id) on delete set null,
  id_material uuid references public.materiais_graficos(id) on delete set null,
  id_acao uuid references public.acoes_campanha(id) on delete set null,

  -- Território a que a peça se dirige, quando houver. Mesmo polimorfismo de
  -- `metas` e `lancamentos`.
  nivel_territorio public.nivel_territorial,
  id_territorio text,

  agendada_para timestamptz,
  publicada_em timestamptz,
  -- Onde a peça foi parar. Preenchido à mão depois de postar: é o que fecha o
  -- ciclo e permite conferir a métrica.
  url_publicacao text,

  /*
   * Impulsionamento pago é DESPESA DE CAMPANHA, com regra própria na Lei
   * 9.504/97 — precisa constar da prestação de contas. Sai como `lancamentos`
   * desde a v1, e não como número solto aqui, senão a campanha teria dois
   * lugares de verdade sobre quanto gastou.
   */
  impulsionada boolean not null default false,
  id_lancamento uuid references public.lancamentos(id) on delete set null,

  id_usuario_criador uuid not null references public.usuarios(id),
  aprovada_por uuid references public.usuarios(id) on delete set null,
  aprovada_em timestamptz,

  gerado_por_ia boolean not null default false,
  id_uso_ia bigint references public.usos_ia(id) on delete set null,

  criado_em timestamptz not null default now(),
  atualizado_em timestamptz not null default now(),

  -- Impulsionamento sem lançamento vinculado é despesa fora da contabilidade.
  constraint publicacao_impulsionada_tem_lancamento
    check (not impulsionada or id_lancamento is not null),
  -- Publicada sem data é linha que nunca entra em nenhum relatório de período.
  constraint publicacao_publicada_tem_data
    check (status <> 'PUBLICADA' or publicada_em is not null)
);

create index publicacoes_org_idx
  on public.publicacoes (id_organizacao, id_campanha, status, agendada_para);
create index publicacoes_eixo_idx on public.publicacoes (id_organizacao, id_eixo);
create index publicacoes_material_idx on public.publicacoes (id_organizacao, id_material);

/*
 * Métrica em tabela separada, e não em colunas de `publicacoes`.
 *
 * Alcance e engajamento são séries: a peça de segunda tem número diferente na
 * terça e na sexta, e o coordenador quer saber se ela ainda está rendendo.
 * Colunas únicas guardariam só a última leitura e perderiam a curva — que é
 * exatamente o que distingue post que morreu de post que ainda circula.
 */
create table public.publicacao_metricas (
  id uuid primary key default gen_random_uuid(),
  id_organizacao uuid not null references public.organizacoes(id) on delete cascade,
  id_campanha uuid not null references public.campanhas(id) on delete cascade,
  id_publicacao uuid not null references public.publicacoes(id) on delete cascade,

  aferida_em timestamptz not null default now(),
  alcance integer check (alcance >= 0),
  impressoes integer check (impressoes >= 0),
  curtidas integer check (curtidas >= 0),
  comentarios integer check (comentarios >= 0),
  compartilhamentos integer check (compartilhamentos >= 0),
  cliques integer check (cliques >= 0),

  id_usuario_registro uuid not null references public.usuarios(id),
  criado_em timestamptz not null default now()
);

create index publicacao_metricas_org_idx
  on public.publicacao_metricas (id_organizacao, id_publicacao, aferida_em desc);

-- --- Gatilhos ----------------------------------------------------------------

create trigger publicacoes_atualizado_em
  before update on public.publicacoes
  for each row execute function public.marcar_atualizado_em();

-- --- Permissões --------------------------------------------------------------

insert into public.permissoes (chave, modulo, descricao) values
  ('divulgacao.ler',       'Divulgação', 'Consultar o calendário de publicações e métricas'),
  ('divulgacao.gerenciar', 'Divulgação', 'Criar, aprovar e registrar publicações')
on conflict (chave) do nothing;

/*
 * `conceder_permissao_padrao` (0019) registra no catálogo E aplica nas
 * organizações existentes com `do nothing`. Chamar `semear_perfis_organizacao`
 * aqui sobrescreveria, em silêncio, escopos ajustados à mão.
 *
 * Só COORDENADOR e ADMINISTRADOR ganham `gerenciar`: aprovar peça é decidir o
 * que a candidatura diz em público, e é a última coisa que deve ficar
 * distribuída. O MOBILIZADOR lê para saber o que está no ar quando alguém na
 * rua perguntar.
 */
select public.conceder_permissao_padrao('ADMINISTRADOR', 'divulgacao.ler',       'CAMPANHA');
select public.conceder_permissao_padrao('ADMINISTRADOR', 'divulgacao.gerenciar', 'CAMPANHA');
select public.conceder_permissao_padrao('COORDENADOR',   'divulgacao.ler',       'CAMPANHA');
select public.conceder_permissao_padrao('COORDENADOR',   'divulgacao.gerenciar', 'CAMPANHA');
select public.conceder_permissao_padrao('MOBILIZADOR',   'divulgacao.ler',       'CAMPANHA');
select public.conceder_permissao_padrao('ANALISTA',      'divulgacao.ler',       'CAMPANHA');
select public.conceder_permissao_padrao('CANDIDATO',     'divulgacao.ler',       'CAMPANHA');

-- --- RLS ---------------------------------------------------------------------

/*
 * Padrão, e não escopo: publicação é comunicação pública da campanha. Não há
 * "post que só o meu bairro pode ver" — quem tem `divulgacao.ler` precisa
 * enxergar a linha inteira de conteúdo, inclusive para não repetir peça.
 */
select autenticacao.aplicar_rls_padrao(
  'publicacoes', 'divulgacao.ler', 'divulgacao.gerenciar'
);
select autenticacao.aplicar_rls_padrao(
  'publicacao_metricas', 'divulgacao.ler', 'divulgacao.gerenciar'
);

comment on table public.publicacoes is
  'Calendario de conteudo. O sistema PLANEJA e APROVA; nao publica — publicar '
  'exigiria OAuth e revisao de app da Meta. O valor esta em prender cada peca '
  'ao eixo narrativo e conferir se a campanha fala nas redes do que levantou '
  'em campo.';

comment on table public.publicacao_metricas is
  'Serie temporal de metricas. Tabela separada porque alcance e engajamento '
  'mudam ao longo dos dias, e a curva distingue post que morreu de post que '
  'ainda circula.';
