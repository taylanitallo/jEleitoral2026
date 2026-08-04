import { Body, Controller, Get, Module, Param, Post, Query, Req } from '@nestjs/common';
import type { Request } from 'express';
import { z } from 'zod';
import {
  ClaimsUsuario,
  OrigemProblema,
  StatusDiagnostico,
  TemaProblema,
  Uuid,
} from '@jeleitoral/tipos';
import { ExigePermissao } from '../autenticacao/autenticacao.guard.js';
import { Claims } from '../autenticacao/claimsUsuario.decorator.js';
import { AuditoriaService } from '../auditoria/auditoria.service.js';
import { BancoService } from '../banco/banco.service.js';

const EntradaDiagnostico = z.object({
  idCampanha: Uuid,
  titulo: z.string().trim().min(3, 'Informe o título.').max(160),
  idArea: Uuid.optional(),
  metodo: z.string().trim().max(60).optional(),
  periodoInicio: z.string().date().optional(),
  periodoFim: z.string().date().optional(),
  sintese: z.string().trim().max(4000).optional(),
});

const EntradaProblema = z.object({
  tema: TemaProblema,
  temaLivre: z.string().trim().max(60).optional(),
  titulo: z.string().trim().min(3, 'Descreva o problema em poucas palavras.').max(160),
  descricao: z.string().trim().max(2000).optional(),
  gravidade: z.coerce.number().int().min(1).max(5).default(3),
  frequenciaRelatos: z.coerce.number().int().min(1).default(1),
  origem: OrigemProblema.default('REUNIAO'),
  idBairro: Uuid.optional(),
});

interface Diagnostico {
  id: string;
  titulo: string;
  status: StatusDiagnostico;
  area: string | null;
  responsavel: string | null;
  total_problemas: number;
  criado_em: Date;
}

interface TemaAgregado {
  tema: TemaProblema;
  problemas: number;
  relatos: number;
  gravidadeMedia: number;
}

/**
 * Diagnóstico local — o que a campanha ouve na rua, registrado de forma que dê
 * para contar.
 *
 * O agregado por tema é o produto real deste módulo. Um problema isolado é
 * anedota; "saneamento aparece em seis bairros com gravidade média 4,2" é o
 * que vira eixo de discurso. Por isso `tema` é enum e o endpoint de agregação
 * existe desde o primeiro dia.
 */
@Controller('diagnostico')
export class DiagnosticoController {
  constructor(
    private readonly banco: BancoService,
    private readonly auditoria: AuditoriaService,
  ) {}

  @Get()
  @ExigePermissao('diagnostico.ler')
  async listar(
    @Claims() claims: ClaimsUsuario,
    @Query() consulta: unknown,
  ): Promise<Diagnostico[]> {
    const p = z.object({ idCampanha: Uuid }).parse(consulta);

    return this.banco.executarComoUsuario(claims, async (conexao) => {
      const { rows } = await conexao.query<Diagnostico>(
        `select d.id, d.titulo, d.status, a.nome as area, u.nome as responsavel,
                (select count(*)::int from public.diagnostico_problemas p
                  where p.id_diagnostico = d.id) as total_problemas,
                d.criado_em
           from public.diagnosticos d
           left join public.areas_estrategicas a on a.id = d.id_area
           left join public.usuarios u on u.id = d.id_usuario_responsavel
          where d.id_campanha = $1
          order by d.criado_em desc`,
        [p.idCampanha],
      );
      return rows;
    });
  }

  @Post()
  @ExigePermissao('diagnostico.gerenciar')
  async criar(
    @Claims() claims: ClaimsUsuario,
    @Body() corpo: unknown,
    @Req() requisicao: Request,
  ): Promise<{ id: string; titulo: string }> {
    const entrada = EntradaDiagnostico.parse(corpo);

    return this.banco.executarComoUsuario(claims, async (conexao) => {
      const { rows } = await conexao.query<{ id: string; titulo: string }>(
        `insert into public.diagnosticos
           (id_organizacao, id_campanha, titulo, id_area, metodo, periodo_inicio,
            periodo_fim, sintese, id_usuario_responsavel)
         values ($1, $2, $3, $4, $5, $6, $7, $8, $9)
         returning id, titulo`,
        [
          claims.idOrganizacao,
          entrada.idCampanha,
          entrada.titulo,
          entrada.idArea ?? null,
          entrada.metodo ?? null,
          entrada.periodoInicio ?? null,
          entrada.periodoFim ?? null,
          entrada.sintese ?? null,
          claims.sub,
        ],
      );
      const criado = rows[0]!;

      await this.auditoria.registrarNaTransacao(conexao, claims, {
        acao: 'CRIAR',
        entidade: 'diagnosticos',
        idEntidade: criado.id,
        idCampanha: entrada.idCampanha,
        dadosDepois: criado,
        ip: requisicao.ip ?? null,
        userAgent: requisicao.headers['user-agent'] ?? null,
        idCorrelacao: requisicao.idCorrelacao ?? null,
      });

      return criado;
    });
  }

  @Get(':id/problemas')
  @ExigePermissao('diagnostico.ler')
  async problemas(
    @Claims() claims: ClaimsUsuario,
    @Param('id') id: string,
  ): Promise<unknown[]> {
    const idDiagnostico = Uuid.parse(id);
    return this.banco.executarComoUsuario(claims, async (conexao) => {
      const { rows } = await conexao.query(
        `select p.id, p.tema, p.tema_livre, p.titulo, p.descricao, p.gravidade,
                p.frequencia_relatos, p.origem, b.nome as bairro, p.criado_em
           from public.diagnostico_problemas p
           left join public.bairros b
                  on p.nivel = 'BAIRRO' and b.id = p.id_referencia::uuid
          where p.id_diagnostico = $1
          order by p.gravidade desc, p.frequencia_relatos desc`,
        [idDiagnostico],
      );
      return rows;
    });
  }

  @Post(':id/problemas')
  @ExigePermissao('diagnostico.gerenciar')
  async registrarProblema(
    @Claims() claims: ClaimsUsuario,
    @Param('id') id: string,
    @Body() corpo: unknown,
  ): Promise<{ id: string }> {
    const idDiagnostico = Uuid.parse(id);
    const entrada = EntradaProblema.parse(corpo);

    return this.banco.executarComoUsuario(claims, async (conexao) => {
      // `id_campanha` vem do diagnóstico-pai, e o registrador vem do token.
      const { rows } = await conexao.query<{ id: string }>(
        `insert into public.diagnostico_problemas
           (id_organizacao, id_campanha, id_diagnostico, tema, tema_livre, titulo,
            descricao, gravidade, frequencia_relatos, origem, nivel, id_referencia,
            id_usuario_registro)
         select $1, d.id_campanha, d.id, $3::public.tema_problema, $4, $5, $6, $7, $8,
                $9::public.origem_problema,
                case when $10::uuid is null then null else 'BAIRRO' end::public.nivel_territorial,
                $10::text,
                $11
           from public.diagnosticos d where d.id = $2
         returning id`,
        [
          claims.idOrganizacao,
          idDiagnostico,
          entrada.tema,
          // O `check` da tabela só aceita tema_livre quando o tema é OUTRO.
          entrada.tema === 'OUTRO' ? (entrada.temaLivre ?? null) : null,
          entrada.titulo,
          entrada.descricao ?? null,
          entrada.gravidade,
          entrada.frequenciaRelatos,
          entrada.origem,
          entrada.idBairro ?? null,
          claims.sub,
        ],
      );
      if (!rows[0]) {
        throw Object.assign(new Error('Diagnóstico não encontrado.'), { code: '42501' });
      }
      return rows[0];
    });
  }

  /**
   * Temas mais citados na campanha.
   *
   * É este número que orienta discurso, e é ele que vai alimentar a sugestão de
   * eixos narrativos. Ordena por relatos e não por quantidade de problemas: um
   * problema citado quarenta vezes pesa mais que quatro problemas citados uma
   * vez cada, ainda que a contagem simples dissesse o contrário.
   */
  @Get('agregado/temas')
  @ExigePermissao('diagnostico.ler')
  async agregadoPorTema(
    @Claims() claims: ClaimsUsuario,
    @Query() consulta: unknown,
  ): Promise<TemaAgregado[]> {
    const p = z.object({ idCampanha: Uuid, idArea: Uuid.optional() }).parse(consulta);

    return this.banco.executarComoUsuario(claims, async (conexao) => {
      const { rows } = await conexao.query<{
        tema: TemaProblema;
        problemas: number;
        relatos: string;
        gravidade_media: string;
      }>(
        `select p.tema,
                count(*)::int as problemas,
                sum(p.frequencia_relatos)::bigint as relatos,
                avg(p.gravidade)::numeric(4,2) as gravidade_media
           from public.diagnostico_problemas p
           join public.diagnosticos d on d.id = p.id_diagnostico
          where p.id_campanha = $1
            and ($2::uuid is null or d.id_area = $2)
          group by p.tema
          order by relatos desc, problemas desc`,
        [p.idCampanha, p.idArea ?? null],
      );

      return rows.map((linha) => ({
        tema: linha.tema,
        problemas: linha.problemas,
        // `sum` de bigint e `avg` de numeric voltam como string no driver do pg.
        relatos: Number(linha.relatos),
        gravidadeMedia: Number(linha.gravidade_media),
      }));
    });
  }
}

@Module({
  controllers: [DiagnosticoController],
  providers: [BancoService, AuditoriaService],
})
export class DiagnosticoModule {}
