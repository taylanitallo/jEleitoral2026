import { createParamDecorator, type ExecutionContext, UnauthorizedException } from '@nestjs/common';
import type { Request } from 'express';
import type { ClaimsUsuario } from '@jeleitoral/tipos';

/**
 * Injeta os claims do usuário autenticado no controller.
 *
 * Não existe caminho para o controller receber `idOrganizacao` por parâmetro de
 * rota, query string ou corpo. Se existisse, um cliente poderia se declarar de
 * outra organização — e ainda que a RLS o barrasse, a tentativa não deveria nem
 * ser expressável no código.
 */
export const Claims = createParamDecorator(
  (_dado: unknown, contexto: ExecutionContext): ClaimsUsuario => {
    const requisicao = contexto.switchToHttp().getRequest<Request>();
    if (!requisicao.claims) {
      throw new UnauthorizedException('Sessão não encontrada.');
    }
    return requisicao.claims;
  },
);

export const IdCorrelacao = createParamDecorator(
  (_dado: unknown, contexto: ExecutionContext): string =>
    contexto.switchToHttp().getRequest<Request>().idCorrelacao ?? 'sem-correlacao',
);
