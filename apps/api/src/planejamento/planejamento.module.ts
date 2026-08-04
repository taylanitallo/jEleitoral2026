import {
  Body,
  Controller,
  Delete,
  Get,
  Module,
  Param,
  Post,
  Put,
  Query,
  Req,
} from '@nestjs/common';
import type { Request } from 'express';
import { z } from 'zod';
import {
  ClaimsUsuario,
  NaturezaArea,
  NivelTerritorial,
  Prioridade,
  StatusAcao,
  Uuid,
} from '@jeleitoral/tipos';
import { ExigePermissao } from '../autenticacao/autenticacao.guard.js';
import { Claims } from '../autenticacao/claimsUsuario.decorator.js';
import { AuditoriaService } from '../auditoria/auditoria.service.js';
import { BancoService } from '../banco/banco.service.js';
import { montarAgregadoNarrativo } from './agregadoNarrativo.js';

const EntradaArea = z.object({
  idCampanha: Uuid,
  nome: z.string().trim().min(3, 'Informe o nome da área.').max(120),
  natureza: NaturezaArea.default('TERRITORIAL'),
  tema: z.string().trim().max(60).optional(),
  prioridade: Prioridade.default('MEDIA'),
  idCoordenador: Uuid.optional(),
  idEquipe: Uuid.optional(),
  metaVotos: z.coerce.number().int().nonnegative().optional(),
  descricao: z.string().trim().max(1000).optional(),
});

const EntradaEixo = z.object({
  idCampanha: Uuid,
  titulo: z.string().trim().min(3).max(160),
  sintese: z.string().trim().min(10).max(2000),
  publicoAlvo: z.string().trim().max(200).optional(),
  mensagens: z.array(z.string().trim().max(300)).max(10).default([]),
  provas: z.array(z.string().trim().max(300)).max(10).default([]),
  riscos: z.array(z.string().trim().max(300)).max(10).default([]),
  prioridade: Prioridade.default('MEDIA'),
  geradoPorIa: z.boolean().default(false),
  /** Temas de que o eixo saiu; viram vinculos em `eixo_problemas`. */
  temasRelacionados: z.array(z.string()).max(14).default([]),
});

const EntradaAcao = z.object({
  idCampanha: Uuid,
  titulo: z.string().trim().min(3).max(160),
  descricao: z.string().trim().max(2000).optional(),
  idEixo: Uuid.optional(),
  idArea: Uuid.optional(),
  prioridade: Prioridade.default('MEDIA'),
  prazo: z.string().date().optional(),
  idResponsavel: Uuid.optional(),
  custoEstimado: z.coerce.number().nonnegative().optional(),
  resultadoEsperado: z.string().trim().max(1000).optional(),
});

const EntradaTerritorio = z.object({
  // A composição só aceita níveis que descem até bairro. MUNICIPIO e ESTADO
  // existem no enum para `metas`, mas uma área que cobre o estado inteiro não
  // é recorte — é a campanha.
  nivel: z.enum(['SECAO', 'LOCAL', 'BAIRRO', 'ZONA']),
  idReferencia: z.string().trim().min(1),
  peso: z.coerce.number().gt(0).max(1).default(1),
});

interface Area {
  id: string;
  nome: string;
  natureza: NaturezaArea;
  tema: string | null;
  prioridade: Prioridade;
  meta_votos: number | null;
  ativa: boolean;
  coordenador: string | null;
  equipe: string | null;
  total_territorios: number;
}

interface ResumoArea {
  bairros: number;
  eleitoradoBase: number;
  domiciliosMapeados: number;
  entrevistados: number;
  apoiadores: number;
  coberturaAmostral: number;
}

/**
 * Planejamento — áreas estratégicas e sua composição territorial.
 *
 * Área é um **agrupamento nomeado** sobre a malha que já existe, não um nível
 * territorial novo. O claim `territorios` do JWT continua vindo de
 * `secao_bairros` pelo hook 0014, e nada aqui o altera: alinhar a área ao
 * território de quem a coordena é operacional — atribuir à equipe dela as
 * seções correspondentes.
 */
@Controller('planejamento')
export class PlanejamentoController {
  constructor(
    private readonly banco: BancoService,
    private readonly auditoria: AuditoriaService,
  ) {}

  @Get('areas')
  @ExigePermissao('planejamento.ler')
  async listarAreas(@Claims() claims: ClaimsUsuario, @Query() consulta: unknown): Promise<Area[]> {
    const p = z.object({ idCampanha: Uuid, natureza: NaturezaArea.optional() }).parse(consulta);

    return this.banco.executarComoUsuario(claims, async (conexao) => {
      const { rows } = await conexao.query<Area>(
        `select a.id, a.nome, a.natureza, a.tema, a.prioridade, a.meta_votos, a.ativa,
                u.nome as coordenador, e.nome as equipe,
                (select count(*)::int from public.area_territorios t
                  where t.id_area = a.id) as total_territorios
           from public.areas_estrategicas a
           left join public.usuarios u on u.id = a.id_coordenador
           left join public.equipes e on e.id = a.id_equipe
          where a.id_campanha = $1
            and ($2::text is null or a.natureza::text = $2)
          order by a.ativa desc,
                   case a.prioridade when 'ALTA' then 1 when 'MEDIA' then 2 else 3 end,
                   a.nome`,
        [p.idCampanha, p.natureza ?? null],
      );
      return rows;
    });
  }

  @Post('areas')
  @ExigePermissao('planejamento.gerenciar')
  async criarArea(
    @Claims() claims: ClaimsUsuario,
    @Body() corpo: unknown,
    @Req() requisicao: Request,
  ): Promise<{ id: string; nome: string }> {
    const entrada = EntradaArea.parse(corpo);

    return this.banco.executarComoUsuario(claims, async (conexao) => {
      const { rows } = await conexao.query<{ id: string; nome: string }>(
        `insert into public.areas_estrategicas
           (id_organizacao, id_campanha, nome, natureza, tema, prioridade,
            id_coordenador, id_equipe, meta_votos, descricao)
         values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
         returning id, nome`,
        [
          claims.idOrganizacao,
          entrada.idCampanha,
          entrada.nome,
          entrada.natureza,
          // O `check` da tabela recusa tema fora de área temática; anular aqui
          // devolve mensagem de validação em vez de violação de constraint.
          entrada.natureza === 'TEMATICA' ? (entrada.tema ?? null) : null,
          entrada.prioridade,
          entrada.idCoordenador ?? null,
          entrada.idEquipe ?? null,
          entrada.metaVotos ?? null,
          entrada.descricao ?? null,
        ],
      );
      const criada = rows[0]!;

      await this.auditoria.registrarNaTransacao(conexao, claims, {
        acao: 'CRIAR',
        entidade: 'areas_estrategicas',
        idEntidade: criada.id,
        idCampanha: entrada.idCampanha,
        dadosDepois: criada,
        ip: requisicao.ip ?? null,
        userAgent: requisicao.headers['user-agent'] ?? null,
        idCorrelacao: requisicao.idCorrelacao ?? null,
      });

      return criada;
    });
  }

  @Put('areas/:id')
  @ExigePermissao('planejamento.gerenciar')
  async alterarArea(
    @Claims() claims: ClaimsUsuario,
    @Param('id') id: string,
    @Body() corpo: unknown,
  ): Promise<{ alterado: boolean }> {
    const idArea = Uuid.parse(id);
    const entrada = EntradaArea.partial().extend({ ativa: z.boolean().optional() }).parse(corpo);

    return this.banco.executarComoUsuario(claims, async (conexao) => {
      const resultado = await conexao.query(
        `update public.areas_estrategicas
            set nome = coalesce($2, nome),
                prioridade = coalesce($3::public.prioridade, prioridade),
                id_coordenador = coalesce($4, id_coordenador),
                id_equipe = coalesce($5, id_equipe),
                meta_votos = coalesce($6, meta_votos),
                descricao = coalesce($7, descricao),
                ativa = coalesce($8, ativa)
          where id = $1`,
        [
          idArea,
          entrada.nome ?? null,
          entrada.prioridade ?? null,
          entrada.idCoordenador ?? null,
          entrada.idEquipe ?? null,
          entrada.metaVotos ?? null,
          entrada.descricao ?? null,
          entrada.ativa ?? null,
        ],
      );
      return { alterado: (resultado.rowCount ?? 0) > 0 };
    });
  }

  // --- Composição territorial ------------------------------------------------

  @Get('areas/:id/territorios')
  @ExigePermissao('planejamento.ler')
  async territorios(
    @Claims() claims: ClaimsUsuario,
    @Param('id') id: string,
  ): Promise<Array<{ id: string; nivel: NivelTerritorial; rotulo: string; peso: number }>> {
    const idArea = Uuid.parse(id);

    return this.banco.executarComoUsuario(claims, async (conexao) => {
      // O rótulo é resolvido por nível: `id_referencia` é texto polimórfico e
      // sozinho não diz nada a quem olha a tela.
      const { rows } = await conexao.query<{
        id: string;
        nivel: NivelTerritorial;
        rotulo: string;
        peso: number;
      }>(
        // `peso` sai como string: o driver do pg entrega `numeric` assim para
        // nao perder precisao. Aqui cabe em float8 com folga, e o tipo
        // declarado na interface passa a ser verdade.
        `select t.id, t.nivel, t.peso::float8 as peso,
                coalesce(
                  b.nome,
                  'Seção ' || s.numero::text,
                  l.nome,
                  'Zona ' || z.numero::text,
                  t.id_referencia
                ) as rotulo
           from public.area_territorios t
           left join public.bairros b
                  on t.nivel = 'BAIRRO' and b.id = t.id_referencia::uuid
           left join public.secoes_eleitorais s
                  on t.nivel = 'SECAO' and s.id = t.id_referencia::uuid
           left join public.locais_votacao l
                  on t.nivel = 'LOCAL' and l.id = t.id_referencia::uuid
           left join public.zonas_eleitorais z
                  on t.nivel = 'ZONA' and z.id = t.id_referencia::uuid
          where t.id_area = $1
          order by t.nivel, rotulo`,
        [idArea],
      );
      return rows;
    });
  }

  @Post('areas/:id/territorios')
  @ExigePermissao('planejamento.gerenciar')
  async incluirTerritorio(
    @Claims() claims: ClaimsUsuario,
    @Param('id') id: string,
    @Body() corpo: unknown,
  ): Promise<{ id: string }> {
    const idArea = Uuid.parse(id);
    const entrada = EntradaTerritorio.parse(corpo);

    return this.banco.executarComoUsuario(claims, async (conexao) => {
      // `id_campanha` vem da área, não do corpo — um território não pode entrar
      // numa área de outra campanha.
      const { rows } = await conexao.query<{ id: string }>(
        `insert into public.area_territorios
           (id_organizacao, id_campanha, id_area, nivel, id_referencia, peso)
         select $1, a.id_campanha, a.id, $3::public.nivel_territorial, $4, $5
           from public.areas_estrategicas a where a.id = $2
         on conflict (id_area, nivel, id_referencia) do update set peso = excluded.peso
         returning id`,
        [claims.idOrganizacao, idArea, entrada.nivel, entrada.idReferencia, entrada.peso],
      );
      if (!rows[0]) {
        throw Object.assign(new Error('Área não encontrada.'), { code: '42501' });
      }
      return rows[0];
    });
  }

  @Delete('areas/:id/territorios/:idTerritorio')
  @ExigePermissao('planejamento.gerenciar')
  async removerTerritorio(
    @Claims() claims: ClaimsUsuario,
    @Param('idTerritorio') idTerritorio: string,
  ): Promise<{ removido: boolean }> {
    const alvo = Uuid.parse(idTerritorio);
    return this.banco.executarComoUsuario(claims, async (conexao) => {
      const resultado = await conexao.query('delete from public.area_territorios where id = $1', [
        alvo,
      ]);
      return { removido: (resultado.rowCount ?? 0) > 0 };
    });
  }

  // --- Diagnostico agregado para a IA ----------------------------------------

  /**
   * Monta o agregado que alimenta a sugestao de eixos.
   *
   * A agregacao roda no banco e a montagem final em `montarAgregadoNarrativo`,
   * que e logica pura e testada. A separacao existe porque a montagem e o ponto
   * em que dado de campo atravessa para um provedor externo — e ela usa lista
   * branca de campos, nao espalhamento.
   */
  @Get('agregado-narrativo')
  @ExigePermissao('planejamento.gerenciar')
  async agregadoNarrativo(
    @Claims() claims: ClaimsUsuario,
    @Query() consulta: unknown,
  ): Promise<unknown> {
    const p = z.object({ idCampanha: Uuid }).parse(consulta);

    return this.banco.executarComoUsuario(claims, async (conexao) => {
      const { rows: porTema } = await conexao.query<{
        tema: string;
        quantidade_problemas: number;
        soma_relatos: string;
        gravidade_media: string;
      }>(
        `select p.tema,
                count(*)::int as quantidade_problemas,
                sum(p.frequencia_relatos)::bigint as soma_relatos,
                avg(p.gravidade)::numeric as gravidade_media
           from public.diagnostico_problemas p
          where p.id_campanha = $1
          group by p.tema`,
        [p.idCampanha],
      );

      const { rows: porTerritorio } = await conexao.query<{
        nivel: string;
        id_referencia: string;
        rotulo: string;
        tema_principal: string;
        quantidade_problemas: number;
      }>(
        `select p.nivel::text as nivel, p.id_referencia,
                coalesce(b.nome, p.id_referencia) as rotulo,
                mode() within group (order by p.tema) as tema_principal,
                count(*)::int as quantidade_problemas
           from public.diagnostico_problemas p
           left join public.bairros b
                  on p.nivel = 'BAIRRO' and b.id = p.id_referencia::uuid
          where p.id_campanha = $1 and p.nivel is not null
          group by p.nivel, p.id_referencia, b.nome`,
        [p.idCampanha],
      );

      // Clima eleitoral por bairro: o cruzamento que separa eixo acionavel de
      // plano de governo generico.
      const { rows: clima } = await conexao.query<{
        nivel: string;
        id_referencia: string;
        rotulo: string;
        apoiador: number;
        provavel: number;
        indeciso: number;
        oposicao: number;
        nao_informou: number;
        eleitorado_base: string;
      }>(
        `select 'BAIRRO' as nivel, b.id::text as id_referencia, b.nome as rotulo,
                count(*) filter (where e.classificacao = 'APOIADOR')::int as apoiador,
                count(*) filter (where e.classificacao = 'PROVAVEL')::int as provavel,
                count(*) filter (where e.classificacao = 'INDECISO')::int as indeciso,
                count(*) filter (where e.classificacao = 'OPOSICAO')::int as oposicao,
                count(*) filter (where e.classificacao = 'NAO_INFORMOU')::int as nao_informou,
                coalesce((
                  select sum(es.total_eleitores)
                    from public.secao_bairros sb
                    join public.eleitorado_secao es on es.id_secao = sb.id_secao
                   where sb.id_bairro = b.id
                ), 0)::bigint as eleitorado_base
           from public.bairros b
           join public.domicilios d on d.id_bairro = b.id
           join public.entrevistados e on e.id_domicilio = d.id
          where d.id_campanha = $1
          group by b.id, b.nome`,
        [p.idCampanha],
      );

      const { rows: cobertura } = await conexao.query<{ cobertura: string }>(
        `select coalesce(
                  count(distinct e.id)::numeric / nullif((
                    select sum(es.total_eleitores) from public.eleitorado_secao es
                  ), 0), 0) as cobertura
           from public.entrevistados e
          where e.id_campanha = $1`,
        [p.idCampanha],
      );

      return montarAgregadoNarrativo({
        problemasPorTema: porTema.map((l) => ({
          tema: l.tema,
          quantidadeProblemas: l.quantidade_problemas,
          somaRelatos: Number(l.soma_relatos),
          gravidadeMedia: Number(l.gravidade_media),
        })),
        problemasPorTerritorio: porTerritorio.map((l) => ({
          nivel: l.nivel,
          idReferencia: l.id_referencia,
          rotuloTerritorio: l.rotulo,
          temaPrincipal: l.tema_principal,
          quantidadeProblemas: l.quantidade_problemas,
        })),
        classificacaoPorTerritorio: clima.map((l) => ({
          nivel: l.nivel,
          idReferencia: l.id_referencia,
          rotuloTerritorio: l.rotulo,
          apoiador: l.apoiador,
          provavel: l.provavel,
          indeciso: l.indeciso,
          oposicao: l.oposicao,
          naoInformou: l.nao_informou,
          eleitoradoBase: Number(l.eleitorado_base),
        })),
        coberturaAmostral: Math.min(1, Number(cobertura[0]?.cobertura ?? 0)),
      });
    });
  }

  // --- Eixos narrativos ------------------------------------------------------

  @Get('eixos')
  @ExigePermissao('planejamento.ler')
  async listarEixos(
    @Claims() claims: ClaimsUsuario,
    @Query() consulta: unknown,
  ): Promise<unknown[]> {
    const p = z.object({ idCampanha: Uuid }).parse(consulta);
    return this.banco.executarComoUsuario(claims, async (conexao) => {
      const { rows } = await conexao.query(
        `select e.id, e.titulo, e.sintese, e.publico_alvo, e.mensagens, e.provas, e.riscos,
                e.prioridade, e.gerado_por_ia, e.aprovado_em,
                (select count(*)::int from public.eixo_problemas ep where ep.id_eixo = e.id)
                  as total_problemas,
                (select count(*)::int from public.acoes_campanha a where a.id_eixo = e.id)
                  as total_acoes
           from public.eixos_narrativos e
          where e.id_campanha = $1
          order by case e.prioridade when 'ALTA' then 1 when 'MEDIA' then 2 else 3 end, e.titulo`,
        [p.idCampanha],
      );
      return rows;
    });
  }

  @Post('eixos')
  @ExigePermissao('planejamento.gerenciar')
  async criarEixo(
    @Claims() claims: ClaimsUsuario,
    @Body() corpo: unknown,
    @Req() requisicao: Request,
  ): Promise<{ id: string; problemasVinculados: number }> {
    const entrada = EntradaEixo.parse(corpo);

    return this.banco.executarComoUsuario(claims, async (conexao) => {
      const { rows } = await conexao.query<{ id: string }>(
        `insert into public.eixos_narrativos
           (id_organizacao, id_campanha, titulo, sintese, publico_alvo, mensagens, provas,
            riscos, prioridade, gerado_por_ia)
         values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
         returning id`,
        [
          claims.idOrganizacao,
          entrada.idCampanha,
          entrada.titulo,
          entrada.sintese,
          entrada.publicoAlvo ?? null,
          entrada.mensagens,
          entrada.provas,
          entrada.riscos,
          entrada.prioridade,
          entrada.geradoPorIa,
        ],
      );
      const idEixo = rows[0]!.id;

      /*
       * Vincula o eixo aos problemas reais dos temas que o originaram.
       *
       * E o elo que transforma "achamos que saneamento pega bem" em "saneamento
       * apareceu em seis bairros, com 61 relatos" — e o que permite, meses
       * depois, mostrar de onde veio o discurso.
       */
      let vinculados = 0;
      if (entrada.temasRelacionados.length > 0) {
        const resultado = await conexao.query(
          `insert into public.eixo_problemas (id_organizacao, id_eixo, id_problema)
           select $1, $2, p.id
             from public.diagnostico_problemas p
            where p.id_campanha = $3 and p.tema::text = any($4::text[])
           on conflict do nothing`,
          [claims.idOrganizacao, idEixo, entrada.idCampanha, entrada.temasRelacionados],
        );
        vinculados = resultado.rowCount ?? 0;
      }

      await this.auditoria.registrarNaTransacao(conexao, claims, {
        acao: 'CRIAR',
        entidade: 'eixos_narrativos',
        idEntidade: idEixo,
        idCampanha: entrada.idCampanha,
        dadosDepois: { titulo: entrada.titulo, geradoPorIa: entrada.geradoPorIa },
        ip: requisicao.ip ?? null,
        userAgent: requisicao.headers['user-agent'] ?? null,
        idCorrelacao: requisicao.idCorrelacao ?? null,
      });

      return { id: idEixo, problemasVinculados: vinculados };
    });
  }

  // --- Plano de acoes --------------------------------------------------------

  @Get('acoes')
  @ExigePermissao('planejamento.ler')
  async listarAcoes(
    @Claims() claims: ClaimsUsuario,
    @Query() consulta: unknown,
  ): Promise<unknown[]> {
    const p = z.object({ idCampanha: Uuid }).parse(consulta);
    return this.banco.executarComoUsuario(claims, async (conexao) => {
      const { rows } = await conexao.query(
        `select a.id, a.titulo, a.descricao, a.status, a.prioridade, a.prazo,
                a.resultado_esperado, e.titulo as eixo, ar.nome as area, u.nome as responsavel,
                (select count(*)::int from public.atividades at where at.id_acao = a.id)
                  as total_atividades
           from public.acoes_campanha a
           left join public.eixos_narrativos e on e.id = a.id_eixo
           left join public.areas_estrategicas ar on ar.id = a.id_area
           left join public.usuarios u on u.id = a.id_responsavel
          where a.id_campanha = $1
          order by a.status,
                   case a.prioridade when 'ALTA' then 1 when 'MEDIA' then 2 else 3 end,
                   a.prazo nulls last`,
        [p.idCampanha],
      );
      return rows;
    });
  }

  @Post('acoes')
  @ExigePermissao('planejamento.gerenciar')
  async criarAcao(
    @Claims() claims: ClaimsUsuario,
    @Body() corpo: unknown,
  ): Promise<{ id: string; titulo: string }> {
    const entrada = EntradaAcao.parse(corpo);

    return this.banco.executarComoUsuario(claims, async (conexao) => {
      const { rows } = await conexao.query<{ id: string; titulo: string }>(
        `insert into public.acoes_campanha
           (id_organizacao, id_campanha, titulo, descricao, id_eixo, id_area, prioridade,
            prazo, id_responsavel, custo_estimado, resultado_esperado)
         values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
         returning id, titulo`,
        [
          claims.idOrganizacao,
          entrada.idCampanha,
          entrada.titulo,
          entrada.descricao ?? null,
          entrada.idEixo ?? null,
          entrada.idArea ?? null,
          entrada.prioridade,
          entrada.prazo ?? null,
          // Sem responsavel informado, quem cria assume: acao sem dono e acao
          // que ninguem executa.
          entrada.idResponsavel ?? claims.sub,
          entrada.custoEstimado ?? null,
          entrada.resultadoEsperado ?? null,
        ],
      );
      return rows[0]!;
    });
  }

  @Put('acoes/:id')
  @ExigePermissao('planejamento.gerenciar')
  async alterarAcao(
    @Claims() claims: ClaimsUsuario,
    @Param('id') id: string,
    @Body() corpo: unknown,
  ): Promise<{ alterado: boolean }> {
    const idAcao = Uuid.parse(id);
    const entrada = z
      .object({
        status: StatusAcao.optional(),
        resultadoObtido: z.string().trim().max(2000).optional(),
      })
      .parse(corpo);

    return this.banco.executarComoUsuario(claims, async (conexao) => {
      const resultado = await conexao.query(
        `update public.acoes_campanha
            set status = coalesce($2::public.status_acao, status),
                resultado_obtido = coalesce($3, resultado_obtido),
                concluida_em = case when $2 = 'CONCLUIDA' then coalesce(concluida_em, now())
                                    else concluida_em end
          where id = $1`,
        [idAcao, entrada.status ?? null, entrada.resultadoObtido ?? null],
      );
      return { alterado: (resultado.rowCount ?? 0) > 0 };
    });
  }

  /**
   * Indicadores da área.
   *
   * Tudo aqui é agregado a partir dos bairros que a área cobre, expandidos por
   * `public.bairros_da_area`. Sem essa função, cada indicador reescreveria o
   * mesmo `union` de quatro níveis territoriais e um deles acabaria divergindo
   * dos outros — o tipo de erro que só aparece quando dois números da mesma
   * tela não fecham.
   */
  @Get('areas/:id/resumo')
  @ExigePermissao('planejamento.ler')
  async resumo(@Claims() claims: ClaimsUsuario, @Param('id') id: string): Promise<ResumoArea> {
    const idArea = Uuid.parse(id);

    return this.banco.executarComoUsuario(claims, async (conexao) => {
      const { rows } = await conexao.query<{
        bairros: number;
        eleitorado_base: string;
        domicilios: number;
        entrevistados: number;
        apoiadores: number;
      }>(
        `with bairros_area as (
           select id_bairro from public.bairros_da_area($1)
         )
         select
           (select count(*)::int from bairros_area) as bairros,
           coalesce((
             select sum(es.total_eleitores)
               from public.secao_bairros sb
               join bairros_area ba on ba.id_bairro = sb.id_bairro
               join public.eleitorado_secao es on es.id_secao = sb.id_secao
           ), 0) as eleitorado_base,
           (select count(*)::int from public.domicilios d
             join bairros_area ba on ba.id_bairro = d.id_bairro) as domicilios,
           (select count(*)::int from public.entrevistados e
             join public.domicilios d on d.id = e.id_domicilio
             join bairros_area ba on ba.id_bairro = d.id_bairro) as entrevistados,
           (select count(*)::int from public.entrevistados e
             join public.domicilios d on d.id = e.id_domicilio
             join bairros_area ba on ba.id_bairro = d.id_bairro
            where e.classificacao = 'APOIADOR') as apoiadores`,
        [idArea],
      );

      const linha = rows[0]!;
      const eleitoradoBase = Number(linha.eleitorado_base);

      return {
        bairros: linha.bairros,
        eleitoradoBase,
        domiciliosMapeados: linha.domicilios,
        entrevistados: linha.entrevistados,
        apoiadores: linha.apoiadores,
        // Cobertura sem denominador é divisão por zero disfarçada de zero por
        // cento. Devolver 0 aqui diria "nada mapeado" quando o certo é "não dá
        // para saber" — a tela precisa distinguir os dois casos.
        coberturaAmostral: eleitoradoBase > 0 ? linha.entrevistados / eleitoradoBase : 0,
      };
    });
  }
}

@Module({
  controllers: [PlanejamentoController],
  providers: [BancoService, AuditoriaService],
})
export class PlanejamentoModule {}
