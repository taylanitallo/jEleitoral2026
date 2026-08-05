-- =============================================================================
-- 0030 — Entrevista concluída não pode ser alterada, só retificada
--
-- Pedido literal do usuário: "precisa ter um local onde estas entrevistas
-- sejam registradas, não podem ser alteradas, porém deve ter uma janela ou
-- aba onde fica o histórico daquela entrevista."
--
-- Hoje não existe NENHUM mecanismo de imutabilidade. A política de UPDATE em
-- `entrevistas` (0007) é permissiva para todo mundo com `campo.gerenciar`, e
-- as tabelas-filhas (`intencoes_voto`, `votos_domicilio`) têm política `for
-- all`, sem trigger nenhum. Um erro de digitação, hoje, é corrigido por cima —
-- sem rastro de que mudou, quando mudou, ou quem mudou.
--
-- O desenho: a cadeia de versões vive dentro de `public.entrevistas`, não numa
-- tabela separada. Uma tabela `entrevista_versoes` obrigaria a duplicar
-- `intencoes_voto`/`votos_domicilio` ou a congelar tudo em jsonb — e um
-- histórico em jsonb não se junta com `candidatos`, não entra na projeção, e
-- não passa no `construirRecorte`. Com a cadeia em `entrevistas`, cada versão
-- é uma entrevista de verdade, com intenções de verdade, e o histórico é uma
-- consulta, não um formato paralelo.
-- =============================================================================

-- --- A cadeia de versões -------------------------------------------------------

alter table public.entrevistas
  add column versao integer not null default 1 check (versao >= 1),
  add column id_entrevista_original uuid references public.entrevistas(id),
  add column id_entrevista_substituta uuid references public.entrevistas(id),
  add column vigente boolean not null default true,
  add column motivo_retificacao text,
  add column id_usuario_retificador uuid references public.usuarios(id),
  add constraint entrevistas_motivo_retificacao_check
    check (versao = 1 or (motivo_retificacao is not null and length(motivo_retificacao) >= 10));

/*
 * "Exatamente uma versão vigente por cadeia" é um FATO DO BANCO, não uma
 * esperança do service. `coalesce(id_entrevista_original, id)` identifica a
 * cadeia inteira: a primeira versão é a "original" de si mesma.
 */
create unique index entrevistas_vigente_idx
  on public.entrevistas (coalesce(id_entrevista_original, id)) where vigente;

create index entrevistas_cadeia_idx
  on public.entrevistas (id_organizacao, coalesce(id_entrevista_original, id), versao);

comment on column public.entrevistas.versao is
  'Número da versão dentro da cadeia de retificações. 1 é sempre o original.';
comment on column public.entrevistas.vigente is
  'Só a versão vigente entra em agregados. Use public.entrevistas_vigentes, '
  'nunca esta tabela direto, em qualquer consulta que soma ou conta.';

-- --- Imutabilidade -------------------------------------------------------------

/*
 * RASCUNHO libera tudo — é exatamente o que a sincronização offline precisa:
 * insere a entrevista como RASCUNHO, insere as intenções, e só então faz
 * `update entrevistas set status = ...`. Este trigger não pode quebrar essa
 * sequência, e não quebra.
 *
 * Concluída (CONCLUIDA/VALIDADA/INVALIDADA), só mudam: `status` (em transições
 * para frente), `vigente`, `id_entrevista_substituta`, `atualizado_em`.
 *
 * FALHA FECHADA por desenho: a comparação é por `to_jsonb(...) - array[...]`,
 * então uma coluna nova que alguém acrescentar amanhã já nasce imutável. Quem
 * quiser torná-la mutável precisa dizer isso em voz alta, aqui.
 */
create or replace function public.impedir_alteracao_entrevista()
returns trigger
language plpgsql
as $$
declare
  v_colunas_livres text[] := array['status', 'vigente', 'id_entrevista_substituta', 'atualizado_em'];
begin
  if old.status = 'RASCUNHO' then
    return new;
  end if;

  if new.status is distinct from old.status then
    if not (
      (old.status = 'CONCLUIDA' and new.status in ('VALIDADA', 'INVALIDADA'))
      or (old.status = 'VALIDADA' and new.status = 'INVALIDADA')
    ) then
      raise exception
        'Entrevista concluída não pode voltar de % para %.', old.status, new.status
        using errcode = 'check_violation';
    end if;
  end if;

  if (to_jsonb(old) - v_colunas_livres) is distinct from (to_jsonb(new) - v_colunas_livres) then
    raise exception
      'Entrevista concluída não pode ser alterada. Use a retificação — '
      'ela cria uma nova versão e preserva o original no histórico.'
      using errcode = 'check_violation';
  end if;

  return new;
end;
$$;

/*
 * ORDEM DOS TRIGGERS — dependência ALFABÉTICA, e por isso frágil. Comentado
 * nos dois lados.
 *
 *   entrevistas_atualizado_em (0001/0007) dispara PRIMEIRO ('a' < 'i') e já
 *   terá escrito new.atualizado_em = now() quando este trigger comparar — por
 *   isso `atualizado_em` está na lista de colunas livres. Sem essa ordem, TODO
 *   update seria recusado, inclusive o do sincronizador.
 *
 *   entrevistas_validar_conclusao (0007) dispara DEPOIS ('i' < 'v'): este
 *   trigger já aprovou a transição de status antes de a validação de
 *   consentimento/conteúdo rodar.
 */
create trigger entrevistas_impedir_alteracao
  before update on public.entrevistas
  for each row execute function public.impedir_alteracao_entrevista();

/*
 * Entrevista concluída não se apaga. `campanhas.controller.ts` já documenta
 * que encerrar campanha é desativar, nunca excluir — o cascade de
 * `organizacoes`/`campanhas` não é caminho real. Registrado como risco: se
 * algum dia existir expurgo de verdade, a rotina de retenção vai precisar de
 * um `set local` explícito para passar por aqui. Isso é bom: expurgo deve doer.
 */
create or replace function public.impedir_exclusao_entrevista()
returns trigger
language plpgsql
as $$
begin
  if old.status <> 'RASCUNHO' then
    raise exception 'Entrevista concluída não pode ser excluída.'
      using errcode = 'check_violation';
  end if;
  return old;
end;
$$;

create trigger entrevistas_impedir_exclusao
  before delete on public.entrevistas
  for each row execute function public.impedir_exclusao_entrevista();

/*
 * As filhas herdam a regra da entrevista-pai — INSERT incluído, e não só
 * UPDATE/DELETE. Sem cobrir INSERT, dava para contornar a imutabilidade
 * inteira inserindo uma intenção nova apontando para uma entrevista já
 * concluída, sem passar pela retificação.
 */
create or replace function public.impedir_alteracao_conteudo_entrevista()
returns trigger
language plpgsql
as $$
declare
  v_status public.status_entrevista;
  v_id_entrevista uuid := coalesce(new.id_entrevista, old.id_entrevista);
begin
  select status into v_status from public.entrevistas where id = v_id_entrevista;

  if v_status is not null and v_status <> 'RASCUNHO' then
    raise exception
      'Entrevista concluída não pode ter intenção de voto alterada diretamente. '
      'Use a retificação da entrevista.'
      using errcode = 'check_violation';
  end if;

  return coalesce(new, old);
end;
$$;

create trigger intencoes_impedir_alteracao
  before insert or update or delete on public.intencoes_voto
  for each row execute function public.impedir_alteracao_conteudo_entrevista();

create trigger votos_domicilio_impedir_alteracao
  before insert or update or delete on public.votos_domicilio
  for each row execute function public.impedir_alteracao_conteudo_entrevista();

-- --- RLS: a exceção precisa, e só ela ------------------------------------------

/*
 * A política de INSERT (0007) exige `id_usuario_entrevistador =
 * autenticacao.id_usuario()` — ninguém insere em nome de terceiro. Mas a
 * versão retificada PRECISA manter o entrevistador ORIGINAL: se o
 * coordenador que corrige o erro virasse o "entrevistador" da nova versão, o
 * relatório de produtividade creditaria o trabalho de campo a quem só
 * corrigiu um dado.
 *
 * A exceção é estreita: só vale quando a linha é comprovadamente uma
 * retificação (`id_entrevista_original is not null`) e quem está inserindo
 * tem a permissão nova `campo.retificar` no escopo do dono original.
 */
drop policy entrevistas_inserir on public.entrevistas;

create policy entrevistas_inserir on public.entrevistas for insert with check (
  autenticacao.pertence(id_organizacao, id_campanha)
  and autenticacao.escopo_de('campo.gerenciar') is not null
  and (
    id_usuario_entrevistador = autenticacao.id_usuario()
    or (
      id_entrevista_original is not null
      and autenticacao.visivel_no_escopo(
            'campo.retificar', id_usuario_entrevistador, id_equipe, null::uuid
          )
    )
  )
);

-- --- Leitura sem contagem dupla -------------------------------------------------

/*
 * A partir desta migration, uma entrevista retificada é DUAS linhas na
 * tabela base. Todo agregado que não filtrar `vigente` conta dobrado — e uma
 * projeção 10% acima da realidade no dia da apuração é o pior defeito
 * imaginável neste sistema.
 *
 * `security_invoker`: a view roda com os privilégios e a RLS de quem
 * consulta, não do dono da view — do contrário ela vazaria entre
 * organizações.
 */
create or replace view public.entrevistas_vigentes
with (security_invoker = true) as
select * from public.entrevistas where vigente;

comment on view public.entrevistas_vigentes is
  'Leitura padrão de entrevistas — só a versão VIGENTE de cada cadeia. Todo '
  'agregado (painel, relatórios, projeção, metas) usa esta view, nunca '
  'public.entrevistas direto, ou conta uma entrevista retificada em dobro. '
  'Exceção deliberada: a idempotência da sincronização offline '
  '(id_local_offline) continua na tabela base, porque a chave pode estar '
  'numa versão já superada.';
