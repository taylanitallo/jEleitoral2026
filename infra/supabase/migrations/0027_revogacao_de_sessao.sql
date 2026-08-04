-- =============================================================================
-- 0027 — Revogação de sessão
--
-- O problema que esta migration resolve é o mais sério que sobrou do sistema, e
-- ele é invisível: **as permissões viajam no JWT**. Tirar `financeiro.gerenciar`
-- de alguém não faz nada até o token dessa pessoa ser reemitido. Desligar um
-- coordenador que saiu da campanha, no meio de uma sexta-feira, não o desliga.
--
-- A correção tem duas metades. Esta é a do banco: uma marca de "todo token
-- emitido antes deste instante está velho", mantida por gatilho em cada tabela
-- que alimenta os claims. A outra metade é o guard da API, que compara o `iat`
-- do token contra a marca e devolve 401 com código próprio, e o cliente web,
-- que renova em silêncio e repete a requisição.
--
-- Por que não expurgar a sessão no Supabase Auth: só a chave de serviço pode
-- fazê-lo, uma sessão por chamada, e o efeito seria jogar a pessoa na tela de
-- login. Aqui o token é reemitido pelo hook, com os claims novos, sem que ela
-- perceba — que é o comportamento correto para quem só teve o escopo ajustado.
-- =============================================================================

alter table public.usuarios
  add column claims_invalidos_apos timestamptz not null default now();

comment on column public.usuarios.claims_invalidos_apos is
  'Todo JWT emitido antes deste instante e considerado desatualizado pela API. '
  'Mantido por gatilho em usuarios, perfil_permissoes, usuario_campanhas e '
  'equipe_membros — as quatro fontes dos claims.';

/*
 * O índice existe para a consulta do guard, que roda em toda requisição
 * autenticada. É por `id` (já a PK) mais a coluna, para virar leitura só de
 * índice — a diferença entre um lookup barato e um acesso ao heap por
 * requisição, com a API inteira dependendo dele.
 */
create index usuarios_claims_invalidos_idx
  on public.usuarios (id) include (claims_invalidos_apos);

create or replace function public.invalidar_claims(p_ids uuid[])
returns void
language sql
security definer
set search_path = public, pg_temp
as $$
  update public.usuarios
     set claims_invalidos_apos = now()
   where id = any(p_ids);
$$;

comment on function public.invalidar_claims(uuid[]) is
  'Marca os tokens dos usuarios como desatualizados. A proxima requisicao deles '
  'recebe 401 SESSAO_DESATUALIZADA e o cliente renova em silencio.';

-- --- Gatilhos: as quatro fontes dos claims -----------------------------------

/*
 * Mudança em `usuarios` que afeta o token: perfil (muda todo o mapa de
 * permissões), organização e o flag `ativo`.
 *
 * A guarda `is distinct from` é o que impede o efeito colateral bobo: sem ela,
 * qualquer `update` na linha — trocar o telefone — invalidaria a sessão da
 * pessoa e a faria renovar sem motivo.
 */
create or replace function public.gatilho_invalidar_claims_usuario()
returns trigger
language plpgsql
as $$
begin
  if new.id_perfil is distinct from old.id_perfil
     or new.id_organizacao is distinct from old.id_organizacao
     or new.ativo is distinct from old.ativo
  then
    new.claims_invalidos_apos := now();
  end if;
  return new;
end;
$$;

create trigger usuarios_invalidar_claims
  before update on public.usuarios
  for each row execute function public.gatilho_invalidar_claims_usuario();

/*
 * Mudança de permissão de um PERFIL atinge todo mundo que o usa.
 *
 * Um perfil tem poucos usuários numa campanha municipal, e a alternativa —
 * comparar permissões a cada requisição — custaria um join por chamada de API.
 */
create or replace function public.gatilho_invalidar_claims_perfil()
returns trigger
language plpgsql
as $$
declare
  v_id_perfil uuid := coalesce(new.id_perfil, old.id_perfil);
begin
  update public.usuarios
     set claims_invalidos_apos = now()
   where id_perfil = v_id_perfil;
  return coalesce(new, old);
end;
$$;

create trigger perfil_permissoes_invalidar_claims
  after insert or update or delete on public.perfil_permissoes
  for each row execute function public.gatilho_invalidar_claims_perfil();

/*
 * Campanhas e equipes: as duas listas que definem o que a pessoa alcança.
 *
 * Tirar alguém de uma equipe é justamente o caso em que esperar uma hora é
 * inaceitável — a lista de territórios do token ainda dá acesso aos domicílios
 * daquele bairro.
 */
create or replace function public.gatilho_invalidar_claims_vinculo()
returns trigger
language plpgsql
as $$
begin
  perform public.invalidar_claims(array[coalesce(new.id_usuario, old.id_usuario)]);
  return coalesce(new, old);
end;
$$;

create trigger usuario_campanhas_invalidar_claims
  after insert or update or delete on public.usuario_campanhas
  for each row execute function public.gatilho_invalidar_claims_vinculo();

create trigger equipe_membros_invalidar_claims
  after insert or update or delete on public.equipe_membros
  for each row execute function public.gatilho_invalidar_claims_vinculo();

-- --- Leitura pela API --------------------------------------------------------

/*
 * O guard consulta esta função antes de haver contexto de usuário — é ele quem
 * está decidindo se o contexto vale. Por isso `security definer` e uma função
 * dedicada, em vez de `select` direto na tabela: o pool da API conecta como
 * papel comum e seria barrado pelas políticas de `usuarios`.
 *
 * Devolve só o timestamp. Nada mais desta linha é assunto do guard.
 */
create or replace function public.claims_invalidos_apos(p_id_usuario uuid)
returns timestamptz
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select claims_invalidos_apos from public.usuarios where id = p_id_usuario;
$$;

comment on function public.claims_invalidos_apos(uuid) is
  'Consultada pelo guard da API antes de aceitar o token. SECURITY DEFINER '
  'porque nesse ponto ainda nao ha contexto de usuario — e ele quem esta '
  'decidindo se o contexto vale.';
