-- =============================================================================
-- 0019 — Perfis-padrão saem do código e viram dado
--
-- `public.semear_perfis_organizacao` (0012) carrega a definição dos 7 perfis
-- num literal jsonb dentro do corpo da função. Isso funcionou enquanto o
-- catálogo de permissões era estável. Deixa de funcionar agora: os módulos de
-- mobilização, agenda, planejamento, diagnóstico e divulgação acrescentam
-- chaves, e cada um teria de REESCREVER a função inteira para incluir as suas.
--
-- Seis migrations reescrevendo o mesmo literal de 50 linhas é a receita
-- conhecida para uma delas copiar a versão errada e desfazer, em silêncio, o
-- que a anterior fez. O erro só apareceria quando alguém criasse uma
-- organização nova e ela nascesse sem metade das permissões.
--
-- Aqui a definição passa a ser DADO, em duas tabelas de catálogo. A função lê
-- delas. Cada módulo novo vira um `insert`, e nada precisa ser reescrito.
--
-- Isto NÃO muda o resultado para nenhuma organização existente: as tabelas
-- nascem com exatamente a definição que estava no jsonb.
-- =============================================================================

create table public.perfis_padrao (
  nome text primary key,
  descricao text not null,
  /*
   * Preenchido só para o ADMINISTRADOR, que tinha `{"*": "CAMPANHA"}` no jsonb.
   * Guardar o curinga como coluna, em vez de expandir as chaves numa migration,
   * preserva a semântica: o administrador ganha as permissões que existirem no
   * catálogo NO MOMENTO da criação da organização, inclusive as que módulos
   * futuros acrescentarem. Expandir agora congelaria a lista de hoje.
   */
  escopo_todas_permissoes autenticacao.escopo_permissao,
  ordem smallint not null default 100
);

create table public.perfil_permissao_padrao (
  perfil text not null references public.perfis_padrao(nome) on delete cascade,
  chave_permissao text not null references public.permissoes(chave) on delete cascade,
  escopo autenticacao.escopo_permissao not null,
  primary key (perfil, chave_permissao)
);

create index perfil_permissao_padrao_chave_idx
  on public.perfil_permissao_padrao (chave_permissao);

select autenticacao.aplicar_rls_referencia('perfis_padrao');
select autenticacao.aplicar_rls_referencia('perfil_permissao_padrao');

-- --- A definição que estava no jsonb -----------------------------------------

insert into public.perfis_padrao (nome, descricao, escopo_todas_permissoes, ordem) values
  ('ADMINISTRADOR', 'Acesso total à organização e às campanhas', 'CAMPANHA', 10),
  ('COORDENADOR',   'Coordena equipes e território',              null,       20),
  ('MOBILIZADOR',   'Trabalha um território designado',           null,       30),
  ('ENTREVISTADOR', 'Coleta em campo; vê apenas o que registrou', null,       40),
  ('ANALISTA',      'Leitura ampla para análise, sem coleta',     null,       50),
  ('FINANCEIRO',    'Controle financeiro da campanha',            null,       60),
  ('CANDIDATO',     'Somente leitura dos painéis',                null,       70);

insert into public.perfil_permissao_padrao (perfil, chave_permissao, escopo) values
  ('COORDENADOR', 'usuarios.ler', 'EQUIPE'),
  ('COORDENADOR', 'equipes.ler', 'EQUIPE'),
  ('COORDENADOR', 'equipes.gerenciar', 'EQUIPE'),
  ('COORDENADOR', 'territorio.ler', 'CAMPANHA'),
  ('COORDENADOR', 'territorio.gerenciar', 'CAMPANHA'),
  ('COORDENADOR', 'candidatos.ler', 'CAMPANHA'),
  ('COORDENADOR', 'campo.ler', 'EQUIPE'),
  ('COORDENADOR', 'campo.gerenciar', 'EQUIPE'),
  ('COORDENADOR', 'qualidade.ler', 'EQUIPE'),
  ('COORDENADOR', 'qualidade.gerenciar', 'EQUIPE'),
  ('COORDENADOR', 'metas.ler', 'CAMPANHA'),
  ('COORDENADOR', 'metas.gerenciar', 'EQUIPE'),
  ('COORDENADOR', 'projecao.ler', 'CAMPANHA'),
  ('COORDENADOR', 'artes.ler', 'CAMPANHA'),
  ('COORDENADOR', 'relatorios.exportar', 'EQUIPE'),
  ('COORDENADOR', 'ia.usar', 'EQUIPE'),

  ('MOBILIZADOR', 'territorio.ler', 'TERRITORIO'),
  ('MOBILIZADOR', 'territorio.gerenciar', 'TERRITORIO'),
  ('MOBILIZADOR', 'candidatos.ler', 'CAMPANHA'),
  ('MOBILIZADOR', 'campo.ler', 'TERRITORIO'),
  ('MOBILIZADOR', 'campo.gerenciar', 'TERRITORIO'),
  ('MOBILIZADOR', 'metas.ler', 'TERRITORIO'),
  ('MOBILIZADOR', 'projecao.ler', 'TERRITORIO'),
  ('MOBILIZADOR', 'artes.ler', 'CAMPANHA'),
  ('MOBILIZADOR', 'relatorios.exportar', 'TERRITORIO'),

  ('ENTREVISTADOR', 'territorio.ler', 'TERRITORIO'),
  ('ENTREVISTADOR', 'territorio.gerenciar', 'PROPRIO'),
  ('ENTREVISTADOR', 'candidatos.ler', 'CAMPANHA'),
  ('ENTREVISTADOR', 'campo.ler', 'PROPRIO'),
  ('ENTREVISTADOR', 'campo.gerenciar', 'PROPRIO'),
  ('ENTREVISTADOR', 'artes.ler', 'CAMPANHA'),

  ('ANALISTA', 'territorio.ler', 'CAMPANHA'),
  ('ANALISTA', 'candidatos.ler', 'CAMPANHA'),
  ('ANALISTA', 'campo.ler', 'CAMPANHA'),
  ('ANALISTA', 'qualidade.ler', 'CAMPANHA'),
  ('ANALISTA', 'metas.ler', 'CAMPANHA'),
  ('ANALISTA', 'projecao.ler', 'CAMPANHA'),
  ('ANALISTA', 'projecao.gerenciar', 'CAMPANHA'),
  ('ANALISTA', 'relatorios.exportar', 'CAMPANHA'),
  ('ANALISTA', 'ia.usar', 'CAMPANHA'),

  ('FINANCEIRO', 'financeiro.ler', 'CAMPANHA'),
  ('FINANCEIRO', 'financeiro.gerenciar', 'CAMPANHA'),
  ('FINANCEIRO', 'relatorios.exportar', 'CAMPANHA'),
  ('FINANCEIRO', 'projecao.ler', 'CAMPANHA'),

  ('CANDIDATO', 'campo.ler', 'CAMPANHA'),
  ('CANDIDATO', 'metas.ler', 'CAMPANHA'),
  ('CANDIDATO', 'projecao.ler', 'CAMPANHA'),
  ('CANDIDATO', 'financeiro.ler', 'CAMPANHA'),
  ('CANDIDATO', 'artes.ler', 'CAMPANHA'),
  ('CANDIDATO', 'relatorios.exportar', 'CAMPANHA');

-- --- A função passa a ler das tabelas ----------------------------------------

create or replace function public.semear_perfis_organizacao(p_id_organizacao uuid)
returns void
language plpgsql
security definer
set search_path = public, autenticacao, pg_temp
as $$
declare
  v_perfil record;
  v_id_perfil uuid;
begin
  for v_perfil in
    select nome, descricao, escopo_todas_permissoes
      from public.perfis_padrao
     order by ordem
  loop
    insert into public.perfis_acesso (id_organizacao, nome, descricao, sistema_padrao)
    values (p_id_organizacao, v_perfil.nome, v_perfil.descricao, true)
    on conflict (id_organizacao, nome) do update set descricao = excluded.descricao
    returning id into v_id_perfil;

    if v_perfil.escopo_todas_permissoes is not null then
      -- Curinga: tudo o que existir no catálogo, no escopo indicado.
      insert into public.perfil_permissoes (id_perfil, id_permissao, escopo)
      select v_id_perfil, p.id, v_perfil.escopo_todas_permissoes
        from public.permissoes p
      on conflict (id_perfil, id_permissao) do update set escopo = excluded.escopo;
    else
      insert into public.perfil_permissoes (id_perfil, id_permissao, escopo)
      select v_id_perfil, p.id, d.escopo
        from public.perfil_permissao_padrao d
        join public.permissoes p on p.chave = d.chave_permissao
       where d.perfil = v_perfil.nome
      on conflict (id_perfil, id_permissao) do update set escopo = excluded.escopo;
    end if;
  end loop;
end;
$$;

comment on function public.semear_perfis_organizacao(uuid) is
  'Cria os perfis-padrão de uma organização a partir de public.perfis_padrao e '
  'public.perfil_permissao_padrao. ATENÇÃO: o `on conflict do update set escopo` '
  'sobrescreve escopos customizados — não a chame para backfill de módulo novo; '
  'use insert dirigido com `do nothing`.';

-- --- Função de apoio para os módulos novos -----------------------------------

/*
 * Aplica UMA permissão nova aos perfis-padrão de TODAS as organizações que já
 * existem, sem tocar no que já está lá.
 *
 * A alternativa — rechamar `semear_perfis_organizacao` — desfaria em silêncio
 * qualquer escopo que um administrador tenha ajustado à mão, porque aquela
 * função usa `do update set escopo`. Esta usa `do nothing` e mexe só na chave
 * indicada.
 */
create or replace function public.conceder_permissao_padrao(
  p_perfil text,
  p_chave text,
  p_escopo autenticacao.escopo_permissao
)
returns void
language plpgsql
security definer
set search_path = public, autenticacao, pg_temp
as $$
begin
  -- Registra no catálogo, para organizações futuras.
  insert into public.perfil_permissao_padrao (perfil, chave_permissao, escopo)
  values (p_perfil, p_chave, p_escopo)
  on conflict (perfil, chave_permissao) do update set escopo = excluded.escopo;

  -- Aplica nas organizações existentes, preservando customizações.
  insert into public.perfil_permissoes (id_perfil, id_permissao, escopo)
  select pa.id, pe.id, p_escopo
    from public.perfis_acesso pa
    join public.permissoes pe on pe.chave = p_chave
   where pa.sistema_padrao and pa.nome = p_perfil
  on conflict (id_perfil, id_permissao) do nothing;
end;
$$;

comment on function public.conceder_permissao_padrao(text, text, autenticacao.escopo_permissao) is
  'Registra uma permissão no catálogo de perfis-padrão E a aplica às organizações '
  'existentes com `do nothing`, preservando escopos customizados. É o caminho que '
  'toda migration de módulo novo deve usar.';
