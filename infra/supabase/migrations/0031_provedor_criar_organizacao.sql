-- =============================================================================
-- 0031 — Provedor pode criar organização e auditar a própria ação
--
-- O backoffice (`public.organizacoes`, `for all` já cobre o provedor desde a
-- 0011) sempre pôde criar/alterar a organização em si. Duas peças faltavam
-- para o superadmin ir além de "olhar": inserir o PRIMEIRO usuário
-- administrador de uma organização nova, e registrar essa ação na mesma
-- trilha de auditoria que o backoffice já lê (`provedor.auditoria_metadados`,
-- uma view sobre `logs_auditoria`).
--
-- As duas faltavam pelo mesmo motivo: o token do provedor não tem
-- `id_organizacao` (decisão de arquitetura — o provedor não é uma
-- organização), e as políticas existentes de `usuarios`/`logs_auditoria`
-- comparam sempre com `autenticacao.id_organizacao()`, que para esse token é
-- nulo. `x = null` nunca é verdadeiro, nem quando `x` também é nulo — então
-- nenhuma política existente libera essas duas escritas, para nenhum valor.
--
-- Escopo deliberadamente estreito: só INSERT, só sob `eh_provedor()`. O
-- provedor continua sem SELECT/UPDATE/DELETE em `usuarios` de organização —
-- criar o primeiro administrador não é a mesma coisa que enxergar a equipe.
--
-- Uma terceira faltava, descoberta só ao testar o fluxo de ponta a ponta:
-- depois de `semear_perfis_organizacao` (que É `security definer` e por
-- isso já grava os 7 perfis-padrão sem tropeçar em RLS), o código precisa
-- LER de volta o id do perfil ADMINISTRADOR recém-criado para vincular o
-- primeiro usuário a ele — e essa leitura roda como `role authenticated`
-- normal, sujeita à mesma política que nega a organização a quem não é
-- dela. Sem esta política o INSERT dos perfis "funcionava" (dentro da
-- função) e o SELECT seguinte devolvia zero linhas — não um erro de RLS,
-- um `undefined` na hora de ler `.id` da linha que nunca chegou.
-- =============================================================================

create policy usuarios_provedor_inserir on public.usuarios
  for insert
  with check (autenticacao.eh_provedor());

create policy logs_auditoria_inserir_provedor on public.logs_auditoria
  for insert
  with check (autenticacao.eh_provedor());

create policy perfis_acesso_provedor_leitura on public.perfis_acesso
  for select
  using (autenticacao.eh_provedor());

-- Uma quarta lacuna, da mesma família: `0015_permissoes_papel_autenticado.sql`
-- concedeu `usage on schema provedor` a `authenticated`, mas nunca `select`
-- nas tabelas/views de dentro — só em `public` e `catalogo`. Sem isto,
-- `GET /provedor/auditoria` (que já existia antes desta migration) sempre
-- devolveu "42501 insufficient_privilege", traduzido pela API em "Registro
-- não encontrado" — o mesmo sintoma que 0015 documenta e que, de tão
-- parecido com "não há dados ainda", nunca tinha sido notado.
grant select on provedor.auditoria_metadados to authenticated;
