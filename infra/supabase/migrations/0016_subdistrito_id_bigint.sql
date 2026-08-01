-- =============================================================================
-- 0016 — `subdistritos.id_ibge` passa a `bigint`
--
-- O identificador de subdistrito do IBGE tem 11 dígitos (ex.: 33004070501, do
-- Rio de Janeiro), e `integer` vai até 2.147.483.647. A carga de referência
-- falhava com `value "33004070501" is out of range for type integer` em 17 das
-- 27 UFs — e falhava *só* nos subdistritos, então estados, municípios e
-- distritos entravam normalmente e o problema passava por "essa UF não tem
-- subdistrito".
--
-- Município (7 dígitos) e distrito (9 dígitos) cabem em `integer` com folga e
-- ficam como estão. Só o subdistrito precisa da largura maior.
--
-- Nenhuma tabela referencia `subdistritos.id_ibge`, então a troca de tipo não
-- arrasta chaves estrangeiras.
-- =============================================================================

alter table public.subdistritos
  alter column id_ibge type bigint;
