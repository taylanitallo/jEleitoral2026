import {
  type CallHandler,
  type ExecutionContext,
  Injectable,
  Logger,
  type NestInterceptor,
} from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import type { Request, Response } from 'express';
import { tap } from 'rxjs/operators';
import type { Observable } from 'rxjs';

/**
 * Identificador de correlação por requisição.
 *
 * Devolvido no cabeçalho e exibido na tela de erro. Quando o coordenador liga
 * dizendo "deu erro", o suporte pede esse código e acha a requisição exata no
 * log — em vez de vasculhar por horário aproximado numa base com dezenas de
 * campanhas.
 */
@Injectable()
export class InterceptorCorrelacao implements NestInterceptor {
  private readonly registrador = new Logger('Requisicao');

  intercept(contexto: ExecutionContext, proximo: CallHandler): Observable<unknown> {
    const requisicao = contexto.switchToHttp().getRequest<Request>();
    const resposta = contexto.switchToHttp().getResponse<Response>();

    const idCorrelacao =
      (requisicao.headers['x-id-correlacao'] as string | undefined) ?? randomUUID();
    requisicao.idCorrelacao = idCorrelacao;
    resposta.setHeader('x-id-correlacao', idCorrelacao);

    const inicio = Date.now();
    return proximo.handle().pipe(
      tap({
        next: () => this.registrarConclusao(requisicao, resposta, idCorrelacao, inicio),
        error: () => this.registrarConclusao(requisicao, resposta, idCorrelacao, inicio),
      }),
    );
  }

  private registrarConclusao(
    requisicao: Request,
    resposta: Response,
    idCorrelacao: string,
    inicio: number,
  ): void {
    // Log estruturado: sem dado pessoal, só o suficiente para diagnosticar.
    this.registrador.log(
      JSON.stringify({
        idCorrelacao,
        metodo: requisicao.method,
        rota: requisicao.route?.path ?? requisicao.url,
        status: resposta.statusCode,
        duracaoMs: Date.now() - inicio,
        idOrganizacao: requisicao.claims?.idOrganizacao ?? null,
      }),
    );
  }
}
