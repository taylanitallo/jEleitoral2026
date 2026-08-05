-- =============================================================================
-- 0028 — Resolver a intenção de voto e começar a série de projeção
--
-- Esta migration conserta o defeito mais grave do sistema, e ele era invisível:
-- **a intenção de voto nunca virava candidato.**
--
-- O formulário grava `numero_declarado` (0007:205), a sincronização grava
-- `id_candidato = null`, e a projeção filtra `where i.id_candidato = $2`. Nada,
-- em lugar nenhum do repositório, resolvia um para o outro — `numero_declarado`
-- aparecia em exatamente dois pontos: a definição da coluna e o INSERT.
--
-- Consequência: **toda projeção por candidato devolvia zero**, para toda a
-- campanha, desde sempre. A coleta de campo entrava no banco e não chegava a
-- lugar nenhum. Não havia erro, não havia log; só um número errado.
--
-- A segunda metade da migration cria `projecoes_diarias`. Ela precisa entrar
-- AGORA, mesmo sem tela que a leia: série temporal só se acumula em tempo real,
-- e o pleito é em 04/10/2026. Um gráfico de tendência criado em setembro com uma
-- semana de história não serve para nada, e não há como recuperar o passado.
-- =============================================================================

-- --- Natureza do que o eleitor declarou --------------------------------------

/*
 * `NAO_CADASTRADO` não é lixo, e não pode ser tratado como erro.
 *
 * É o número que o eleitor declarou e que não casa com nenhum candidato ativo
 * da campanha — quase sempre um concorrente que ninguém cadastrou ainda.
 * Descartá-lo perderia o sinal mais valioso que a coleta produz: "todo mundo no
 * bairro X fala um número que não está no nosso cadastro". Guardado, vira fila
 * de curadoria.
 */
create type public.tipo_intencao as enum (
  'CANDIDATO',       -- resolvido para um candidato cadastrado
  'BRANCO',
  'NULO',
  'INDECISO',        -- ainda não decidiu
  'NAO_RESPONDEU',   -- não quis dizer, ou o campo ficou vazio
  'NAO_CADASTRADO'   -- número declarado sem candidato correspondente
);

alter table public.intencoes_voto
  add column tipo public.tipo_intencao not null default 'NAO_RESPONDEU',
  -- Distingue "resolvido na gravação" de "resolvido no backfill". A auditoria
  -- precisa saber que a linha de agosto só ganhou candidato em setembro.
  add column resolvido_em timestamptz;

/*
 * `votos_domicilio` ganha `numero_declarado` junto.
 *
 * Ela não tinha a coluna, e sem ela a mesma função de resolução não serviria
 * para as duas tabelas — sobrariam duas funções que divergem no primeiro ajuste.
 * A necessidade também é real: "aqui em casa três pessoas votam no 13" é uma
 * declaração por número, exatamente como a intenção individual.
 */
alter table public.votos_domicilio
  add column numero_declarado text,
  add column tipo public.tipo_intencao not null default 'NAO_RESPONDEU',
  add column resolvido_em timestamptz;

comment on column public.intencoes_voto.tipo is
  'Natureza do voto declarado. NAO_CADASTRADO e numero sem candidato correspondente '
  '— concorrente ainda nao cadastrado, nao lixo.';

-- --- A resolução -------------------------------------------------------------

/*
 * Resolve `numero_declarado` para `id_candidato`.
 *
 * **No banco, e não no service.** Hoje existe uma via de escrita
 * (`sincronizacaoOffline.service.ts`) e vão existir três — a retificação e um
 * importador. Regra que mora no service é regra que a próxima via esquece. É o
 * mesmo argumento que `validar_conclusao_entrevista` já usa nesta base.
 *
 * O `select` em `candidatos` roda sob a RLS do usuário. Conferi que os perfis
 * que coletam têm `candidatos.ler` com escopo CAMPANHA — ENTREVISTADOR
 * inclusive. Se algum dia alguém tirar essa permissão de um perfil de coleta,
 * todo voto dele passa a ser NAO_CADASTRADO em silêncio; daí o teste de
 * integração que acompanha esta migration.
 */
create or replace function public.resolver_candidato_da_intencao()
returns trigger
language plpgsql
as $$
declare
  v_numero text;
  v_id_candidato uuid;
begin
  -- 1. Candidato veio explícito: confia, e completa o número para o histórico.
  if new.id_candidato is not null then
    new.tipo := 'CANDIDATO';
    if new.numero_declarado is null or new.numero_declarado = '' then
      select c.numero_urna into new.numero_declarado
        from public.candidatos c where c.id = new.id_candidato;
    end if;
    new.resolvido_em := now();
    return new;
  end if;

  /*
   * 2. Branco, nulo e indeciso são declarações de propósito e não resolvem.
   *
   * `NAO_RESPONDEU` está FORA desta lista, e a razão é o default da coluna:
   * quem insere só o número não informa `tipo`, e a linha chega aqui já com
   * `NAO_RESPONDEU`. Incluí-lo aqui zerava o número antes de tentar resolvê-lo
   * — ou seja, exatamente o defeito que esta migration existe para consertar,
   * reproduzido dentro da correção. Pego pelo teste de integração na primeira
   * execução; sem ele teria ido para produção parecendo resolvido.
   */
  if new.tipo in ('BRANCO', 'NULO', 'INDECISO') then
    new.id_candidato := null;
    new.numero_declarado := null;
    new.resolvido_em := now();
    return new;
  end if;

  -- 3. Só o número. Normaliza e procura.
  v_numero := nullif(regexp_replace(coalesce(new.numero_declarado, ''), '\D', '', 'g'), '');

  if v_numero is null then
    new.tipo := 'NAO_RESPONDEU';
    new.resolvido_em := now();
    return new;
  end if;

  -- O índice único parcial `candidatos_numero_idx` (0006:90) garante no máximo
  -- uma linha ativa por (campanha, cargo, número).
  select c.id into v_id_candidato
    from public.candidatos c
   where c.id_campanha = new.id_campanha
     and c.id_cargo = new.id_cargo
     and c.numero_urna = v_numero
     and c.ativo;

  new.numero_declarado := v_numero;
  if v_id_candidato is not null then
    new.id_candidato := v_id_candidato;
    new.tipo := 'CANDIDATO';
  else
    -- Número preservado. É concorrente a cadastrar, não erro a descartar.
    new.tipo := 'NAO_CADASTRADO';
  end if;
  new.resolvido_em := now();
  return new;
end;
$$;

/*
 * ORDEM DOS TRIGGERS — NÃO RENOMEAR.
 *
 * O PostgreSQL dispara triggers BEFORE na ordem ALFABÉTICA do nome. Precisamos
 * de `intencoes_resolver_candidato` ANTES de `intencoes_validar_quantidade`
 * (0007:367), e 'r' < 'v' garante isso. Renomear este trigger para algo depois
 * de "validar" faria a validação de quantidade rodar sobre dado não resolvido.
 */
create trigger intencoes_resolver_candidato
  before insert or update on public.intencoes_voto
  for each row execute function public.resolver_candidato_da_intencao();

create trigger votos_domicilio_resolver_candidato
  before insert or update on public.votos_domicilio
  for each row execute function public.resolver_candidato_da_intencao();

-- --- Integridade que faltava --------------------------------------------------

/*
 * Os dois votos de Senador não podem ir para o mesmo candidato.
 *
 * Hoje nada impede, e o efeito é direto: a projeção daquele senador infla em
 * 100%. `validar_quantidade_intencoes` (0007:339) limita a QUANTIDADE de linhas
 * por cargo, não a repetição do candidato.
 */
create unique index intencoes_candidato_unico_idx
  on public.intencoes_voto (id_entrevista, id_cargo, id_candidato)
  where id_candidato is not null;

-- --- Backfill do que já foi coletado -----------------------------------------

/*
 * `no force` é OBRIGATÓRIO aqui, e a razão é traiçoeira.
 *
 * As políticas de `intencoes_voto` chamam `autenticacao.pertence(...)`, que lê o
 * JWT. Durante a migration não há JWT: com `force row level security` ativo, o
 * UPDATE encontraria zero linhas e **passaria em silêncio**, sem erro, sem aviso,
 * e o backfill não teria feito nada. Re-forçamos na mesma transação; se alguém
 * esquecer, `test:rls` quebra o build — que é o comportamento desejado.
 */
alter table public.intencoes_voto no force row level security;
alter table public.votos_domicilio no force row level security;

update public.intencoes_voto i
   set id_candidato = c.id,
       tipo = 'CANDIDATO',
       numero_declarado = c.numero_urna,
       resolvido_em = now()
  from public.candidatos c
 where i.id_candidato is null
   and c.id_campanha = i.id_campanha
   and c.id_cargo = i.id_cargo
   and c.ativo
   and c.numero_urna = nullif(regexp_replace(coalesce(i.numero_declarado, ''), '\D', '', 'g'), '');

update public.intencoes_voto
   set tipo = (case
                when nullif(regexp_replace(coalesce(numero_declarado, ''), '\D', '', 'g'), '') is null
                  then 'NAO_RESPONDEU'
                else 'NAO_CADASTRADO'
              end)::public.tipo_intencao,
       resolvido_em = now()
 where resolvido_em is null;

update public.votos_domicilio v
   set id_candidato = c.id, tipo = 'CANDIDATO', resolvido_em = now()
  from public.candidatos c
 where v.id_candidato is null
   and c.id_campanha = v.id_campanha
   and c.id_cargo = v.id_cargo
   and c.ativo
   and c.numero_urna = nullif(regexp_replace(coalesce(v.numero_declarado, ''), '\D', '', 'g'), '');

update public.votos_domicilio
   set tipo = (case when id_candidato is not null then 'CANDIDATO' else 'NAO_CADASTRADO' end)
              ::public.tipo_intencao,
       resolvido_em = now()
 where resolvido_em is null;

alter table public.intencoes_voto force row level security;
alter table public.votos_domicilio force row level security;

-- --- Série temporal da projeção ----------------------------------------------

/*
 * `projecoes` continua sendo o AGORA; esta tabela é a LINHA DO TEMPO.
 *
 * O UPSERT de `projecoes` (unique em campanha+candidato+nível+referência)
 * sobrescreve o valor anterior a cada recálculo, e isso está certo para o estado
 * corrente — mas apaga a história. Sem história não há gráfico de tendência, e
 * tendência é o que o coordenador usa para saber se a campanha está subindo.
 *
 * Sem SECAO de propósito: 300 seções × 6 candidatos × 60 dias são 108 mil linhas
 * para um gráfico que ninguém desenha por seção. Bairro, zona e município
 * resolvem a tendência com cerca de mil.
 */
create table public.projecoes_diarias (
  id uuid primary key default gen_random_uuid(),
  id_organizacao uuid not null references public.organizacoes(id) on delete cascade,
  id_campanha uuid not null references public.campanhas(id) on delete cascade,
  id_cargo uuid not null references public.cargos(id),
  id_candidato uuid not null references public.candidatos(id) on delete cascade,

  nivel public.nivel_territorial not null,
  id_referencia text not null,
  data_referencia date not null,

  votos_projetados numeric(12,2) not null,
  intervalo_min numeric(12,2) not null,
  intervalo_max numeric(12,2) not null,
  indice_confianca numeric(5,4) not null,
  cobertura_amostral numeric(5,4) not null,
  eleitorado_base integer not null,
  amostra_tamanho integer not null,
  metodo public.metodo_projecao not null,

  criado_em timestamptz not null default now(),

  unique (id_campanha, id_candidato, nivel, id_referencia, data_referencia),
  constraint projecoes_diarias_sem_secao_check check (nivel <> 'SECAO')
);

create index projecoes_diarias_serie_idx
  on public.projecoes_diarias (id_organizacao, id_campanha, id_candidato, nivel, data_referencia);

create index projecoes_diarias_dia_idx
  on public.projecoes_diarias (id_organizacao, id_campanha, data_referencia desc);

select autenticacao.aplicar_rls_padrao(
  'projecoes_diarias', 'projecao.ler', 'projecao.gerenciar'
);

comment on table public.projecoes_diarias is
  'Serie temporal da projecao. public.projecoes guarda o AGORA e e sobrescrita a '
  'cada recalculo; esta guarda a curva. Sem nivel SECAO: seria 108 mil linhas '
  'para um grafico que ninguem desenha por secao.';

-- --- Permissão de retificação (usada na 0030) --------------------------------

/*
 * Semeada aqui para que o token já a traga quando a tela de retificação subir —
 * permissões viajam no JWT e só valem na renovação seguinte.
 *
 * O ENTREVISTADOR retifica a PRÓPRIA entrevista. Negar isso empurraria o erro de
 * digitação para uma correção por fora do sistema, que é o pior desfecho. Como
 * toda versão fica assinada e visível no histórico, o risco é auditável.
 */
insert into public.permissoes (chave, modulo, descricao) values
  ('campo.retificar', 'Campo', 'Retificar entrevista concluída, criando nova versão')
on conflict (chave) do nothing;

select public.conceder_permissao_padrao('ADMINISTRADOR', 'campo.retificar', 'CAMPANHA');
select public.conceder_permissao_padrao('COORDENADOR',   'campo.retificar', 'EQUIPE');
select public.conceder_permissao_padrao('ENTREVISTADOR', 'campo.retificar', 'PROPRIO');
