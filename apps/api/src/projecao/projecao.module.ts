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

@Controller('projecao')
class ProjecaoController {
  constructor(private readonly projecao: ProjecaoService) {}

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
