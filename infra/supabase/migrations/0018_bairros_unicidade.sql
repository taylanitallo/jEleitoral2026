-- =============================================================================
-- 0018 — unicidade de bairro dentro do município
--
-- `logradouros` já tinha `logradouros_unicidade_idx`; `bairros` não tinha
-- equivalente. A consequência aparece no primeiro dia de campo: dois
-- entrevistadores na mesma rua digitam "Centro" no mesmo minuto e a base fica
-- com dois bairros de mesmo nome, cada um com metade dos domicílios. Toda
-- agregação por bairro — cobertura, meta, custo por voto — passa a somar
-- errado, e nada indica a causa.
--
-- É índice PARCIAL, espelhando o de logradouros: o bairro mesclado pela
-- curadoria continua na tabela apontando para o vencedor, e precisa poder
-- coexistir com ele sem violar a unicidade.
--
-- `nome_normalizado` é coluna gerada por `public.normalizar_texto`, então
-- "Centro", "centro" e "CENTRO" colidem — que é exatamente o objetivo.
-- =============================================================================

-- Consolida duplicatas pré-existentes antes de criar o índice: sem isto, a
-- criação falha em qualquer ambiente que já tenha coletado em campo.
with ranqueados as (
  select id,
         first_value(id) over (
           partition by id_organizacao, id_municipio, nome_normalizado
           order by criado_em, id
         ) as id_vencedor
    from public.bairros
   where id_bairro_mesclado_em is null
)
update public.bairros b
   set id_bairro_mesclado_em = r.id_vencedor
  from ranqueados r
 where b.id = r.id
   and r.id <> r.id_vencedor;

create unique index bairros_unicidade_idx
  on public.bairros (id_organizacao, id_municipio, nome_normalizado)
  where id_bairro_mesclado_em is null;

comment on index public.bairros_unicidade_idx is
  'Impede dois bairros de mesmo nome no mesmo município da mesma organização. '
  'Parcial: o bairro mesclado pela curadoria coexiste com o vencedor.';
