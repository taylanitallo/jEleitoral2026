import { Body, Controller, Delete, Get, Module, Param, Post, Put, Query, Req } from '@nestjs/common';
import type { Request } from 'express';
import { z } from 'zod';
import {
  ClaimsUsuario,
  NaturezaArea,
  NivelTerritorial,
  Prioridade,
  Uuid,
} from '@jeleitoral/tipos';
import { ExigePermissao } from '../autenticacao/autenticacao.guard.js';
import { Claims } from '../autenticacao/claimsUsuario.decorator.js';
import { AuditoriaService } from '../auditoria/auditoria.service.js';
import { BancoService } from '../banco/banco.service.js';

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
  async listarAreas(
    @Claims() claims: ClaimsUsuario,
    @Query() consulta: unknown,
  ): Promise<Area[]> {
    const p = z
      .object({ idCampanha: Uuid, natureza: NaturezaArea.optional() })
      .parse(consulta);

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
