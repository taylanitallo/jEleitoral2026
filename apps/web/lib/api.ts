import type { ErroApi } from '@jeleitoral/tipos';

/**
 * Cliente da API.
 *
 * `credentials: 'include'` é obrigatório: a sessão vive em cookie HTTP-only,
 * `Secure`, `SameSite=Strict`. Não há token em `localStorage` — qualquer script
 * injetado o leria, e uma base de intenção de voto não é lugar para esse risco.
 */

// Mesma origem: o Next encaminha /api para a Railway (ver next.config.mjs).
// Assim o cookie de sessão é de primeira parte e o SameSite=Strict vale.
const URL_BASE = '';

export class ErroDaApi extends Error {
  constructor(
    readonly status: number,
    readonly corpo: ErroApi,
  ) {
    super(corpo.mensagem);
    this.name = 'ErroDaApi';
  }

  /** Distingue "sem rede" de "servidor recusou" — a tela reage diferente. */
  get semConexao(): boolean {
    return this.status === 0;
  }
}

async function requisitar<T>(caminho: string, opcoes: RequestInit = {}): Promise<T> {
  let resposta: Response;
  try {
    resposta = await fetch(`${URL_BASE}/api${caminho}`, {
      ...opcoes,
      credentials: 'include',
      headers: {
        'Content-Type': 'application/json',
        ...(opcoes.headers ?? {}),
      },
    });
  } catch (erro) {
    throw new ErroDaApi(0, {
      codigo: 'SEM_CONEXAO',
      mensagem: 'Sem conexão. O que você preencher fica salvo no aparelho.',
      idCorrelacao: undefined,
    });
  }

  if (!resposta.ok) {
    const corpo = (await resposta.json().catch(() => null)) as ErroApi | null;
    throw new ErroDaApi(
      resposta.status,
      corpo ?? {
        codigo: 'ERRO',
        mensagem: 'Não foi possível concluir a operação.',
        idCorrelacao: resposta.headers.get('x-id-correlacao') ?? undefined,
      },
    );
  }

  if (resposta.status === 204) return undefined as T;
  return (await resposta.json()) as T;
}

export const api = {
  obter: <T>(caminho: string): Promise<T> => requisitar<T>(caminho),
  enviar: <T>(caminho: string, corpo: unknown): Promise<T> =>
    requisitar<T>(caminho, { method: 'POST', body: JSON.stringify(corpo) }),
  atualizar: <T>(caminho: string, corpo: unknown): Promise<T> =>
    requisitar<T>(caminho, { method: 'PUT', body: JSON.stringify(corpo) }),
  excluir: <T>(caminho: string): Promise<T> => requisitar<T>(caminho, { method: 'DELETE' }),
};
