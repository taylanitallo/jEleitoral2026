-- =============================================================================
-- 0012 — Catálogo de permissões e semente de perfis
--
-- Permissões são DADOS, não código: o administrador da organização pode criar
-- perfis novos e remanejar escopos sem que ninguém faça deploy. O que este
-- arquivo entrega é o conjunto inicial, aplicado a cada organização criada.
-- =============================================================================

insert into public.permissoes (chave, modulo, descricao) values
  ('organizacao.alterar',   'Organização', 'Alterar dados e identidade visual da organização'),
  ('campanhas.gerenciar',   'Organização', 'Criar, editar e encerrar campanhas'),
  ('usuarios.ler',          'Acesso',      'Consultar usuários'),
  ('usuarios.gerenciar',    'Acesso',      'Convidar, editar e desativar usuários'),
  ('perfis.gerenciar',      'Acesso',      'Criar perfis e definir permissões'),
  ('equipes.ler',           'Acesso',      'Consultar equipes'),
  ('equipes.gerenciar',     'Acesso',      'Criar e editar equipes e seus membros'),
  ('suporte.autorizar',     'Acesso',      'Autorizar acesso temporário do suporte da Jeos'),
  ('auditoria.ler',         'Acesso',      'Consultar a trilha de auditoria'),
  ('territorio.ler',        'Território',  'Consultar bairros, logradouros e localidades'),
  ('territorio.gerenciar',  'Território',  'Cadastrar, validar e mesclar registros territoriais'),
  ('candidatos.ler',        'Candidatos',  'Consultar candidatos próprios e concorrentes'),
  ('candidatos.gerenciar',  'Candidatos',  'Cadastrar candidatos e decidir mesclagens'),
  ('campo.ler',             'Campo',       'Consultar domicílios, entrevistados e entrevistas'),
  ('campo.gerenciar',       'Campo',       'Registrar e editar coleta de campo'),
  ('qualidade.ler',         'Campo',       'Consultar o painel de qualidade da coleta'),
  ('qualidade.gerenciar',   'Campo',       'Revisar e classificar alertas de coleta'),
  ('metas.ler',             'Metas',       'Consultar metas e atingimento'),
  ('metas.gerenciar',       'Metas',       'Definir e ajustar metas'),
  ('projecao.ler',          'Projeção',    'Consultar projeções e cobertura amostral'),
  ('projecao.gerenciar',    'Projeção',    'Recalcular projeções e ajustar parâmetros'),
  ('financeiro.ler',        'Financeiro',  'Consultar lançamentos e orçamentos'),
  ('financeiro.gerenciar',  'Financeiro',  'Registrar lançamentos e orçamentos'),
  ('artes.ler',             'Artes',       'Consultar e baixar material gráfico'),
  ('artes.gerenciar',       'Artes',       'Publicar e versionar material gráfico'),
  ('relatorios.exportar',   'Relatórios',  'Exportar em PDF, Excel e imprimir'),
  ('integracoes.executar',  'Integrações', 'Disparar sincronizações com IBGE, TSE e CEP'),
  ('ia.usar',               'IA',          'Usar diagnóstico, revisão de texto e consulta assistida')
on conflict (chave) do nothing;

/**
 * Cria os perfis-semente de uma organização com escopos coerentes.
 *
 * O desenho dos escopos é o que materializa "nenhum usuário vê o dado do
 * outro":
 *   ENTREVISTADOR → PROPRIO    (só a coleta que ele mesmo fez)
 *   MOBILIZADOR   → TERRITORIO (o território designado)
 *   COORDENADOR   → EQUIPE     (a equipe que coordena)
 *   ANALISTA      → CAMPANHA   (leitura ampla, sem escrita em campo)
 *   ADMINISTRADOR → CAMPANHA   (tudo)
 *   FINANCEIRO    → CAMPANHA   (só o módulo financeiro)
 *   CANDIDATO     → CAMPANHA   (somente leitura de painéis)
 */
create or replace function public.semear_perfis_organizacao(p_id_organizacao uuid)
returns void
language plpgsql
security definer
set search_path = public, autenticacao, pg_temp
as $$
declare
  v_id_perfil uuid;
  v_definicao jsonb := '[
    {"nome": "ADMINISTRADOR", "descricao": "Acesso total à organização e às campanhas",
     "permissoes": {"*": "CAMPANHA"}},
    {"nome": "COORDENADOR", "descricao": "Coordena equipes e território",
     "permissoes": {
       "usuarios.ler": "EQUIPE", "equipes.ler": "EQUIPE", "equipes.gerenciar": "EQUIPE",
       "territorio.ler": "CAMPANHA", "territorio.gerenciar": "CAMPANHA",
       "candidatos.ler": "CAMPANHA",
       "campo.ler": "EQUIPE", "campo.gerenciar": "EQUIPE",
       "qualidade.ler": "EQUIPE", "qualidade.gerenciar": "EQUIPE",
       "metas.ler": "CAMPANHA", "metas.gerenciar": "EQUIPE",
       "projecao.ler": "CAMPANHA", "artes.ler": "CAMPANHA",
       "relatorios.exportar": "EQUIPE", "ia.usar": "EQUIPE"
     }},
    {"nome": "MOBILIZADOR", "descricao": "Trabalha um território designado",
     "permissoes": {
       "territorio.ler": "TERRITORIO", "territorio.gerenciar": "TERRITORIO",
       "candidatos.ler": "CAMPANHA",
       "campo.ler": "TERRITORIO", "campo.gerenciar": "TERRITORIO",
       "metas.ler": "TERRITORIO", "projecao.ler": "TERRITORIO",
       "artes.ler": "CAMPANHA", "relatorios.exportar": "TERRITORIO"
     }},
    {"nome": "ENTREVISTADOR", "descricao": "Coleta em campo; vê apenas o que registrou",
     "permissoes": {
       "territorio.ler": "TERRITORIO", "territorio.gerenciar": "PROPRIO",
       "candidatos.ler": "CAMPANHA",
       "campo.ler": "PROPRIO", "campo.gerenciar": "PROPRIO",
       "artes.ler": "CAMPANHA"
     }},
    {"nome": "ANALISTA", "descricao": "Leitura ampla para análise, sem coleta",
     "permissoes": {
       "territorio.ler": "CAMPANHA", "candidatos.ler": "CAMPANHA",
       "campo.ler": "CAMPANHA", "qualidade.ler": "CAMPANHA",
       "metas.ler": "CAMPANHA", "projecao.ler": "CAMPANHA",
       "projecao.gerenciar": "CAMPANHA",
       "relatorios.exportar": "CAMPANHA", "ia.usar": "CAMPANHA"
     }},
    {"nome": "FINANCEIRO", "descricao": "Controle financeiro da campanha",
     "permissoes": {
       "financeiro.ler": "CAMPANHA", "financeiro.gerenciar": "CAMPANHA",
       "relatorios.exportar": "CAMPANHA", "projecao.ler": "CAMPANHA"
     }},
    {"nome": "CANDIDATO", "descricao": "Somente leitura dos painéis",
     "permissoes": {
       "campo.ler": "CAMPANHA", "metas.ler": "CAMPANHA", "projecao.ler": "CAMPANHA",
       "financeiro.ler": "CAMPANHA", "artes.ler": "CAMPANHA",
       "relatorios.exportar": "CAMPANHA"
     }}
  ]'::jsonb;
  v_perfil jsonb;
  v_chave text;
  v_escopo text;
begin
  for v_perfil in select * from jsonb_array_elements(v_definicao)
  loop
    insert into public.perfis_acesso (id_organizacao, nome, descricao, sistema_padrao)
    values (p_id_organizacao, v_perfil ->> 'nome', v_perfil ->> 'descricao', true)
    on conflict (id_organizacao, nome) do update set descricao = excluded.descricao
    returning id into v_id_perfil;

    -- "*" significa todas as permissões do catálogo no escopo indicado.
    if v_perfil -> 'permissoes' ? '*' then
      insert into public.perfil_permissoes (id_perfil, id_permissao, escopo)
      select v_id_perfil, p.id, (v_perfil -> 'permissoes' ->> '*')::autenticacao.escopo_permissao
      from public.permissoes p
      on conflict (id_perfil, id_permissao) do update set escopo = excluded.escopo;
    else
      for v_chave, v_escopo in
        select chave, valor from jsonb_each_text(v_perfil -> 'permissoes') as e(chave, valor)
      loop
        insert into public.perfil_permissoes (id_perfil, id_permissao, escopo)
        select v_id_perfil, p.id, v_escopo::autenticacao.escopo_permissao
        from public.permissoes p where p.chave = v_chave
        on conflict (id_perfil, id_permissao) do update set escopo = excluded.escopo;
      end loop;
    end if;
  end loop;
end;
$$;

comment on function public.semear_perfis_organizacao(uuid) is
  'Cria os sete perfis-semente da organização. Idempotente: reexecutar após adicionar '
  'permissões novas ao catálogo atualiza os perfis-padrão sem apagar customizações de nome.';

-- --- Planos iniciais ---------------------------------------------------------

insert into public.planos
  (nome, limite_usuarios, limite_entrevistas_mes, limite_armazenamento_mb, limite_creditos_ia, valor_mensal)
values
  ('Essencial',  10,   5000,   2048,  50000, 490.00),
  ('Campanha',   50,  50000,  10240, 250000, 1490.00),
  ('Estadual',  200, 300000,  51200, 1000000, 3990.00)
on conflict (nome) do nothing;
