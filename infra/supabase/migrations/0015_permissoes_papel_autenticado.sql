-- =============================================================================
-- 0015 — GRANTs para o papel `authenticated`
--
-- A API roda toda consulta sob `set local role authenticated`. Sem GRANT, o
-- PostgreSQL recusa antes mesmo de avaliar a política, com `42501
-- insufficient_privilege` — que a API traduz para "Registro não encontrado" e
-- vira uma tela vazia indistinguível de "não há dados".
--
-- Conceder acesso amplo aqui **não** afrouxa o isolamento: todas as tabelas têm
-- `FORCE ROW LEVEL SECURITY`, então o GRANT decide se o papel pode *tentar* ler,
-- e a política decide *quais linhas* ele vê. Sem GRANT nada funciona; com GRANT
-- e sem política, nada é retornado. As duas camadas são necessárias.
-- =============================================================================

grant usage on schema public, autenticacao, catalogo, provedor to authenticated;

grant select, insert, update, delete on all tables in schema public to authenticated;
grant select on all tables in schema catalogo to authenticated;
grant usage, select on all sequences in schema public to authenticated;
grant execute on all functions in schema public, autenticacao to authenticated;

-- Tabelas criadas por migrations futuras herdam o mesmo tratamento, para que
-- ninguém precise lembrar de repetir isto — e descobrir o esquecimento só em
-- produção, como aconteceu aqui.
alter default privileges in schema public
  grant select, insert, update, delete on tables to authenticated;
alter default privileges in schema public
  grant usage, select on sequences to authenticated;
alter default privileges in schema public
  grant execute on functions to authenticated;

-- O papel anônimo continua sem acesso a dado de campo: quem não autenticou não
-- tem organização, e não haveria política que o aceitasse de qualquer forma.
revoke all on all tables in schema public from anon;
grant usage on schema public to anon;
