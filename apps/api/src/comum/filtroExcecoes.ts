import {
  ArgumentsHost,
  Catch,
  type ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import { ZodError } from 'zod';
import type { ErroApi } from '@jeleitoral/tipos';

/** Códigos de erro do PostgreSQL que sabemos traduzir para o usuário. */
const CODIGOS_POSTGRES: Record<string, { status: number; mensagem: string }> = {
  '23505': { status: HttpStatus.CONFLICT, mensagem: 'Já existe um registro com esses dados.' },
  '23503': {
    status: HttpStatus.CONFLICT,
    mensagem: 'Existe um registro vinculado que impede esta operação.',
  },
  '23514': { status: HttpStatus.BAD_REQUEST, mensagem: 'Os dados informados não são válidos.' },
  // Violação de RLS. A mensagem é deliberadamente idêntica à de "não
  // encontrado": revelar que a linha existe em outra organização já é vazar
  // informação.
  '42501': {
    status: HttpStatus.NOT_FOUND,
    mensagem: 'Registro não encontrado.',
  },
};

/**
 * Filtro global de exceções.
 *
 * Duas regras: a mensagem que chega à tela é sempre em português e endereçada
 * ao operador; o detalhe técnico vai para o log com o `id_correlacao`, que o
 * usuário pode informar ao suporte. Vazar `stack trace` ou nome de tabela na
 * resposta é presente para quem estiver sondando o sistema.
 */
@Catch()
export class FiltroExcecoes implements ExceptionFilter {
  private readonly registrador = new Logger(FiltroExcecoes.name);

  catch(excecao: unknown, host: ArgumentsHost): void {
    const contexto = host.switchToHttp();
    const resposta = contexto.getResponse<Response>();
    const requisicao = contexto.getRequest<Request>();
    const idCorrelacao = requisicao.idCorrelacao ?? 'sem-correlacao';

    const { status, corpo } = this.traduzir(excecao, idCorrelacao);

    if (status >= 500) {
      this.registrador.error(
        `[${idCorrelacao}] ${requisicao.method} ${requisicao.url} — ${String(excecao)}`,
        excecao instanceof Error ? excecao.stack : undefined,
      );
    } else {
      this.registrador.warn(
        `[${idCorrelacao}] ${requisicao.method} ${requisicao.url} — ${corpo.mensagem}`,
      );
    }

    resposta.status(status).json(corpo);
  }

  private traduzir(excecao: unknown, idCorrelacao: string): { status: number; corpo: ErroApi } {
    if (excecao instanceof ZodError) {
      const detalhes: Record<string, string[]> = {};
      for (const problema of excecao.issues) {
        const campo = problema.path.join('.') || 'geral';
        detalhes[campo] = [...(detalhes[campo] ?? []), problema.message];
      }
      return {
        status: HttpStatus.BAD_REQUEST,
        corpo: {
          codigo: 'VALIDACAO',
          mensagem: 'Revise os campos destacados.',
          detalhes,
          idCorrelacao,
        },
      };
    }

    if (excecao instanceof HttpException) {
      const resposta = excecao.getResponse();
      const mensagem =
        typeof resposta === 'string'
          ? resposta
          : ((resposta as { message?: string | string[] }).message ?? excecao.message);
      return {
        status: excecao.getStatus(),
        corpo: {
          codigo: HttpStatus[excecao.getStatus()] ?? 'ERRO',
          mensagem: Array.isArray(mensagem) ? mensagem.join(' ') : mensagem,
          idCorrelacao,
        },
      };
    }

    const codigoPostgres = (excecao as { code?: string })?.code;
    if (codigoPostgres && CODIGOS_POSTGRES[codigoPostgres]) {
      const traducao = CODIGOS_POSTGRES[codigoPostgres];
      return {
        status: traducao.status,
        corpo: { codigo: `PG_${codigoPostgres}`, mensagem: traducao.mensagem, idCorrelacao },
      };
    }

    // Regras de negócio implementadas como `raise exception` no banco chegam
    // aqui com a mensagem já em português e já endereçada ao usuário.
    const mensagemPostgres = (excecao as { message?: string })?.message;
    if (codigoPostgres === 'P0001' && mensagemPostgres) {
      return {
        status: HttpStatus.UNPROCESSABLE_ENTITY,
        corpo: { codigo: 'REGRA_NEGOCIO', mensagem: mensagemPostgres, idCorrelacao },
      };
    }

    return {
      status: HttpStatus.INTERNAL_SERVER_ERROR,
      corpo: {
        codigo: 'ERRO_INTERNO',
        mensagem: 'Não foi possível concluir a operação. Tente novamente em instantes.',
        idCorrelacao,
      },
    };
  }
}
