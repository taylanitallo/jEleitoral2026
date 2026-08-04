import { Body, Controller, Get, Module, Post } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { z } from 'zod';
import { ClaimsUsuario, Uuid } from '@jeleitoral/tipos';
import { ExigePermissao } from '../autenticacao/autenticacao.guard.js';
import { Claims } from '../autenticacao/claimsUsuario.decorator.js';
import { BancoService } from '../banco/banco.service.js';
import { IaService } from './ia.service.js';

const EntradaDiagnostico = z.object({
  idCampanha: Uuid,
  agregados: z.record(z.string(), z.unknown()),
  coberturaAmostral: z.number().min(0).max(1),
});

const EntradaRevisao = z.object({
  idCampanha: Uuid,
  texto: z.string().trim().min(10).max(4000),
});

const EntradaEixos = z.object({
  idCampanha: Uuid,
  agregado: z.record(z.unknown()),
  coberturaAmostral: z.coerce.number().min(0).max(1),
});

const EntradaConsulta = z.object({
  idCampanha: Uuid,
  pergunta: z.string().trim().min(5).max(500),
});

/**
 * Endpoints de IA.
 *
 * Limite próprio e mais apertado que o global: uma chamada de diagnóstico custa
 * ordens de grandeza mais que uma listagem, e um laço acidental no front
 * queimaria o crédito da campanha antes de alguém perceber.
 */
@Controller('ia')
@Throttle({ curta: { limit: 2, ttl: 1000 }, longa: { limit: 30, ttl: 60_000 } })
class IaController {
  constructor(private readonly ia: IaService) {}

  @Post('diagnostico')
  @ExigePermissao('ia.usar')
  async diagnosticar(@Claims() claims: ClaimsUsuario, @Body() corpo: unknown): Promise<unknown> {
    return this.ia.diagnosticar(claims, EntradaDiagnostico.parse(corpo));
  }

  @Post('revisar-texto')
  @ExigePermissao('ia.usar')
  async revisar(@Claims() claims: ClaimsUsuario, @Body() corpo: unknown): Promise<unknown> {
    return this.ia.revisarTexto(claims, EntradaRevisao.parse(corpo));
  }

  @Post('consulta')
  @ExigePermissao('ia.usar')
  async consultar(@Claims() claims: ClaimsUsuario, @Body() corpo: unknown): Promise<unknown> {
    return this.ia.interpretarConsulta(claims, EntradaConsulta.parse(corpo));
  }

  /**
   * Consumo e custo da IA no mes corrente.
   *
   * Existe porque o limite de creditos passou a valer de verdade: um teto que
   * corta a chamada sem que ninguem consiga ver quanto ja se gastou produz
   * chamado de suporte, nao economia. O `sucesso = false` aparece separado —
   * chamada que falhou tambem consome, e some do relatorio quem so soma o que
   * deu certo.
   */
  @Post('eixos-narrativos')
  @ExigePermissao('planejamento.gerenciar')
  async eixos(@Claims() claims: ClaimsUsuario, @Body() corpo: unknown): Promise<unknown> {
    return this.ia.sugerirEixosNarrativos(claims, EntradaEixos.parse(corpo));
  }

  @Get('uso')
  @ExigePermissao('ia.usar')
  async uso(@Claims() claims: ClaimsUsuario): Promise<unknown> {
    return this.ia.resumoDeUso(claims);
  }
}

@Module({
  controllers: [IaController],
  providers: [BancoService, IaService],
  exports: [IaService],
})
export class IaModule {}
