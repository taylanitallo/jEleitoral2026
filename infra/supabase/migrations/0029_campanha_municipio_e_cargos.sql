-- =============================================================================
-- 0029 — A campanha é o município
--
-- "A campanha é pra ser como se fosse um município, pois a campanha será o
-- nosso cliente" — pedido literal do usuário. Duas peças faltavam:
--
--  1. `campanhas.id_municipio_base` já existia (0002), já era gravado no
--     INSERT e NUNCA era lido, nunca voltava no SELECT, nem era atualizado no
--     PUT. Um inteiro solto sem FK, sem uso — pior que não existir, porque
--     parecia funcionar.
--  2. Nada dizia quais cargos uma campanha disputa. `/campo/contexto`
--     decidia isso com uma regra fixa (todos os cargos menos o distrital ou o
--     estadual, conforme a UF), sem olhar a campanha nenhuma vez.
--
-- Não renomeamos `id_municipio_base` — trocar nome de coluna de tabela viva é
-- coordenação de deploy por nada. Só limpamos e amarramos a FK que faltava.
-- =============================================================================

-- --- Município de verdade -----------------------------------------------------

/*
 * Limpa antes de amarrar: qualquer valor que hoje não bate com um município
 * real vira nulo, em vez de travar a migration com uma FK que não fecha. Uma
 * campanha com município errado volta a pedir o município — melhor que a
 * 0029 inteira falhar em produção por um dado velho e nunca conferido.
 */
update public.campanhas
   set id_municipio_base = null
 where id_municipio_base is not null
   and not exists (
     select 1 from public.municipios m where m.id_ibge = campanhas.id_municipio_base
   );

alter table public.campanhas
  add constraint campanhas_municipio_fkey
  foreign key (id_municipio_base) references public.municipios(id_ibge);

comment on column public.campanhas.id_municipio_base is
  'Município-sede da campanha. A campanha É o município: é o cliente '
  'operacional. Nulo em campanha estadual ou federal sem sede definida.';

-- --- Cargos que a campanha disputa --------------------------------------------

/*
 * Uma linha por (campanha, cargo). `disputa` responde à pergunta que o
 * usuário fez: a chapa dele tem candidato próprio em 5 dos cargos gerais, mas
 * o formulário pergunta sobre TODOS — inclusive o cargo que a campanha não
 * disputa. Saber que o eleitor é da chapa no estadual mas não no governo é
 * exatamente o tipo de leitura que orienta palanque, e é o que
 * `campo.controller.ts` já defendia antes desta migration existir.
 */
create table public.campanha_cargos (
  id uuid primary key default gen_random_uuid(),
  id_organizacao uuid not null references public.organizacoes(id) on delete cascade,
  id_campanha uuid not null references public.campanhas(id) on delete cascade,
  id_cargo uuid not null references public.cargos(id),
  ordem smallint not null default 0,
  disputa boolean not null default true,
  criado_em timestamptz not null default now(),
  atualizado_em timestamptz not null default now(),
  unique (id_campanha, id_cargo)
);

create index campanha_cargos_idx
  on public.campanha_cargos (id_organizacao, id_campanha, ordem);

/*
 * Leitura com `campo.ler`, e não `campanhas.gerenciar`: o entrevistador
 * precisa desta tabela para montar o formulário, e ele não tem — nem deveria
 * ter — permissão para administrar campanhas.
 */
select autenticacao.aplicar_rls_padrao(
  'campanha_cargos', 'campo.ler', 'campanhas.gerenciar'
);

create trigger campanha_cargos_atualizado_em
  before update on public.campanha_cargos
  for each row execute function public.marcar_atualizado_em();

comment on table public.campanha_cargos is
  'Cargos que a campanha inclui no formulario de campo. disputa=true marca os '
  'cargos com candidato proprio; disputa=false so pergunta para ler o '
  'palanque. Sem linha para uma campanha, /campo/contexto cai para a regra '
  'antiga (todos os cargos gerais).';

-- --- Semente: torna esta migration um no-op de comportamento -----------------

/*
 * Reproduz, para cada campanha ativa, exatamente a regra que
 * `campo.controller.ts` aplicava antes desta migration: todos os cargos gerais,
 * exceto o Deputado Distrital (fora do DF) ou o Deputado Estadual (no DF).
 * `disputa` fica marcado nos cargos onde a campanha já tem candidato próprio.
 *
 * `no force` / `force`, como em toda migration de dados: as políticas de
 * `campanha_cargos` chamam `autenticacao.pertence(...)`, que lê o JWT — e
 * durante a migration não há JWT. Sem isto, o INSERT não afetaria linha
 * nenhuma, em silêncio.
 */
alter table public.campanha_cargos no force row level security;

insert into public.campanha_cargos (id_organizacao, id_campanha, id_cargo, ordem, disputa)
select c.id_organizacao,
       c.id,
       cg.id,
       case cg.nome
         when 'Presidente' then 1
         when 'Governador' then 2
         when 'Senador' then 3
         when 'Deputado Federal' then 4
         else 5
       end as ordem,
       exists (
         select 1 from public.candidatos cand
          where cand.id_campanha = c.id and cand.id_cargo = cg.id and cand.proprio and cand.ativo
       ) as disputa
  from public.campanhas c
  cross join public.cargos cg
 where c.ativa
   and cg.nome <> (case when c.uf = 'DF' then 'Deputado Estadual' else 'Deputado Distrital' end)
on conflict (id_campanha, id_cargo) do nothing;

alter table public.campanha_cargos force row level security;
