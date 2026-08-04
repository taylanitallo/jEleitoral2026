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

/**
 * Renovação em voo, compartilhada por todas as requisições.
 *
 * Uma tela típica dispara três ou quatro chamadas de uma vez. Com o token
 * vencido, todas voltariam 401 juntas e cada uma pediria renovação — e o
 * Supabase invalida o token de renovação a cada uso, então a segunda chamada
 * derrubaria a sessão que a primeira acabou de restaurar. Guardar a promessa em
 * curso faz as concorrentes esperarem a mesma renovação.
 */
let renovacaoEmCurso: Promise<boolean> | null = null;

async function renovarSessao(): Promise<boolean> {
  renovacaoEmCurso ??= (async () => {
    try {
      const resposta = await fetch(`${URL_BASE}/api/autenticacao/renovar`, {
        method: 'POST',
        credentials: 'include',
      });
      return resposta.ok;
    } catch {
      return false;
    } finally {
      // Zera só depois de resolver, para que quem chegou durante a renovação
      // aguarde esta e não dispare outra.
      queueMicrotask(() => {
        renovacaoEmCurso = null;
      });
    }
  })();
  return renovacaoEmCurso;
}

async function requisitar<T>(
  caminho: string,
  opcoes: RequestInit = {},
  jaRenovou = false,
): Promise<T> {
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

    /*
     * 401 não significa mais "vá para o login".
     *
     * Duas causas distintas caem aqui e ambas se resolvem sem incomodar
     * ninguém: o token de acesso venceu (uma hora), ou as permissões mudaram e
     * a API marcou a sessão como desatualizada. Nos dois casos renovar
     * reexecuta o hook do Supabase, que remonta os claims a partir do banco.
     *
     * `jaRenovou` é o que impede o laço: se a requisição repetida também voltar
     * 401, o erro sobe e a tela manda para o login — que é o correto para quem
     * foi desativado, porque o hook devolve token sem claim nenhum e ele
     * continuará sendo recusado.
     *
     * A renovação NÃO tenta repetir requisições que mudam dado sem
     * idempotência: um POST que chegou ao banco e falhou depois seria enviado
     * duas vezes. Só o GET é repetido em silêncio; os demais sobem o erro e a
     * pessoa reenvia sabendo o que está fazendo.
     */
    if (resposta.status === 401 && !jaRenovou && !caminho.startsWith('/autenticacao/')) {
      const renovada = await renovarSessao();
      const ehLeitura = (opcoes.method ?? 'GET').toUpperCase() === 'GET';
      if (renovada && ehLeitura) return requisitar<T>(caminho, opcoes, true);
      if (renovada) {
        throw new ErroDaApi(409, {
          codigo: 'SESSAO_RENOVADA',
          mensagem: 'Sua sessão foi renovada. Confira os dados e envie de novo.',
          idCorrelacao: corpo?.idCorrelacao,
        });
      }
    }

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
