-- =============================================================================
-- 0013 — Índices de tenant faltantes
--
-- Encontrado pelo teste `coberturaRls.spec.ts` na primeira execução contra um
-- PostgreSQL real (01/08/2026): seis tabelas carregam `id_organizacao` e são
-- filtradas por ela em toda política RLS, mas nenhuma tinha índice liderado por
-- essa coluna.
--
-- Enquanto a base está vazia isso não aparece. Com uma campanha estadual em
-- operação — dezenas de milhares de lançamentos financeiros e milhares de
-- versões de arte — cada consulta viraria varredura completa da tabela, e a
-- lentidão apareceria em produção, no pior momento possível.
--
-- Este é exatamente o tipo de defeito que o teste de cobertura existe para
-- encontrar antes do cliente.
-- =============================================================================

create index if not exists centros_custo_organizacao_idx
  on public.centros_custo (id_organizacao, id_campanha);

create index if not exists categorias_lancamento_organizacao_idx
  on public.categorias_lancamento (id_organizacao, tipo);

create index if not exists fornecedores_organizacao_idx
  on public.fornecedores (id_organizacao, id_campanha);

create index if not exists orcamentos_organizacao_idx
  on public.orcamentos (id_organizacao, id_campanha, mes_referencia);

create index if not exists versoes_arte_organizacao_idx
  on public.versoes_arte (id_organizacao, id_material);

-- A chave primária é (id_entrevista, id_usuario); a política filtra por
-- organização antes de tudo.
create index if not exists entrevista_entrevistadores_organizacao_idx
  on public.entrevista_entrevistadores (id_organizacao, id_usuario);
