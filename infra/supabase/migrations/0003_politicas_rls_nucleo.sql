-- =============================================================================
-- 0003 — Políticas RLS do núcleo
--
-- Princípios aplicados em todo o arquivo:
--
--  1. `enable` + `FORCE row level security`. Sem o FORCE, o dono da tabela
--     (e portanto qualquer migration ou job que rode como ele) ignora a
--     política — o que anularia o isolamento justo no caminho mais perigoso.
--  2. Toda política compara com `autenticacao.id_organizacao()`, que vem do JWT.
--  3. `with check` sempre presente nas políticas de escrita: sem ele, um
--     usuário poderia INSERIR linha carimbada com a organização de outro.
--  4. O padrão é negar. Não existe política `using (true)` em tabela de dados.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- planos — catálogo do provedor
-- -----------------------------------------------------------------------------

alter table public.planos enable row level security;
alter table public.planos force row level security;

-- Qualquer usuário autenticado precisa ler o plano para a tela de limites.
create policy planos_leitura on public.planos
  for select
  using (autenticacao.id_organizacao() is not null or autenticacao.eh_provedor());

-- Escrita apenas pelo backoffice. Nenhuma política de INSERT/UPDATE/DELETE para
-- usuários de organização — a ausência de política já nega.
create policy planos_escrita_provedor on public.planos
  for all
  using (autenticacao.eh_provedor())
  with check (autenticacao.eh_provedor());

-- -----------------------------------------------------------------------------
-- organizacoes
-- -----------------------------------------------------------------------------

alter table public.organizacoes enable row level security;
alter table public.organizacoes force row level security;

create policy organizacoes_propria on public.organizacoes
  for select
  using (id = autenticacao.id_organizacao());

-- Só o administrador altera os dados da própria organização.
create policy organizacoes_alterar on public.organizacoes
  for update
  using (
    id = autenticacao.id_organizacao()
    and autenticacao.escopo_de('organizacao.alterar') = 'CAMPANHA'
  )
  with check (id = autenticacao.id_organizacao());

-- O backoffice enxerga o cadastro comercial de todas as organizações — nome,
-- plano, status, vigência. Isso NÃO dá acesso a nenhum dado de campo.
create policy organizacoes_provedor on public.organizacoes
  for all
  using (autenticacao.eh_provedor())
  with check (autenticacao.eh_provedor());

-- -----------------------------------------------------------------------------
-- campanhas
-- -----------------------------------------------------------------------------

alter table public.campanhas enable row level security;
alter table public.campanhas force row level security;

/**
 * Segundo nível de isolamento: dentro da mesma organização, o usuário só vê as
 * campanhas às quais foi vinculado. Um coordenador da campanha "Deputado
 * Federal" não enxerga a campanha "Governador" da mesma organização se não
 * estiver nela.
 */
create policy campanhas_visiveis on public.campanhas
  for select
  using (
    id_organizacao = autenticacao.id_organizacao()
    and id = any(autenticacao.campanhas())
  );

create policy campanhas_gerenciar on public.campanhas
  for all
  using (
    id_organizacao = autenticacao.id_organizacao()
    and autenticacao.escopo_de('campanhas.gerenciar') = 'CAMPANHA'
  )
  with check (id_organizacao = autenticacao.id_organizacao());

-- -----------------------------------------------------------------------------
-- perfis_acesso, permissoes, perfil_permissoes
-- -----------------------------------------------------------------------------

alter table public.perfis_acesso enable row level security;
alter table public.perfis_acesso force row level security;

create policy perfis_da_organizacao on public.perfis_acesso
  for select using (id_organizacao = autenticacao.id_organizacao());

create policy perfis_gerenciar on public.perfis_acesso
  for all
  using (
    id_organizacao = autenticacao.id_organizacao()
    and autenticacao.escopo_de('perfis.gerenciar') = 'CAMPANHA'
  )
  with check (id_organizacao = autenticacao.id_organizacao());

alter table public.permissoes enable row level security;
alter table public.permissoes force row level security;

-- Catálogo global, somente leitura para quem está autenticado.
create policy permissoes_leitura on public.permissoes
  for select
  using (autenticacao.id_organizacao() is not null or autenticacao.eh_provedor());

alter table public.perfil_permissoes enable row level security;
alter table public.perfil_permissoes force row level security;

create policy perfil_permissoes_da_organizacao on public.perfil_permissoes
  for select
  using (
    exists (
      select 1 from public.perfis_acesso p
      where p.id = perfil_permissoes.id_perfil
        and p.id_organizacao = autenticacao.id_organizacao()
    )
  );

create policy perfil_permissoes_gerenciar on public.perfil_permissoes
  for all
  using (
    autenticacao.escopo_de('perfis.gerenciar') = 'CAMPANHA'
    and exists (
      select 1 from public.perfis_acesso p
      where p.id = perfil_permissoes.id_perfil
        and p.id_organizacao = autenticacao.id_organizacao()
    )
  )
  with check (
    exists (
      select 1 from public.perfis_acesso p
      where p.id = perfil_permissoes.id_perfil
        and p.id_organizacao = autenticacao.id_organizacao()
    )
  );

-- -----------------------------------------------------------------------------
-- usuarios
-- -----------------------------------------------------------------------------

alter table public.usuarios enable row level security;
alter table public.usuarios force row level security;

/**
 * O usuário sempre enxerga a si mesmo. Além disso, enxerga os colegas conforme
 * o escopo de `usuarios.ler`: o entrevistador com escopo PROPRIO vê apenas o
 * próprio cadastro; o coordenador vê a equipe; o administrador vê todos.
 */
create policy usuarios_visiveis on public.usuarios
  for select
  using (
    id_organizacao = autenticacao.id_organizacao()
    and (
      id = autenticacao.id_usuario()
      or autenticacao.escopo_de('usuarios.ler') = 'CAMPANHA'
      or (
        autenticacao.escopo_de('usuarios.ler') in ('EQUIPE', 'TERRITORIO')
        and exists (
          select 1 from public.equipe_membros m
          where m.id_usuario = usuarios.id
            and m.id_equipe = any(autenticacao.equipes())
        )
      )
    )
  );

-- Cada um edita o próprio perfil (nome, telefone, tema, MFA).
create policy usuarios_editar_proprio on public.usuarios
  for update
  using (id = autenticacao.id_usuario() and id_organizacao = autenticacao.id_organizacao())
  with check (id = autenticacao.id_usuario() and id_organizacao = autenticacao.id_organizacao());

create policy usuarios_gerenciar on public.usuarios
  for all
  using (
    id_organizacao = autenticacao.id_organizacao()
    and autenticacao.escopo_de('usuarios.gerenciar') = 'CAMPANHA'
  )
  with check (id_organizacao = autenticacao.id_organizacao());

-- -----------------------------------------------------------------------------
-- usuario_campanhas, equipes, equipe_membros, convites
-- -----------------------------------------------------------------------------

alter table public.usuario_campanhas enable row level security;
alter table public.usuario_campanhas force row level security;

create policy usuario_campanhas_visiveis on public.usuario_campanhas
  for select
  using (
    id_organizacao = autenticacao.id_organizacao()
    and (
      id_usuario = autenticacao.id_usuario()
      or autenticacao.escopo_de('usuarios.ler') = 'CAMPANHA'
    )
  );

create policy usuario_campanhas_gerenciar on public.usuario_campanhas
  for all
  using (
    id_organizacao = autenticacao.id_organizacao()
    and autenticacao.escopo_de('usuarios.gerenciar') = 'CAMPANHA'
  )
  with check (id_organizacao = autenticacao.id_organizacao());

alter table public.equipes enable row level security;
alter table public.equipes force row level security;

create policy equipes_visiveis on public.equipes
  for select
  using (
    autenticacao.pertence(id_organizacao, id_campanha)
    and (
      autenticacao.escopo_de('equipes.ler') = 'CAMPANHA'
      or id = any(autenticacao.equipes())
      or id_coordenador = autenticacao.id_usuario()
    )
  );

create policy equipes_gerenciar on public.equipes
  for all
  using (
    autenticacao.pertence(id_organizacao, id_campanha)
    and autenticacao.escopo_de('equipes.gerenciar') in ('CAMPANHA', 'TERRITORIO')
  )
  with check (autenticacao.pertence(id_organizacao, id_campanha));

alter table public.equipe_membros enable row level security;
alter table public.equipe_membros force row level security;

create policy equipe_membros_visiveis on public.equipe_membros
  for select
  using (
    id_organizacao = autenticacao.id_organizacao()
    and (
      id_usuario = autenticacao.id_usuario()
      or id_equipe = any(autenticacao.equipes())
      or autenticacao.escopo_de('equipes.ler') = 'CAMPANHA'
    )
  );

create policy equipe_membros_gerenciar on public.equipe_membros
  for all
  using (
    id_organizacao = autenticacao.id_organizacao()
    and autenticacao.escopo_de('equipes.gerenciar') in ('CAMPANHA', 'TERRITORIO')
  )
  with check (id_organizacao = autenticacao.id_organizacao());

alter table public.convites enable row level security;
alter table public.convites force row level security;

create policy convites_gerenciar on public.convites
  for all
  using (
    id_organizacao = autenticacao.id_organizacao()
    and autenticacao.escopo_de('usuarios.gerenciar') = 'CAMPANHA'
  )
  with check (id_organizacao = autenticacao.id_organizacao());

-- -----------------------------------------------------------------------------
-- logs_auditoria — leitura restrita, escrita só por gatilho, sem alteração
-- -----------------------------------------------------------------------------

alter table public.logs_auditoria enable row level security;
alter table public.logs_auditoria force row level security;

create policy logs_auditoria_leitura on public.logs_auditoria
  for select
  using (
    id_organizacao = autenticacao.id_organizacao()
    and autenticacao.escopo_de('auditoria.ler') = 'CAMPANHA'
  );

/**
 * O provedor lê a auditoria da organização apenas em nível de METADADO: quem,
 * quando, qual entidade. O conteúdo (`dados_antes`/`dados_depois`) fica de fora
 * pela view `provedor.auditoria_metadados`, definida na migration do backoffice.
 * Esta política existe só para permitir a agregação; a view é que restringe as
 * colunas.
 */
create policy logs_auditoria_provedor on public.logs_auditoria
  for select
  using (autenticacao.suporte_ativo(id_organizacao));

create policy logs_auditoria_inserir on public.logs_auditoria
  for insert
  with check (id_organizacao = autenticacao.id_organizacao());

-- Sem política de UPDATE e sem política de DELETE: a trilha é imutável para
-- todos, inclusive para o administrador da organização.

-- -----------------------------------------------------------------------------
-- acessos_suporte
-- -----------------------------------------------------------------------------

alter table public.acessos_suporte enable row level security;
alter table public.acessos_suporte force row level security;

-- O cliente sempre vê quem da Jeos teve acesso aos seus dados, e quando.
create policy acessos_suporte_leitura_cliente on public.acessos_suporte
  for select using (id_organizacao = autenticacao.id_organizacao());

-- Conceder é ato exclusivo do administrador da organização. O provedor não
-- consegue inserir aqui: não tem `id_organizacao` no token.
create policy acessos_suporte_conceder on public.acessos_suporte
  for insert
  with check (
    id_organizacao = autenticacao.id_organizacao()
    and autenticacao.escopo_de('suporte.autorizar') = 'CAMPANHA'
    and autorizado_por = autenticacao.id_usuario()
  );

-- Revogar a qualquer momento, antes do prazo.
create policy acessos_suporte_revogar on public.acessos_suporte
  for update
  using (
    id_organizacao = autenticacao.id_organizacao()
    and autenticacao.escopo_de('suporte.autorizar') = 'CAMPANHA'
  )
  with check (id_organizacao = autenticacao.id_organizacao());

create policy acessos_suporte_provedor_leitura on public.acessos_suporte
  for select using (autenticacao.eh_provedor() and id_usuario_provedor = autenticacao.id_usuario());
