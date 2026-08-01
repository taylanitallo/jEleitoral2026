-- =============================================================================
-- 0007 — Mapeamento de campo
--
-- Coração do sistema e a parte de maior risco jurídico: convicção política é
-- dado pessoal SENSÍVEL (LGPD, art. 5º, II) e o tratamento exige base legal
-- específica (art. 11) — na prática, consentimento específico e destacado.
--
-- Por isso o consentimento não é uma coluna opcional em `entrevistados`: é uma
-- tabela própria, com versão do texto aceito, e um gatilho impede a conclusão
-- da entrevista sem ele. A regra vive no banco, não na tela, porque tela se
-- contorna com uma requisição direta.
-- =============================================================================

create type public.classificacao_eleitor as enum
  ('APOIADOR', 'PROVAVEL', 'INDECISO', 'OPOSICAO', 'NAO_INFORMOU');
create type public.status_entrevista as enum
  ('RASCUNHO', 'CONCLUIDA', 'VALIDADA', 'INVALIDADA');
create type public.tipo_visita as enum ('PRIMEIRA', 'RETORNO', 'ENTREGA_MATERIAL');
create type public.canal_consentimento as enum
  ('VERBAL_REGISTRADO', 'ASSINATURA_EM_TELA', 'DIGITAL');
create type public.natureza_levantamento as enum
  ('LEVANTAMENTO_INTERNO', 'PESQUISA_REGISTRADA');
create type public.tipo_alerta_coleta as enum (
  'DURACAO_CURTA', 'GPS_DISTANTE', 'VOLUME_IMPROVAVEL',
  'DUPLICIDADE_SUSPEITA', 'SEM_GEOLOCALIZACAO', 'FORA_DO_TERRITORIO'
);

-- --- Domicílios --------------------------------------------------------------

create table public.domicilios (
  id uuid primary key default gen_random_uuid(),
  id_organizacao uuid not null references public.organizacoes(id) on delete cascade,
  id_campanha uuid not null references public.campanhas(id) on delete cascade,
  id_logradouro uuid not null references public.logradouros(id),
  id_bairro uuid not null references public.bairros(id),
  numero text not null default 'SN',
  numero_normalizado text not null,
  complemento text,
  ponto_referencia text,
  latitude double precision,
  longitude double precision,
  total_moradores smallint check (total_moradores >= 0),
  total_eleitores_declarado smallint check (total_eleitores_declarado >= 0),
  id_secao_provavel uuid references public.secoes_eleitorais(id),
  id_usuario_cadastro uuid not null references public.usuarios(id),
  id_equipe uuid references public.equipes(id),
  criado_em timestamptz not null default now(),
  atualizado_em timestamptz not null default now()
);

create index domicilios_campanha_idx on public.domicilios (id_organizacao, id_campanha, id_bairro);
create index domicilios_logradouro_idx on public.domicilios (id_organizacao, id_logradouro);
create index domicilios_secao_idx on public.domicilios (id_organizacao, id_secao_provavel);
create index domicilios_usuario_idx on public.domicilios (id_organizacao, id_usuario_cadastro);
create unique index domicilios_unicidade_idx
  on public.domicilios
     (id_campanha, id_logradouro, numero_normalizado, (coalesce(complemento, '')));

-- --- Entrevistados -----------------------------------------------------------

create table public.entrevistados (
  id uuid primary key default gen_random_uuid(),
  id_organizacao uuid not null references public.organizacoes(id) on delete cascade,
  id_campanha uuid not null references public.campanhas(id) on delete cascade,
  id_domicilio uuid references public.domicilios(id) on delete set null,
  nome text not null,
  nome_normalizado text generated always as (public.normalizar_texto(nome)) stored,
  apelido text,
  telefone text,
  data_nascimento date,
  genero text,
  -- CPF e título são OPCIONAIS e desabilitados por padrão (minimização, art. 6º
  -- III da LGPD). Quando o administrador habilita, a aplicação grava o valor
  -- cifrado em AES-256-GCM e o HMAC ao lado; o texto claro nunca toca o banco.
  cpf_criptografado text,
  cpf_hmac text,
  titulo_criptografado text,
  titulo_hmac text,
  id_secao uuid references public.secoes_eleitorais(id),
  id_zona uuid references public.zonas_eleitorais(id),
  classificacao public.classificacao_eleitor not null default 'NAO_INFORMOU',
  id_usuario_cadastro uuid not null references public.usuarios(id),
  id_equipe uuid references public.equipes(id),
  -- Preenchido quando o titular exerce o direito de exclusão: os dados
  -- identificáveis são apagados e a linha permanece apenas como contribuição
  -- estatística anônima.
  anonimizado_em timestamptz,
  criado_em timestamptz not null default now(),
  atualizado_em timestamptz not null default now()
);

create index entrevistados_campanha_idx on public.entrevistados (id_organizacao, id_campanha);
create index entrevistados_secao_idx
  on public.entrevistados (id_organizacao, id_campanha, id_secao);
create index entrevistados_classificacao_idx
  on public.entrevistados (id_organizacao, id_campanha, classificacao);
create index entrevistados_usuario_idx
  on public.entrevistados (id_organizacao, id_usuario_cadastro);
create index entrevistados_nome_trgm_idx
  on public.entrevistados using gin (nome_normalizado gin_trgm_ops);
create unique index entrevistados_cpf_idx
  on public.entrevistados (id_campanha, cpf_hmac) where cpf_hmac is not null;
create unique index entrevistados_titulo_idx
  on public.entrevistados (id_campanha, titulo_hmac) where titulo_hmac is not null;

-- --- Consentimento -----------------------------------------------------------

/**
 * Versões do texto de consentimento. Guardar a versão aceita, e não só a data,
 * é o que permite provar mais tarde ao que exatamente o titular consentiu.
 */
create table public.versoes_consentimento (
  id uuid primary key default gen_random_uuid(),
  id_organizacao uuid not null references public.organizacoes(id) on delete cascade,
  versao text not null,
  texto text not null,
  finalidade text not null,
  vigente_de timestamptz not null default now(),
  vigente_ate timestamptz,
  criado_em timestamptz not null default now(),
  unique (id_organizacao, versao)
);

create table public.consentimentos (
  id uuid primary key default gen_random_uuid(),
  id_organizacao uuid not null references public.organizacoes(id) on delete cascade,
  id_campanha uuid not null references public.campanhas(id) on delete cascade,
  id_entrevistado uuid not null references public.entrevistados(id) on delete cascade,
  id_versao_consentimento uuid not null references public.versoes_consentimento(id),
  versao_texto text not null,
  finalidade text not null,
  canal public.canal_consentimento not null,
  aceito_em timestamptz not null default now(),
  id_usuario_coletor uuid not null references public.usuarios(id),
  -- Assinatura em tela ou áudio do aceite verbal, em bucket privado.
  evidencia_url text,
  latitude double precision,
  longitude double precision,
  revogado_em timestamptz,
  criado_em timestamptz not null default now()
);

create index consentimentos_entrevistado_idx
  on public.consentimentos (id_organizacao, id_entrevistado);
create unique index consentimentos_vigente_idx
  on public.consentimentos (id_entrevistado) where revogado_em is null;

-- --- Entrevistas -------------------------------------------------------------

create table public.entrevistas (
  id uuid primary key default gen_random_uuid(),
  id_organizacao uuid not null references public.organizacoes(id) on delete cascade,
  id_campanha uuid not null references public.campanhas(id) on delete cascade,
  id_entrevistado uuid not null references public.entrevistados(id) on delete cascade,
  id_usuario_entrevistador uuid not null references public.usuarios(id),
  id_equipe uuid references public.equipes(id),
  natureza public.natureza_levantamento not null default 'LEVANTAMENTO_INTERNO',
  data_hora timestamptz not null default now(),
  duracao_segundos integer check (duracao_segundos >= 0),
  latitude double precision,
  longitude double precision,
  precisao_gps_metros real,
  dispositivo text,
  status public.status_entrevista not null default 'RASCUNHO',
  -- Recusa explícita: o entrevistado não quis responder. É informação válida e
  -- diferente de "entrevista incompleta" — sem esta marca, a entrevista não
  -- pode ser concluída sem intenção de voto.
  recusou_responder boolean not null default false,
  observacoes text,
  -- Preenchido quando a entrevista chega pela fila offline.
  sincronizado_de_offline boolean not null default false,
  id_local_offline text,
  criado_em timestamptz not null default now(),
  atualizado_em timestamptz not null default now()
);

create index entrevistas_campanha_data_idx
  on public.entrevistas (id_organizacao, id_campanha, data_hora desc);
create index entrevistas_entrevistador_idx
  on public.entrevistas (id_organizacao, id_usuario_entrevistador, data_hora desc);
create index entrevistas_entrevistado_idx on public.entrevistas (id_organizacao, id_entrevistado);
-- Idempotência da sincronização offline: reenvio do mesmo registro não duplica.
create unique index entrevistas_offline_idx
  on public.entrevistas (id_campanha, id_local_offline) where id_local_offline is not null;

/** Visita em grupo: mais de um entrevistador na mesma porta. */
create table public.entrevista_entrevistadores (
  id_entrevista uuid not null references public.entrevistas(id) on delete cascade,
  id_usuario uuid not null references public.usuarios(id) on delete cascade,
  id_organizacao uuid not null references public.organizacoes(id) on delete cascade,
  primary key (id_entrevista, id_usuario)
);

-- --- Intenções de voto -------------------------------------------------------

create table public.intencoes_voto (
  id uuid primary key default gen_random_uuid(),
  id_organizacao uuid not null references public.organizacoes(id) on delete cascade,
  id_campanha uuid not null references public.campanhas(id) on delete cascade,
  id_entrevista uuid not null references public.entrevistas(id) on delete cascade,
  id_cargo uuid not null references public.cargos(id),
  id_candidato uuid references public.candidatos(id) on delete set null,
  -- O eleitor pode declarar um número que ainda não corresponde a candidato
  -- cadastrado. Guardamos o declarado e resolvemos depois.
  numero_declarado text,
  grau_certeza smallint not null default 3 check (grau_certeza between 1 and 5),
  voto_definido boolean not null default false,
  criado_em timestamptz not null default now()
);

create index intencoes_entrevista_idx on public.intencoes_voto (id_organizacao, id_entrevista);
create index intencoes_candidato_idx
  on public.intencoes_voto (id_organizacao, id_campanha, id_cargo, id_candidato);

/**
 * Votos declarados para o domicílio inteiro ("aqui em casa somos 4 e todos
 * votam em você"). Entram na projeção com peso de confiança MENOR que a
 * intenção individual — a ponderação está documentada e implementada em
 * `apps/api/src/projecao/motorProjecao.ts`.
 */
create table public.votos_domicilio (
  id uuid primary key default gen_random_uuid(),
  id_organizacao uuid not null references public.organizacoes(id) on delete cascade,
  id_campanha uuid not null references public.campanhas(id) on delete cascade,
  id_entrevista uuid not null references public.entrevistas(id) on delete cascade,
  id_cargo uuid not null references public.cargos(id),
  id_candidato uuid references public.candidatos(id) on delete set null,
  quantidade_declarada smallint not null check (quantidade_declarada >= 0),
  quantidade_confirmada smallint check (quantidade_confirmada >= 0),
  criado_em timestamptz not null default now()
);

create index votos_domicilio_entrevista_idx
  on public.votos_domicilio (id_organizacao, id_entrevista);

-- --- Visitas -----------------------------------------------------------------

create table public.visitas (
  id uuid primary key default gen_random_uuid(),
  id_organizacao uuid not null references public.organizacoes(id) on delete cascade,
  id_campanha uuid not null references public.campanhas(id) on delete cascade,
  id_domicilio uuid not null references public.domicilios(id) on delete cascade,
  id_usuario uuid not null references public.usuarios(id),
  id_equipe uuid references public.equipes(id),
  tipo public.tipo_visita not null default 'PRIMEIRA',
  resultado text,
  data_hora timestamptz not null default now(),
  criado_em timestamptz not null default now()
);

create index visitas_domicilio_idx on public.visitas (id_organizacao, id_domicilio, data_hora desc);
create index visitas_usuario_idx on public.visitas (id_organizacao, id_usuario, data_hora desc);

-- --- Qualidade da coleta (antifraude) ----------------------------------------

create table public.alertas_coleta (
  id uuid primary key default gen_random_uuid(),
  id_organizacao uuid not null references public.organizacoes(id) on delete cascade,
  id_campanha uuid not null references public.campanhas(id) on delete cascade,
  id_entrevista uuid references public.entrevistas(id) on delete cascade,
  id_usuario_avaliado uuid not null references public.usuarios(id),
  tipo public.tipo_alerta_coleta not null,
  detalhe jsonb not null default '{}'::jsonb,
  gravidade smallint not null default 2 check (gravidade between 1 and 3),
  revisado_por uuid references public.usuarios(id),
  revisado_em timestamptz,
  procedente boolean,
  criado_em timestamptz not null default now()
);

create index alertas_coleta_pendentes_idx
  on public.alertas_coleta (id_organizacao, id_campanha, criado_em desc)
  where revisado_em is null;
create index alertas_coleta_usuario_idx
  on public.alertas_coleta (id_organizacao, id_usuario_avaliado);

-- =============================================================================
-- Regras de negócio no banco
-- =============================================================================

/**
 * Impede concluir entrevista sem consentimento vigente e sem conteúdo.
 *
 * Está no banco de propósito. A validação equivalente existe no formulário e
 * no service, mas só esta é inescapável — inclusive para a fila offline, que
 * sincroniza direto e poderia trazer um registro montado à mão.
 */
create or replace function public.validar_conclusao_entrevista()
returns trigger
language plpgsql
as $$
declare
  v_tem_consentimento boolean;
  v_tem_conteudo boolean;
begin
  if new.status not in ('CONCLUIDA', 'VALIDADA') then
    return new;
  end if;

  select exists (
    select 1 from public.consentimentos c
    where c.id_entrevistado = new.id_entrevistado
      and c.revogado_em is null
  ) into v_tem_consentimento;

  if not v_tem_consentimento then
    raise exception
      'Não é possível concluir a entrevista sem consentimento registrado do entrevistado. '
      'Convicção política é dado sensível (LGPD, art. 5º, II).'
      using errcode = 'check_violation';
  end if;

  select (
    new.recusou_responder
    or exists (select 1 from public.intencoes_voto i where i.id_entrevista = new.id)
    or exists (select 1 from public.votos_domicilio v where v.id_entrevista = new.id)
  ) into v_tem_conteudo;

  if not v_tem_conteudo then
    raise exception
      'Registre ao menos uma intenção de voto ou marque a recusa em responder '
      'antes de concluir a entrevista.'
      using errcode = 'check_violation';
  end if;

  return new;
end;
$$;

create trigger entrevistas_validar_conclusao
  before insert or update of status on public.entrevistas
  for each row execute function public.validar_conclusao_entrevista();

/**
 * Impede que uma intenção de voto exceda a quantidade de votos do cargo.
 * Sem isto, uma tela com defeito registraria três senadores para o mesmo
 * eleitor e inflaria a projeção do cargo em 50%.
 */
create or replace function public.validar_quantidade_intencoes()
returns trigger
language plpgsql
as $$
declare
  v_permitido smallint;
  v_existentes integer;
begin
  select quantidade_votos_permitida into v_permitido
  from public.cargos where id = new.id_cargo;

  select count(*) into v_existentes
  from public.intencoes_voto
  where id_entrevista = new.id_entrevista
    and id_cargo = new.id_cargo
    and id <> coalesce(new.id, '00000000-0000-0000-0000-000000000000'::uuid);

  if v_existentes + 1 > v_permitido then
    raise exception
      'O cargo permite % voto(s) por eleitor e já há % registrado(s) nesta entrevista.',
      v_permitido, v_existentes
      using errcode = 'check_violation';
  end if;

  return new;
end;
$$;

create trigger intencoes_validar_quantidade
  before insert or update on public.intencoes_voto
  for each row execute function public.validar_quantidade_intencoes();

/**
 * Busca entrevistados parecidos antes de gravar um novo.
 * Combina similaridade de nome com coincidência de endereço — nome parecido em
 * outro bairro provavelmente é outra pessoa; nome parecido na mesma casa é
 * quase certamente a mesma.
 */
create or replace function public.sugerir_entrevistados_similares(
  p_id_campanha uuid,
  p_nome text,
  p_id_domicilio uuid default null,
  p_limiar real default 0.5,
  p_limite integer default 5
)
returns table (
  id uuid,
  nome text,
  apelido text,
  mesmo_domicilio boolean,
  similaridade real
)
language sql
stable
as $$
  select
    e.id,
    e.nome,
    e.apelido,
    (p_id_domicilio is not null and e.id_domicilio = p_id_domicilio) as mesmo_domicilio,
    similarity(e.nome_normalizado, public.normalizar_texto(p_nome)) as sim
  from public.entrevistados e
  where e.id_campanha = p_id_campanha
    and e.anonimizado_em is null
    and (
      similarity(e.nome_normalizado, public.normalizar_texto(p_nome)) >= p_limiar
      or (p_id_domicilio is not null and e.id_domicilio = p_id_domicilio)
    )
  order by mesmo_domicilio desc, sim desc
  limit p_limite;
$$;

-- =============================================================================
-- RLS — escopo por usuário
-- =============================================================================

/**
 * Aqui está o requisito "nenhum usuário vê o dado do outro".
 *
 * A política não filtra apenas por organização e campanha: chama
 * `autenticacao.visivel_no_escopo`, que compara o dono da linha com o escopo
 * concedido ao perfil. Um ENTREVISTADOR com escopo PROPRIO não enxerga, no
 * banco, a entrevista do colega — não importa qual endpoint ele chame.
 */
do $$
declare
  item record;
begin
  for item in
    select * from (values
      ('domicilios',    'id_usuario_cadastro',      'id_equipe', 'id_bairro'),
      ('entrevistados', 'id_usuario_cadastro',      'id_equipe', null),
      ('entrevistas',   'id_usuario_entrevistador', 'id_equipe', null),
      ('visitas',       'id_usuario',               'id_equipe', null)
    ) as t(tabela, coluna_dono, coluna_equipe, coluna_territorio)
  loop
    execute format('alter table public.%I enable row level security', item.tabela);
    execute format('alter table public.%I force row level security', item.tabela);

    execute format(
      'create policy %I on public.%I for select using (
         autenticacao.pertence(id_organizacao, id_campanha)
         and autenticacao.visivel_no_escopo(''campo.ler'', %s, %s, %s)
       )',
      item.tabela || '_ler', item.tabela,
      item.coluna_dono,
      coalesce(item.coluna_equipe, 'null::uuid'),
      coalesce(item.coluna_territorio, 'null::uuid')
    );

    -- Gravar sempre carimba o próprio usuário como dono: ninguém insere em nome
    -- de terceiro.
    execute format(
      'create policy %I on public.%I for insert with check (
         autenticacao.pertence(id_organizacao, id_campanha)
         and autenticacao.escopo_de(''campo.gerenciar'') is not null
         and %s = autenticacao.id_usuario()
       )',
      item.tabela || '_inserir', item.tabela, item.coluna_dono
    );

    execute format(
      'create policy %I on public.%I for update using (
         autenticacao.pertence(id_organizacao, id_campanha)
         and autenticacao.visivel_no_escopo(''campo.gerenciar'', %s, %s, %s)
       ) with check (autenticacao.pertence(id_organizacao, id_campanha))',
      item.tabela || '_alterar', item.tabela,
      item.coluna_dono,
      coalesce(item.coluna_equipe, 'null::uuid'),
      coalesce(item.coluna_territorio, 'null::uuid')
    );

    -- Exclusão exige escopo de campanha: entrevistador não apaga coleta.
    execute format(
      'create policy %I on public.%I for delete using (
         autenticacao.pertence(id_organizacao, id_campanha)
         and autenticacao.escopo_de(''campo.gerenciar'') = ''CAMPANHA''
       )',
      item.tabela || '_excluir', item.tabela
    );

    execute format(
      'create policy %I on public.%I for select using (autenticacao.suporte_ativo(id_organizacao))',
      item.tabela || '_suporte', item.tabela
    );
  end loop;
end;
$$;

-- Tabelas-filhas herdam a visibilidade da entrevista a que pertencem.
do $$
declare
  tabela text;
begin
  foreach tabela in array array['intencoes_voto', 'votos_domicilio'] loop
    execute format('alter table public.%I enable row level security', tabela);
    execute format('alter table public.%I force row level security', tabela);
    execute format(
      'create policy %I on public.%I for all using (
         autenticacao.pertence(id_organizacao, id_campanha)
         and exists (select 1 from public.entrevistas e where e.id = %I.id_entrevista)
       ) with check (autenticacao.pertence(id_organizacao, id_campanha))',
      tabela || '_por_entrevista', tabela, tabela
    );
    execute format(
      'create policy %I on public.%I for select using (autenticacao.suporte_ativo(id_organizacao))',
      tabela || '_suporte', tabela
    );
  end loop;
end;
$$;

select autenticacao.aplicar_rls_padrao('consentimentos', 'campo.ler', 'campo.gerenciar');
select autenticacao.aplicar_rls_padrao('alertas_coleta', 'qualidade.ler', 'qualidade.gerenciar');
select autenticacao.aplicar_rls_padrao('versoes_consentimento', 'campo.ler', 'campo.gerenciar', false);

alter table public.entrevista_entrevistadores enable row level security;
alter table public.entrevista_entrevistadores force row level security;
create policy entrevista_entrevistadores_por_entrevista on public.entrevista_entrevistadores
  for all
  using (
    id_organizacao = autenticacao.id_organizacao()
    and exists (select 1 from public.entrevistas e where e.id = id_entrevista)
  )
  with check (id_organizacao = autenticacao.id_organizacao());

do $$
declare
  tabela text;
begin
  foreach tabela in array array['domicilios', 'entrevistados', 'entrevistas'] loop
    execute format(
      'create trigger %I_atualizado_em before update on public.%I
         for each row execute function public.marcar_atualizado_em();',
      tabela, tabela
    );
  end loop;
end;
$$;
