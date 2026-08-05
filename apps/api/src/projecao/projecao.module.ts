import { Body, Controller, Get, Module, Post, Query } from '@nestjs/common';
import { z } from 'zod';
import { ClaimsUsuario, NivelTerritorial, Uuid } from '@jeleitoral/tipos';
import { ExigePermissao } from '../autenticacao/autenticacao.guard.js';
import { Claims } from '../autenticacao/claimsUsuario.decorator.js';
import { BancoService } from '../banco/banco.service.js';
import { ProjecaoService } from './projecao.service.js';
import type { ResultadoProjecao } from './motorProjecao.js';

const EntradaRecalculo = z.object({
  idCampanha: Uuid,
  idCandidato: Uuid,
  idCargo: Uuid,
  idSecao: Uuid,
  anoReferencia: z.coerce.number().int().optional(),
});

const EntradaRecalculoCampanha = z.object({
  idCampanha: Uuid,
  /** Vazio recalcula a chapa inteira (os candidatos próprios). */
  idsCandidatos: z.array(Uuid).max(30).optional(),
  anoReferencia: z.coerce.number().int().optional(),
});

@Controller('projecao')
class ProjecaoController {
  constructor(private readonly projecao: ProjecaoService) {}

  /**
   * Recalcula a chapa inteira e agrega para bairro, zona e município.
   *
   * É esta rota que precisa rodar TODO DIA: ela é a única coisa que alimenta
   * `projecoes_diarias`, e sem série diária não há gráfico de tendência. Como
   * não existe fila neste sistema, por enquanto é o botão na tela de projeção —
   * e, assim que possível, um agendador externo batendo aqui.
   */
  @Post('recalcular')
  @ExigePermissao('projecao.gerenciar')
  async recalcularCampanha(
    @Claims() claims: ClaimsUsuario,
    @Body() corpo: unknown,
  ): Promise<{ candidatos: number; secoes: number; agregados: number; parcial: boolean }> {
    return this.projecao.recalcularCampanha(claims, EntradaRecalculoCampanha.parse(corpo));
  }

  @Post('secao')
  @ExigePermissao('projecao.gerenciar')
  async recalcular(
    @Claims() claims: ClaimsUsuario,
    @Body() corpo: unknown,
  ): Promise<ResultadoProjecao> {
    return this.projecao.recalcularSecao(claims, EntradaRecalculo.parse(corpo));
  }

  @Get()
  @ExigePermissao('projecao.ler')
  async listar(@Claims() claims: ClaimsUsuario, @Query() consulta: unknown): Promise<unknown[]> {
    const parametros = z
      .object({
        idCampanha: Uuid,
        idCandidato: Uuid,
        nivel: NivelTerritorial.optional(),
      })
      .parse(consulta);
    return this.projecao.listarProjecoes(claims, parametros);
  }
}

@Module({
  controllers: [ProjecaoController],
  providers: [BancoService, ProjecaoService],
  exports: [ProjecaoService],
})
export class ProjecaoModule {}
