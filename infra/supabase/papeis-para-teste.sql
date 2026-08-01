-- =============================================================================
-- Papéis do Supabase, recriados num PostgreSQL cru.
--
-- Serve só para o CI e para bancos descartáveis de desenvolvimento. Num projeto
-- Supabase estes papéis já existem e este arquivo não é executado.
--
-- Por que isto importa mais do que parece: a API roda **toda** consulta sob
-- `set local role authenticated`. Se o CI aplicasse as migrations sem esse
-- papel, os testes de isolamento acabariam exercitando algum papel inventado, e
-- um GRANT faltando para `authenticated` passaria despercebido — foi
-- exatamente assim que um `42501 insufficient_privilege` chegou em produção,
-- onde virou tela vazia indistinguível de "não há dados".
--
-- `nologin` de propósito: são papéis para `set role`, não para conectar.
-- =============================================================================

do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then
    create role anon nologin noinherit;
  end if;

  if not exists (select 1 from pg_roles where rolname = 'authenticated') then
    create role authenticated nologin noinherit;
  end if;

  if not exists (select 1 from pg_roles where rolname = 'service_role') then
    create role service_role nologin noinherit bypassrls;
  end if;

  -- Papel com que o Supabase Auth executa o Custom Access Token Hook.
  if not exists (select 1 from pg_roles where rolname = 'supabase_auth_admin') then
    create role supabase_auth_admin nologin noinherit;
  end if;
end;
$$;

-- O usuário da conexão precisa poder assumir os papéis, senão o `set role` dos
-- testes falha com "permission denied to set role".
grant anon, authenticated, service_role, supabase_auth_admin to current_user;
