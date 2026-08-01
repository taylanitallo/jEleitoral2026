-- =============================================================================
-- 0014 — Custom Access Token Hook
--
-- Esta função é a peça que faltava para o sistema funcionar. Sem ela o JWT sai
-- sem `id_organizacao`, `campanhas` e `permissoes`, e **toda política RLS nega
-- tudo** — o padrão seguro, mas o sistema inteiro fica inerte.
--
-- Ela roda dentro do Supabase Auth, a cada emissão de token, e injeta os claims
-- que as políticas leem. Precisa ser registrada no painel em
-- Authentication → Hooks → Customize Access Token (JWT) Claims.
--
-- Consequência operacional que vale conhecer: como as permissões viajam no
-- token, **alterar um perfil só passa a valer no próximo token do usuário**.
-- Quem salva um perfil precisa revogar as sessões afetadas.
-- =============================================================================

create or replace function public.hook_token_acesso(evento jsonb)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, autenticacao, pg_temp
as $$
declare
  v_id_usuario uuid;
  v_claims jsonb;
  v_usuario record;
  v_campanhas uuid[];
  v_equipes uuid[];
  v_territorios uuid[];
  v_permissoes jsonb;
begin
  v_id_usuario := (evento ->> 'user_id')::uuid;
  v_claims := coalesce(evento -> 'claims', '{}'::jsonb);

  select u.id_organizacao, u.id_perfil, u.ativo, p.nome as perfil
    into v_usuario
    from public.usuarios u
    join public.perfis_acesso p on p.id = u.id_perfil
   where u.id = v_id_usuario;

  -- Usuário do backoffice da Jeos: não pertence a organização nenhuma, e por
  -- isso falha em todas as políticas de dados de campo — que é o desejado.
  if v_usuario is null then
    select jsonb_build_object('perfil_provedor', pu.perfil)
      into v_permissoes
      from provedor.usuarios pu
     where pu.id = v_id_usuario and pu.ativo;

    if v_permissoes is not null then
      return jsonb_set(evento, '{claims}', v_claims || v_permissoes);
    end if;

    -- Nem usuário de organização, nem do provedor: token sem claim algum.
    -- Autentica, mas não enxerga nada.
    return evento;
  end if;

  -- Usuário desativado recebe token sem claims: a sessão existente perde acesso
  -- na próxima renovação, sem precisar de expurgo manual.
  if not v_usuario.ativo then
    return evento;
  end if;

  select coalesce(array_agg(distinct uc.id_campanha), array[]::uuid[])
    into v_campanhas
    from public.usuario_campanhas uc
   where uc.id_usuario = v_id_usuario;

  select coalesce(array_agg(distinct em.id_equipe), array[]::uuid[])
    into v_equipes
    from public.equipe_membros em
   where em.id_usuario = v_id_usuario;

  -- Territórios designados: os bairros das equipes de que o usuário participa.
  select coalesce(array_agg(distinct sb.id_bairro), array[]::uuid[])
    into v_territorios
    from public.equipe_membros em
    join public.equipes e on e.id = em.id_equipe
    join public.secao_bairros sb on sb.id_campanha = e.id_campanha
   where em.id_usuario = v_id_usuario;

  -- Mapa {chave: escopo}. É o que `autenticacao.escopo_de()` consulta — ela lê
  -- do token justamente para não consultar tabela de dentro de uma política e
  -- entrar em recursão.
  select coalesce(jsonb_object_agg(pe.chave, pp.escopo), '{}'::jsonb)
    into v_permissoes
    from public.perfil_permissoes pp
    join public.permissoes pe on pe.id = pp.id_permissao
   where pp.id_perfil = v_usuario.id_perfil;

  return jsonb_set(
    evento,
    '{claims}',
    v_claims || jsonb_build_object(
      'id_organizacao', v_usuario.id_organizacao,
      'id_perfil', v_usuario.id_perfil,
      'perfil', v_usuario.perfil,
      'campanhas', to_jsonb(v_campanhas),
      'equipes', to_jsonb(v_equipes),
      'territorios', to_jsonb(v_territorios),
      'permissoes', v_permissoes
    )
  );
end;
$$;

comment on function public.hook_token_acesso(jsonb) is
  'Custom Access Token Hook do Supabase Auth. Injeta id_organizacao, campanhas, '
  'equipes, territorios e permissoes no JWT. Sem ele, toda política RLS nega tudo.';

-- O Auth do Supabase executa o hook com o papel `supabase_auth_admin`.
grant execute on function public.hook_token_acesso(jsonb) to supabase_auth_admin;
revoke execute on function public.hook_token_acesso(jsonb) from authenticated, anon, public;

-- Leitura estritamente necessária para o hook montar os claims.
grant usage on schema public, provedor to supabase_auth_admin;
grant select on
  public.usuarios, public.perfis_acesso, public.perfil_permissoes, public.permissoes,
  public.usuario_campanhas, public.equipe_membros, public.equipes, public.secao_bairros,
  provedor.usuarios
  to supabase_auth_admin;

-- O hook roda como `supabase_auth_admin`, que não é dono das tabelas e seria
-- barrado pelas políticas. Estas políticas dão a ele — e só a ele — a leitura
-- necessária.
do $$
declare
  tabela text;
begin
  foreach tabela in array array[
    'usuarios', 'perfis_acesso', 'perfil_permissoes',
    'usuario_campanhas', 'equipe_membros', 'equipes', 'secao_bairros'
  ]
  loop
    execute format(
      'create policy %I on public.%I for select to supabase_auth_admin using (true)',
      tabela || '_hook_token', tabela
    );
  end loop;
end;
$$;
