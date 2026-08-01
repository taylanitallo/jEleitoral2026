import { Logger } from '@nestjs/common';

/**
 * Cliente HTTP dos conectores externos.
 *
 * Três comportamentos não negociáveis, todos por boa conduta com serviços
 * públicos que não nos devem nada:
 *
 *  • `User-Agent` identificável, com contato. Se estivermos causando problema,
 *    queremos ser avisados antes de sermos bloqueados.
 *  • Limite de requisições por segundo, serializado. O DivulgaCandContas é uma
 *    API não oficial; martelá-la em paralelo é a forma mais rápida de perder o
 *    acesso para todos os clientes ao mesmo tempo.
 *  • Backoff exponencial com teto. Erro 5xx e 429 são retentados; 4xx não —
 *    insistir num 404 é só ruído.
 */
export interface OpcoesClienteHttp {
  userAgent: string;
  requisicoesPorSegundo?: number;
  tentativasMaximas?: number;
  tempoLimiteMs?: number;
}

export class ClienteHttp {
  private readonly registrador: Logger;
  private readonly intervaloMinimoMs: number;
  private readonly tentativasMaximas: number;
  private readonly tempoLimiteMs: number;
  /** Fila serializada: garante o intervalo mínimo mesmo com chamadas concorrentes. */
  private ultimaChamada = Promise.resolve();

  constructor(
    private readonly nome: string,
    private readonly opcoes: OpcoesClienteHttp,
  ) {
    this.registrador = new Logger(`ClienteHttp:${nome}`);
    this.intervaloMinimoMs = opcoes.requisicoesPorSegundo
      ? Math.ceil(1000 / opcoes.requisicoesPorSegundo)
      : 0;
    this.tentativasMaximas = opcoes.tentativasMaximas ?? 3;
    this.tempoLimiteMs = opcoes.tempoLimiteMs ?? 30_000;
  }

  async obterJson<T>(url: string): Promise<T> {
    const resposta = await this.requisitar(url);
    return (await resposta.json()) as T;
  }

  async obterTexto(url: string): Promise<string> {
    const resposta = await this.requisitar(url);
    return resposta.text();
  }

  /** Corpo em streaming, para os ZIP/CSV de centenas de MB do TSE. */
  async obterFluxo(url: string): Promise<ReadableStream<Uint8Array>> {
    const resposta = await this.requisitar(url);
    if (!resposta.body) {
      throw new Error(`Resposta sem corpo em ${url}.`);
    }
    return resposta.body;
  }

  async verificarDisponibilidade(url: string): Promise<boolean> {
    try {
      const resposta = await this.requisitar(url, { tentativas: 1 });
      return resposta.ok;
    } catch {
      return false;
    }
  }

  private async requisitar(url: string, opcoes: { tentativas?: number } = {}): Promise<Response> {
    const tentativas = opcoes.tentativas ?? this.tentativasMaximas;
    let ultimoErro: unknown;

    for (let tentativa = 1; tentativa <= tentativas; tentativa += 1) {
      await this.aguardarVezNaFila();
      try {
        const resposta = await fetch(url, {
          headers: { 'User-Agent': this.opcoes.userAgent, Accept: 'application/json, */*' },
          signal: AbortSignal.timeout(this.tempoLimiteMs),
        });

        if (resposta.ok) return resposta;

        // 4xx que não seja 429 não melhora com repetição.
        if (resposta.status < 500 && resposta.status !== 429) {
          throw new Error(`${this.nome} respondeu HTTP ${resposta.status} em ${url}.`);
        }
        ultimoErro = new Error(`${this.nome} respondeu HTTP ${resposta.status}.`);
      } catch (erro) {
        ultimoErro = erro;
        if (erro instanceof Error && erro.message.includes('respondeu HTTP 4')) throw erro;
      }

      if (tentativa < tentativas) {
        const esperaMs = Math.min(30_000, 2 ** (tentativa - 1) * 1000 + Math.random() * 500);
        this.registrador.warn(
          `Tentativa ${tentativa}/${tentativas} falhou em ${url}. Nova tentativa em ${Math.round(esperaMs)}ms.`,
        );
        await new Promise((resolver) => setTimeout(resolver, esperaMs));
      }
    }

    throw new Error(
      `${this.nome} indisponível após ${tentativas} tentativas: ${String(ultimoErro)}`,
    );
  }

  /** Encadeia as chamadas para respeitar o intervalo mínimo entre elas. */
  private aguardarVezNaFila(): Promise<void> {
    if (this.intervaloMinimoMs === 0) return Promise.resolve();
    const minhaVez = this.ultimaChamada.then(
      () => new Promise<void>((resolver) => setTimeout(resolver, this.intervaloMinimoMs)),
    );
    this.ultimaChamada = minhaVez.catch(() => undefined);
    return minhaVez;
  }
}
