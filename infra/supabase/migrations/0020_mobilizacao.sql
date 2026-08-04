-- =============================================================================
-- 0019 — Mobilização: ativistas e comitês
--
-- O sistema sabia tudo sobre o ELEITOR e nada sobre quem faz a campanha
-- acontecer. Toda pessoa que agia aqui precisava ser `public.usuarios`, que
-- espelha `auth.users.id` e exige perfil de acesso — ou seja, conta, senha e
-- suporte. Um cabo eleitoral que só distribui santinho no bairro não precisa
-- entrar no sistema, e obrigá-lo a isso custaria licença e travaria o cadastro
-- da militância no gargalo do administrador.
--
-- Daí `ativistas` ser tabela própria, deliberadamente FORA da árvore de
-- autenticação.
-- =============================================================================

create type public.papel_ativista as enum (
  'MULTIPLICADOR', 'LIDERANCA', 'CABO_ELEITORAL', 'VOLUNTARIO', 'APOIADOR'
);

create type public.tipo_comite as enum (
  'CENTRAL', 'REGIONAL', 'BAIRRO', 'TEMATICO', 'MOVEL'
);

-- --- Comitês -----------------------------------------------------------------
-- Vem antes de `ativistas` porque ela referencia esta.

create table public.comites (
  id uuid primary key default gen_random_uuid(),
  id_organizacao uuid not null references public.organizacoes(id) on delete cascade,
  id_campanha uuid not null references public.campanhas(id) on delete cascade,
  nome text not null,
  tipo public.tipo_comite not null default 'BAIRRO',
  -- A equipe do comitê é a ponte com o escopo do JWT: quem trabalha ali entra
  -- em `equipe_membros` e herda o território sem configuração extra.
  id_equipe uuid references public.equipes(id) on delete set null,
  id_coordenador uuid references public.usuarios(id) on delete set null,
  id_bairro uuid references public.bairros(id),
  id_logradouro uuid references public.logradouros(id),
  numero text,
  complemento text,
  latitude double precision,
  longitude double precision,
  telefone_contato text,
  horario_funcionamento text,
  data_inauguracao date,
  ativo boolean not null default true,
  observacoes text,
  criado_em timestamptz not null default now(),
  atualizado_em timestamptz not null default now(),
  unique (id_campanha, nome)
);

create index comites_org_idx on public.comites (id_organizacao, id_campanha, ativo);
create index comites_bairro_idx on public.comites (id_organizacao, id_bairro);

-- --- Ativistas ---------------------------------------------------------------

create table public.ativistas (
  id uuid primary key default gen_random_uuid(),
  id_organizacao uuid not null references public.organizacoes(id) on delete cascade,
  id_campanha uuid not null references public.campanhas(id) on delete cascade,
  nome text not null,
  nome_normalizado text generated always as (public.normalizar_texto(nome)) stored,
  apelido text,
  telefone text,
  email citext,
  papel public.papel_ativista not null default 'MULTIPLICADOR',
  id_bairro uuid references public.bairros(id),
  id_comite uuid references public.comites(id) on delete set null,
  -- Quem cadastrou e responde pelo ativista. É a coluna de dono usada pelo
  -- escopo: o mobilizador enxerga a militância que ele mesmo arregimentou.
  id_usuario_padrinho uuid not null references public.usuarios(id),
  -- Ponte opcional com o mapeamento: o apoiador entrevistado que virou militante
  -- é a mesma pessoa, e perder esse vínculo faria a base contá-la duas vezes.
  id_entrevistado uuid references public.entrevistados(id) on delete set null,
  nivel_engajamento smallint not null default 3
    check (nivel_engajamento between 1 and 5),
  disponibilidade text,
  habilidades text[] not null default '{}',
  /*
   * Termo de adesão do voluntário.
   *
   * Reusa `versoes_consentimento` em vez de criar tabela própria: a estrutura
   * de versão, texto e vigência já existe e já é auditável. Muda só a
   * finalidade registrada.
   */
  aceitou_termo_em timestamptz,
  id_versao_consentimento uuid references public.versoes_consentimento(id),
  ativo boolean not null default true,
  observacoes text,
  criado_em timestamptz not null default now(),
  atualizado_em timestamptz not null default now()
);

create index ativistas_org_idx on public.ativistas (id_organizacao, id_campanha, ativo);
create index ativistas_bairro_idx on public.ativistas (id_organizacao, id_bairro);
create index ativistas_comite_idx on public.ativistas (id_organizacao, id_comite);
create index ativistas_padrinho_idx on public.ativistas (id_organizacao, id_usuario_padrinho);
create index ativistas_nome_trgm_idx
  on public.ativistas using gin (nome_normalizado gin_trgm_ops);

/*
 * Antiduplicata dentro da campanha.
 *
 * Inclui o telefone porque homônimo em município pequeno é regra, não exceção —
 * duas "Maria da Silva" no mesmo bairro são duas pessoas. Sem telefone, o
 * `coalesce` deixa o nome sozinho como chave, que é o comportamento certo:
 * cadastro sem contato repetido é quase sempre engano de digitação.
 */
create unique index ativistas_unicidade_idx
  on public.ativistas (id_campanha, nome_normalizado, coalesce(telefone, ''));

-- --- Membros do comitê -------------------------------------------------------

create table public.comite_membros (
  id uuid primary key default gen_random_uuid(),
  id_organizacao uuid not null references public.organizacoes(id) on delete cascade,
  id_campanha uuid not null references public.campanhas(id) on delete cascade,
  id_comite uuid not null references public.comites(id) on delete cascade,
  -- Membro é OU usuário do sistema OU ativista sem login. Nunca os dois, nunca
  -- nenhum: o `check` impede a linha órfã que ninguém consegue interpretar
  -- depois.
  id_usuario uuid references public.usuarios(id) on delete cascade,
  id_ativista uuid references public.ativistas(id) on delete cascade,
  papel text not null default 'MEMBRO',
  desde date not null default current_date,
  ativo boolean not null default true,
  criado_em timestamptz not null default now(),
  atualizado_em timestamptz not null default now(),
  constraint comite_membro_usuario_ou_ativista
    check (num_nonnulls(id_usuario, id_ativista) = 1)
);

create index comite_membros_org_idx on public.comite_membros (id_organizacao, id_comite);
-- Únicos PARCIAIS: um índice composto com as duas colunas não impediria o mesmo
-- ativista entrar duas vezes, porque `null` nunca colide com `null`.
create unique index comite_membros_usuario_idx
  on public.comite_membros (id_comite, id_usuario) where id_usuario is not null;
create unique index comite_membros_ativista_idx
  on public.comite_membros (id_comite, id_ativista) where id_ativista is not null;

-- --- Gatilhos de atualização -------------------------------------------------

do $$
declare
  tabela text;
begin
  foreach tabela in array array['comites', 'ativistas', 'comite_membros']
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
  ('mobilizacao.ler',       'Mobilização', 'Consultar ativistas e comitês'),
  ('mobilizacao.gerenciar', 'Mobilização', 'Cadastrar ativistas, comitês e vínculos')
on conflict (chave) do nothing;

/*
 * Distribuição nos perfis, via a função de apoio criada na 0019.
 *
 * Ela registra no catálogo (para organizações futuras) E aplica nas existentes
 * com `do nothing`. Chamar `semear_perfis_organizacao` aqui desfaria, em
 * silêncio, qualquer escopo que um administrador tenha ajustado à mão.
 *
 * O ADMINISTRADOR entra explicitamente: o curinga `*` dele só vale no momento
 * em que a organização é criada, então as que já existem não herdam sozinhas as
 * chaves de um módulo novo.
 */
select public.conceder_permissao_padrao('ADMINISTRADOR', 'mobilizacao.ler',       'CAMPANHA');
select public.conceder_permissao_padrao('ADMINISTRADOR', 'mobilizacao.gerenciar', 'CAMPANHA');
select public.conceder_permissao_padrao('COORDENADOR',   'mobilizacao.ler',       'CAMPANHA');
select public.conceder_permissao_padrao('COORDENADOR',   'mobilizacao.gerenciar', 'EQUIPE');
-- O mobilizador é quem arregimenta: sem `gerenciar` no território dele, a
-- militância só entraria pela mão do coordenador, que é o gargalo que este
-- módulo existe para eliminar.
select public.conceder_permissao_padrao('MOBILIZADOR',   'mobilizacao.ler',       'TERRITORIO');
select public.conceder_permissao_padrao('MOBILIZADOR',   'mobilizacao.gerenciar', 'TERRITORIO');
select public.conceder_permissao_padrao('ANALISTA',      'mobilizacao.ler',       'CAMPANHA');
select public.conceder_permissao_padrao('CANDIDATO',     'mobilizacao.ler',       'CAMPANHA');

-- --- RLS ---------------------------------------------------------------------

/*
 * Duas estratégias diferentes, de propósito.
 *
 * `comites` e `comite_membros` usam `aplicar_rls_padrao`: comitê é informação
 * estruturante da campanha, e todo mundo que pode ler mobilização deve enxergar
 * a rede inteira de comitês — inclusive para saber a quem recorrer noutro
 * bairro.
 *
 * `ativistas` NÃO pode usar o padrão. `aplicar_rls_padrao` só exige
 * `escopo_de(...) is not null`, então até o escopo PROPRIO enxergaria a
 * militância inteira da campanha, com telefone. Um mobilizador que sai para a
 * concorrência levaria a lista de contatos completa. Aqui vale
 * `visivel_no_escopo`, com o padrinho como dono e o bairro como território.
 */
select autenticacao.aplicar_rls_padrao('comites',        'mobilizacao.ler', 'mobilizacao.gerenciar');
select autenticacao.aplicar_rls_padrao('comite_membros', 'mobilizacao.ler', 'mobilizacao.gerenciar');

alter table public.ativistas enable row level security;
alter table public.ativistas force row level security;

create policy ativistas_ler on public.ativistas
  for select using (
    autenticacao.pertence(id_organizacao, id_campanha)
    and autenticacao.visivel_no_escopo(
          'mobilizacao.ler', id_usuario_padrinho, null::uuid, id_bairro
        )
  );

-- Cadastrar carimba o próprio usuário como padrinho: ninguém arregimenta em
-- nome de terceiro.
create policy ativistas_inserir on public.ativistas
  for insert with check (
    autenticacao.pertence(id_organizacao, id_campanha)
    and autenticacao.escopo_de('mobilizacao.gerenciar') is not null
    and id_usuario_padrinho = autenticacao.id_usuario()
  );

create policy ativistas_alterar on public.ativistas
  for update using (
    autenticacao.pertence(id_organizacao, id_campanha)
    and autenticacao.visivel_no_escopo(
          'mobilizacao.gerenciar', id_usuario_padrinho, null::uuid, id_bairro
        )
  ) with check (autenticacao.pertence(id_organizacao, id_campanha));

-- Excluir exige escopo de campanha: quem cadastrou não apaga a própria base.
create policy ativistas_excluir on public.ativistas
  for delete using (
    autenticacao.pertence(id_organizacao, id_campanha)
    and autenticacao.escopo_de('mobilizacao.gerenciar') = 'CAMPANHA'
  );

create policy ativistas_suporte on public.ativistas
  for select using (autenticacao.suporte_ativo(id_organizacao));

comment on table public.ativistas is
  'Militância sem acesso ao sistema. Fora de public.usuarios de propósito: cabo '
  'eleitoral não precisa de conta, e exigir uma travaria o cadastro no gargalo do '
  'administrador.';

comment on table public.comites is
  'Comitês de campanha. id_equipe é a ponte com o escopo do JWT: quem trabalha no '
  'comitê entra em equipe_membros e herda o território.';
