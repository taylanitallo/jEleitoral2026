import { Body, Controller, Get, Post, Query, Req } from '@nestjs/common';
import type { Request } from 'express';
import { z } from 'zod';
import {
  ClaimsUsuario,
  LoteSincronizacaoOffline,
  Uuid,
  type ResultadoItemSincronizacao,
} from '@jeleitoral/tipos';
import { ExigePermissao } from '../autenticacao/autenticacao.guard.js';
import { Claims } from '../autenticacao/claimsUsuario.decorator.js';
import { AuditoriaService } from '../auditoria/auditoria.service.js';
import { BancoService } from '../banco/banco.service.js';
import { SincronizacaoOfflineService } from './sincronizacaoOffline.service.js';

const ConsultaDuplicidade = z.object({
  idCampanha: Uuid,
  nome: z.string().trim().min(3),
  idDomicilio: Uuid.optional(),
});

@Controller('campo')
export class CampoController {
  constructor(
    private readonly banco: BancoService,
    private readonly auditoria: AuditoriaService,
    private readonly sincronizacao: SincronizacaoOfflineService,
  ) {}

  /**
   * Recebe a fila offline. Idempotente por `idLocalOffline`: o aparelho pode
   * reenviar o mesmo lote até receber confirmação, sem risco de duplicar.
   */
  @Post('sincronizar')
  @ExigePermissao('campo.gerenciar')
  async sincronizarOffline(
    @Claims() claims: ClaimsUsuario,
    @Body() corpo: unknown,
    @Req() requisicao: Request,
  ): Promise<{ resultados: ResultadoItemSincronizacao[]; resumo: Record<string, number> }> {
    const lote = LoteSincronizacaoOffline.parse(corpo);
    const resultados = await this.sincronizacao.sincronizar(claims, lote);

    const resumo = resultados.reduce<Record<string, number>>((contagem, item) => {
      contagem[item.situacao] = (contagem[item.situacao] ?? 0) + 1;
      return contagem;
    }, {});

    await this.auditoria.registrar(claims, {
      acao: 'CRIAR',
      entidade: 'entrevistas',
      idCampanha: lote.idCampanha,
      quantidadeRegistros: resumo['CRIADA'] ?? 0,
      dadosDepois: resumo,
      ip: requisicao.ip ?? null,
      userAgent: requisicao.headers['user-agent'] ?? null,
      idCorrelacao: requisicao.idCorrelacao ?? null,
    });

    return { resultados, resumo };
  }

  /**
   * Sugere entrevistados parecidos antes de gravar um novo.
   *
   * Chamado enquanto o entrevistador digita o nome, na porta da casa. Combina
   * similaridade de nome com coincidência de domicílio: nome parecido em outro
   * bairro provavelmente é outra pessoa; na mesma casa, é quase certamente a
   * mesma. Sem isso, a mesma dona Maria entra três vezes e a projeção da seção
   * infla.
   */
  @Get('entrevistados/duplicidade')
  @ExigePermissao('campo.ler')
  async verificarDuplicidade(
    @Claims() claims: ClaimsUsuario,
    @Query() consulta: unknown,
  ): Promise<
    Array<{ id: string; nome: string; apelido: string | null; mesmoDomicilio: boolean; similaridade: number }>
  > {
    const parametros = ConsultaDuplicidade.parse(consulta);
    return this.banco.executarComoUsuario(claims, async (conexao) => {
      const { rows } = await conexao.query(
        'select * from public.sugerir_entrevistados_similares($1, $2, $3)',
        [parametros.idCampanha, parametros.nome, parametros.idDomicilio ?? null],
      );
      return rows.map((linha) => ({
        id: linha.id,
        nome: linha.nome,
        apelido: linha.apelido,
        mesmoDomicilio: linha.mesmo_domicilio,
        similaridade: Number(linha.similaridade),
      }));
    });
  }

  /**
   * Painel de qualidade da coleta. Alertas pendentes de revisão, do mais grave
   * para o mais recente — a fila de trabalho do coordenador.
   */
  @Get('qualidade/alertas')
  @ExigePermissao('qualidade.ler')
  async listarAlertas(
    @Claims() claims: ClaimsUsuario,
    @Query('idCampanha') idCampanha: string,
  ): Promise<unknown[]> {
    const campanha = Uuid.parse(idCampanha);
    return this.banco.executarComoUsuario(claims, async (conexao) => {
      const { rows } = await conexao.query(
        `select a.id, a.tipo, a.gravidade, a.detalhe, a.criado_em,
                a.id_entrevista, u.nome as entrevistador
           from public.alertas_coleta a
           join public.usuarios u on u.id = a.id_usuario_avaliado
          where a.id_campanha = $1 and a.revisado_em is null
          order by a.gravidade desc, a.criado_em desc
          limit 200`,
        [campanha],
      );
      return rows;
    });
  }
}
