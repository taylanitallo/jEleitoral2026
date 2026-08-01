-- =============================================================================
-- 0001 — Extensões, esquemas auxiliares e funções de contexto de autenticação
--
-- Este arquivo define a base de que TODA política RLS depende. As funções do
-- esquema `autenticacao` leem exclusivamente os claims do JWT assinado pelo
-- Supabase Auth. Nenhum valor vem do corpo da requisição: se viesse, o cliente
-- poderia se declarar de outra organização e o isolamento seria decorativo.
-- =============================================================================

create extension if not exists "pgcrypto";      -- gen_random_uuid, digest, hmac
create extension if not exists "pg_trgm";       -- similaridade de trigramas (dedup fuzzy)
create extension if not exists "unaccent";      -- normalização de acentos
create extension if not exists "btree_gin";     -- índices compostos com jsonb
create extension if not exists "citext";        -- e-mail sem sensibilidade a caixa

create schema if not exists autenticacao;
create schema if not exists auditoria;
create schema if not exists catalogo;
create schema if not exists provedor;

comment on schema autenticacao is
  'Funções de leitura do contexto do usuário autenticado. Base das políticas RLS.';
comment on schema catalogo is
  'Metadados do provedor sobre as organizações. Preparado para, no futuro, resolver '
  'instância de banco dedicada por organização sem mudar o código de aplicação.';

-- -----------------------------------------------------------------------------
-- Contexto do usuário autenticado
-- -----------------------------------------------------------------------------

/**
 * Claims do JWT como jsonb. Devolve objeto vazio quando não há sessão — assim
 * as funções abaixo retornam NULL em vez de estourar, e a política nega o
 * acesso por comparação com NULL (que é o comportamento seguro).
 */
create or replace function autenticacao.claims()
returns jsonb
language sql
stable
as $$
  select coalesce(
    nullif(current_setting('request.jwt.claims', true), '')::jsonb,
    '{}'::jsonb
  );
$$;

/**
 * Organização do usuário. É a chave de todo o isolamento multi-tenant.
 * Preenchida pelo Custom Access Token Hook do Supabase Auth.
 */
create or replace function autenticacao.id_organizacao()
returns uuid
language sql
stable
as $$
  select nullif(autenticacao.claims() ->> 'id_organizacao', '')::uuid;
$$;

create or replace function autenticacao.id_usuario()
returns uuid
language sql
stable
as $$
  select nullif(autenticacao.claims() ->> 'sub', '')::uuid;
$$;

/** Campanhas às quais o usuário tem acesso dentro da própria organização. */
create or replace function autenticacao.campanhas()
returns uuid[]
language sql
stable
as $$
  select coalesce(
    array(
      select (valor #>> '{}')::uuid
      from jsonb_array_elements(coalesce(autenticacao.claims() -> 'campanhas', '[]'::jsonb)) as valor
    ),
    array[]::uuid[]
  );
$$;

create or replace function autenticacao.equipes()
returns uuid[]
language sql
stable
as $$
  select coalesce(
    array(
      select (valor #>> '{}')::uuid
      from jsonb_array_elements(coalesce(autenticacao.claims() -> 'equipes', '[]'::jsonb)) as valor
    ),
    array[]::uuid[]
  );
$$;

/** Bairros/territórios designados ao usuário (escopo TERRITORIO). */
create or replace function autenticacao.territorios()
returns uuid[]
language sql
stable
as $$
  select coalesce(
    array(
      select (valor #>> '{}')::uuid
      from jsonb_array_elements(coalesce(autenticacao.claims() -> 'territorios', '[]'::jsonb)) as valor
    ),
    array[]::uuid[]
  );
$$;

/**
 * Identifica um usuário do backoffice da Jeos. O provedor NÃO é uma
 * organização: seu token não carrega `id_organizacao`, e por isso ele falha em
 * todas as políticas de dados de campo — que é exatamente o desejado. O acesso
 * de suporte é concedido caso a caso pela função `autenticacao.suporte_ativo`.
 */
create or replace function autenticacao.eh_provedor()
returns boolean
language sql
stable
as $$
  select coalesce(autenticacao.claims() ->> 'perfil_provedor', '') <> '';
$$;

-- -----------------------------------------------------------------------------
-- Escopo de permissão
-- -----------------------------------------------------------------------------

create type autenticacao.escopo_permissao as enum (
  'PROPRIO',      -- só os registros que o próprio usuário criou
  'EQUIPE',       -- registros das equipes de que participa
  'TERRITORIO',   -- registros dos territórios designados
  'CAMPANHA'      -- toda a campanha
);

/**
 * Escopo do usuário para uma permissão específica.
 *
 * Lê do claim `permissoes` do JWT — um objeto {chave: escopo} montado pelo
 * Custom Access Token Hook do Supabase Auth no momento do login, a partir de
 * `perfil_permissoes`. NÃO consulta tabela, por dois motivos que são ambos
 * eliminatórios:
 *
 *  1. Recursão. Com `FORCE ROW LEVEL SECURITY`, nem o dono da tabela escapa das
 *     políticas. Uma função chamada de dentro da política de `usuarios` que
 *     consultasse `usuarios` entraria em laço infinito — inclusive em
 *     SECURITY DEFINER, porque o FORCE se aplica ao dono também.
 *  2. Custo. A política é avaliada linha a linha. Três JOINs por linha
 *     inviabilizariam qualquer listagem de volume.
 *
 * Consequência operacional a conhecer: alterar as permissões de um perfil só
 * passa a valer no próximo token do usuário. `apps/api` revoga a sessão ao
 * salvar um perfil, para que o efeito seja imediato.
 */
create or replace function autenticacao.escopo_de(p_chave_permissao text)
returns autenticacao.escopo_permissao
language sql
stable
as $$
  select nullif(
    coalesce(autenticacao.claims() -> 'permissoes', '{}'::jsonb) ->> p_chave_permissao,
    ''
  )::autenticacao.escopo_permissao;
$$;

comment on function autenticacao.escopo_de(text) is
  'Escopo concedido ao usuário para a permissão informada, lido do JWT. NULL significa '
  'permissão ausente — e o padrão de toda política é negar quando é NULL.';

/**
 * Avalia se uma linha é visível para o usuário atual conforme o escopo da
 * permissão informada.
 *
 * É esta função que atende ao requisito "nenhum usuário vê o dado do outro":
 * o entrevistador com escopo PROPRIO só enxerga o que ele mesmo criou, e a
 * regra roda dentro do PostgreSQL — não há como burlar esquecendo um WHERE no
 * service, porque o service não participa da decisão.
 */
create or replace function autenticacao.visivel_no_escopo(
  p_chave_permissao text,
  p_id_usuario_dono uuid,
  p_id_equipe uuid default null,
  p_id_territorio uuid default null
)
returns boolean
language sql
stable
as $$
  select case autenticacao.escopo_de(p_chave_permissao)
    when 'CAMPANHA' then true
    when 'TERRITORIO' then
      p_id_territorio is not null and p_id_territorio = any(autenticacao.territorios())
      or p_id_usuario_dono = autenticacao.id_usuario()
    when 'EQUIPE' then
      p_id_equipe is not null and p_id_equipe = any(autenticacao.equipes())
      or p_id_usuario_dono = autenticacao.id_usuario()
    when 'PROPRIO' then p_id_usuario_dono = autenticacao.id_usuario()
    -- Sem permissão concedida, nada é visível. O padrão é negar.
    else false
  end;
$$;

/**
 * Verdadeiro quando a linha pertence à organização do token E a campanha está
 * entre as do usuário. Predicado usado por praticamente toda política de
 * dados. Concentrar aqui evita divergência entre tabelas.
 */
create or replace function autenticacao.pertence(p_id_organizacao uuid, p_id_campanha uuid)
returns boolean
language sql
stable
as $$
  select p_id_organizacao is not null
     and p_id_organizacao = autenticacao.id_organizacao()
     and (p_id_campanha is null or p_id_campanha = any(autenticacao.campanhas()));
$$;

-- -----------------------------------------------------------------------------
-- Criptografia de identificadores (LGPD, seção 2.1)
-- -----------------------------------------------------------------------------

/**
 * HMAC-SHA256 para índice de busca sobre dado criptografado.
 *
 * O índice NUNCA é construído sobre o texto claro. Guardamos o CPF cifrado em
 * AES-256-GCM (feito na aplicação, onde a chave vive) e, ao lado, o HMAC — que
 * é determinístico e permite `where cpf_hmac = ...` sem jamais expor o valor.
 * O segredo do HMAC vem de configuração do banco, não do repositório.
 */
create or replace function public.hmac_indice(p_valor text)
returns text
language sql
immutable
as $$
  select case
    when p_valor is null or p_valor = '' then null
    else encode(
      hmac(
        regexp_replace(p_valor, '\D', '', 'g'),
        coalesce(current_setting('app.segredo_hmac', true), ''),
        'sha256'
      ),
      'hex'
    )
  end;
$$;

comment on function public.hmac_indice(text) is
  'Índice determinístico de busca sobre identificador criptografado. Normaliza para '
  'somente dígitos antes de calcular, para que máscara não altere o resultado.';

-- -----------------------------------------------------------------------------
-- Normalização de texto para deduplicação
-- -----------------------------------------------------------------------------

/**
 * Forma canônica de um texto para comparação: sem acento, em maiúsculas, sem
 * pontuação e com espaços colapsados. Espelha `normalizarTexto` de
 * `pacotes/utilitarios/src/texto.ts` — as duas implementações precisam
 * concordar, senão o front sugere um duplicado que o back não reconhece.
 */
create or replace function public.normalizar_texto(p_valor text)
returns text
language sql
immutable
as $$
  select nullif(
    trim(regexp_replace(upper(unaccent(coalesce(p_valor, ''))), '[^A-Z0-9]+', ' ', 'g')),
    ''
  );
$$;

-- -----------------------------------------------------------------------------
-- Gatilho genérico de atualização de timestamp
-- -----------------------------------------------------------------------------

create or replace function public.marcar_atualizado_em()
returns trigger
language plpgsql
as $$
begin
  new.atualizado_em := now();
  return new;
end;
$$;
