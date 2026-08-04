-- =============================================================================
-- 0024 — `usos_ia` passa a registrar o provedor
--
-- Com dois provedores possíveis, a coluna `modelo` sozinha não responde quanto
-- se gastou em cada um: nomes de modelo não têm prefixo padronizado, e agrupar
-- por eles no relatório misturaria as duas faturas.
--
-- Default `anthropic` porque é o que todas as linhas existentes usaram — não é
-- suposição, é o único provedor que existia até esta migration.
-- =============================================================================

alter table public.usos_ia
  add column provedor text not null default 'anthropic';

create index usos_ia_provedor_idx
  on public.usos_ia (id_organizacao, provedor, criado_em desc);

comment on column public.usos_ia.provedor is
  'Provedor que atendeu a chamada. Necessário porque o nome do modelo não '
  'identifica o fornecedor de forma confiável.';
