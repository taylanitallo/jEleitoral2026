import { Body, Controller, Get, Module, Param, Post, Put, Query, Req } from '@nestjs/common';
import type { Request } from 'express';
import { z } from 'zod';
import {
  ClaimsUsuario,
  ParametrosPaginacao,
  SituacaoParticipante,
  StatusAtividade,
  TipoAtividade,
  Uuid,
  montarPagina,
  type PaginaDe,
} from '@jeleitoral/tipos';
import { ExigePermissao } from '../autenticacao/autenticacao.guard.js';
import { Claims } from '../autenticacao/claimsUsuario.decorator.js';
import { AuditoriaService } from '../auditoria/auditoria.service.js';
import { BancoService } from '../banco/banco.service.js';

const EntradaAtividade = z.object({
  idCampanha: Uuid,
  tipo: TipoAtividade,
  titulo: z.string().trim().min(3, 'Informe o título.').max(160),
  inicioEm: z.string().datetime({ offset: true }),
  fimEm: z.string().datetime({ offset: true }).optional(),
  localDescricao: z.string().trim().max(200).optional(),
  idBairro: Uuid.optional(),
  idComite: Uuid.optional(),
  idCandidato: Uuid.optional(),
  idEquipe: Uuid.optional(),
  roteiro: z.string().trim().max(4000).optional(),
  publicoEstimado: z.coerce.number().int().nonnegative().optional(),
  custoEstimado: z.coerce.number().nonnegative().optional(),
  observacoes: z.string().trim().max(1000).optional(),
});

const Fechamento = z.object({
  status: StatusAtividade,
  publicoConfirmado: z.coerce.number().int().nonnegative().optional(),
  encaminhamentos: z.string().trim().max(4000).optional(),
});

const EntradaParticipante = z
  .object({
    idUsuario: Uuid.optional(),
    idAtivista: Uuid.optional(),
    situacao: SituacaoParticipante.default('CONVIDADO'),
    papel: z.string().trim().max(40).optional(),
  })
  .refine((v) => Boolean(v.idUsuario) !== Boolean(v.idAtivista), {
    message: 'Informe um usuário OU um ativista, nunca os dois.',
  });

const ConsultaAgenda = ParametrosPaginacao.extend({
  idCampanha: Uuid,
  de: z.string().date().optional(),
  ate: z.string().date().optional(),
  tipo: TipoAtividade.optional(),
  status: StatusAtividade.optional(),
});

interface Atividade {
  id: string;
  tipo: string;
  status: string;
  titulo: string;
  inicio_em: Date;
  fim_em: Date | null;
  local_descricao: string | null;
  bairro: string | null;
  comite: string | null;
  responsavel: string;
  total_participantes: number;
  total_presentes: number;
}

/**
 * Agenda da campanha.
 *
 * O que se enxerga aqui depende do escopo do perfil: a política aplica
 * `visivel_no_escopo`, então o entrevistador com `agenda.ler: PROPRIO` vê só
 * onde ele foi escalado. Compromisso privado do candidato não vaza para a
 * equipe inteira por consulta esquecida.
 */
@Controller('agenda')
export class AgendaController {
  constructor(
    private readonly banco: BancoService,
    private readonly auditoria: AuditoriaService,
  ) {}

  @Get()
  @ExigePermissao('agenda.ler')
  async listar(
    @Claims() claims: ClaimsUsuario,
    @Query() consulta: unknown,
  ): Promise<PaginaDe<Atividade>> {
    const p = ConsultaAgenda.parse(consulta);

    return this.banco.executarComoUsuario(claims, async (conexao) => {
      const { rows } = await conexao.query<Atividade & { total: string }>(
        `select a.id, a.tipo, a.status, a.titulo, a.inicio_em, a.fim_em,
                a.local_descricao, b.nome as bairro, c.nome as comite,
                u.nome as responsavel,
                (select count(*)::int from public.atividade_participantes p
                  where p.id_atividade = a.id) as total_participantes,
                (select count(*)::int from public.atividade_participantes p
                  where p.id_atividade = a.id and p.situacao = 'PRESENTE') as total_presentes,
                count(*) over () as total
           from public.atividades a
           join public.usuarios u on u.id = a.id_responsavel
           left join public.bairros b on b.id = a.id_bairro
           left join public.comites c on c.id = a.id_comite
          where a.id_campanha = $1
            and ($2::date is null or a.inicio_em >= $2::date)
            and ($3::date is null or a.inicio_em < ($3::date + 1))
            and ($4::text is null or a.tipo::text = $4)
            and ($5::text is null or a.status::text = $5)
          order by a.inicio_em
          limit $6 offset $7`,
        [
          p.idCampanha,
          p.de ?? null,
          p.ate ?? null,
          p.tipo ?? null,
          p.status ?? null,
          p.limite,
          (p.pagina - 1) * p.limite,
        ],
      );
      const total = rows[0] ? Number(rows[0].total) : 0;
      return montarPagina(
        rows.map(({ total: _ignorado, ...atividade }) => atividade),
        total,
        p,
      );
    });
  }

  @Post()
  @ExigePermissao('agenda.gerenciar')
  async criar(
    @Claims() claims: ClaimsUsuario,
    @Body() corpo: unknown,
    @Req() requisicao: Request,
  ): Promise<{ id: string; titulo: string }> {
    const entrada = EntradaAtividade.parse(corpo);

    return this.banco.executarComoUsuario(claims, async (conexao) => {
      const { rows } = await conexao.query<{ id: string; titulo: string }>(
        `insert into public.atividades
           (id_organizacao, id_campanha, tipo, titulo, inicio_em, fim_em, local_descricao,
            id_bairro, id_comite, id_candidato, id_equipe, roteiro, publico_estimado,
            custo_estimado, observacoes, id_responsavel)
         values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16)
         returning id, titulo`,
        [
          claims.idOrganizacao,
          entrada.idCampanha,
          entrada.tipo,
          entrada.titulo,
          entrada.inicioEm,
          entrada.fimEm ?? null,
          entrada.localDescricao ?? null,
          entrada.idBairro ?? null,
          entrada.idComite ?? null,
          entrada.idCandidato ?? null,
          entrada.idEquipe ?? null,
          entrada.roteiro ?? null,
          entrada.publicoEstimado ?? null,
          entrada.custoEstimado ?? null,
          entrada.observacoes ?? null,
          // A política exige que o responsável seja quem grava.
          claims.sub,
        ],
      );
      const criada = rows[0]!;

      await this.auditoria.registrarNaTransacao(conexao, claims, {
        acao: 'CRIAR',
        entidade: 'atividades',
        idEntidade: criada.id,
        idCampanha: entrada.idCampanha,
        dadosDepois: { titulo: criada.titulo, tipo: entrada.tipo, inicioEm: entrada.inicioEm },
        ip: requisicao.ip ?? null,
        userAgent: requisicao.headers['user-agent'] ?? null,
        idCorrelacao: requisicao.idCorrelacao ?? null,
      });

      return criada;
    });
  }

  /**
   * Fecha a atividade: status, público que apareceu e encaminhamentos.
   *
   * Separado do `PUT` geral porque é o que se faz **depois** do evento, e num
   * momento diferente — quem fecha muitas vezes não é quem criou.
   */
  @Put(':id/fechamento')
  @ExigePermissao('agenda.gerenciar')
  async fechar(
    @Claims() claims: ClaimsUsuario,
    @Param('id') id: string,
    @Body() corpo: unknown,
  ): Promise<{ alterado: boolean }> {
    const idAtividade = Uuid.parse(id);
    const entrada = Fechamento.parse(corpo);

    return this.banco.executarComoUsuario(claims, async (conexao) => {
      const resultado = await conexao.query(
        `update public.atividades
            set status = $2::public.status_atividade,
                publico_confirmado = coalesce($3, publico_confirmado),
                encaminhamentos = coalesce($4, encaminhamentos)
          where id = $1`,
        [
          idAtividade,
          entrada.status,
          entrada.publicoConfirmado ?? null,
          entrada.encaminhamentos ?? null,
        ],
      );
      return { alterado: (resultado.rowCount ?? 0) > 0 };
    });
  }

  @Get(':id/participantes')
  @ExigePermissao('agenda.ler')
  async participantes(
    @Claims() claims: ClaimsUsuario,
    @Param('id') id: string,
  ): Promise<Array<{ id: string; nome: string; situacao: string; ehAtivista: boolean }>> {
    const idAtividade = Uuid.parse(id);
    return this.banco.executarComoUsuario(claims, async (conexao) => {
      const { rows } = await conexao.query<{
        id: string;
        nome: string;
        situacao: string;
        ehAtivista: boolean;
      }>(
        `select p.id,
                coalesce(u.nome, a.nome) as nome,
                p.situacao::text as situacao,
                (p.id_ativista is not null) as "ehAtivista"
           from public.atividade_participantes p
           left join public.usuarios u on u.id = p.id_usuario
           left join public.ativistas a on a.id = p.id_ativista
          where p.id_atividade = $1
          order by coalesce(u.nome, a.nome)`,
        [idAtividade],
      );
      return rows;
    });
  }

  @Post(':id/participantes')
  @ExigePermissao('agenda.gerenciar')
  async incluirParticipante(
    @Claims() claims: ClaimsUsuario,
    @Param('id') id: string,
    @Body() corpo: unknown,
  ): Promise<{ id: string }> {
    const idAtividade = Uuid.parse(id);
    const entrada = EntradaParticipante.parse(corpo);

    return this.banco.executarComoUsuario(claims, async (conexao) => {
      // `id_campanha` vem da atividade, não do corpo: participante não pode
      // acabar numa campanha diferente da do evento.
      const { rows } = await conexao.query<{ id: string }>(
        `insert into public.atividade_participantes
           (id_organizacao, id_campanha, id_atividade, id_usuario, id_ativista, situacao, papel)
         select $1, a.id_campanha, a.id, $3, $4, $5::public.situacao_participante, $6
           from public.atividades a where a.id = $2
         on conflict do nothing
         returning id`,
        [
          claims.idOrganizacao,
          idAtividade,
          entrada.idUsuario ?? null,
          entrada.idAtivista ?? null,
          entrada.situacao,
          entrada.papel ?? null,
        ],
      );
      if (!rows[0]) {
        throw Object.assign(new Error('Atividade não encontrada ou participante já incluído.'), {
          code: '42501',
        });
      }
      return rows[0];
    });
  }

  /** Chamada de presença: o registro que a capacitação exige. */
  @Put('participantes/:idParticipante')
  @ExigePermissao('agenda.gerenciar')
  async registrarPresenca(
    @Claims() claims: ClaimsUsuario,
    @Param('idParticipante') idParticipante: string,
    @Body() corpo: unknown,
  ): Promise<{ alterado: boolean }> {
    const alvo = Uuid.parse(idParticipante);
    const entrada = z
      .object({
        situacao: SituacaoParticipante,
        justificativa: z.string().trim().max(200).optional(),
        emitirCertificado: z.boolean().default(false),
      })
      .parse(corpo);

    return this.banco.executarComoUsuario(claims, async (conexao) => {
      const resultado = await conexao.query(
        `update public.atividade_participantes
            set situacao = $2::public.situacao_participante,
                justificativa = coalesce($3, justificativa),
                -- Certificado só faz sentido para quem esteve presente.
                certificado_emitido_em = case
                  when $4 and $2 = 'PRESENTE' then coalesce(certificado_emitido_em, now())
                  else certificado_emitido_em
                end
          where id = $1`,
        [alvo, entrada.situacao, entrada.justificativa ?? null, entrada.emitirCertificado],
      );
      return { alterado: (resultado.rowCount ?? 0) > 0 };
    });
  }
}

@Module({
  controllers: [AgendaController],
  providers: [BancoService, AuditoriaService],
})
export class AgendaModule {}
