import { Injectable, Logger } from '@nestjs/common';
import type {
  ConectorExterno,
  ParametrosSincronizacao,
  ResultadoSincronizacao,
} from '@jeleitoral/tipos';
import { carregarConfiguracao } from '../comum/configuracao.js';
import { ClienteHttp } from './clienteHttp.js';

interface CandidatoDivulga {
  id: number;
  nomeUrna: string;
  nomeCompleto: string;
  numero: number;
  partido: { sigla: string; numero: number };
  fotoUrl?: string;
  descricaoSituacao?: string;
}

interface RespostaCandidatos {
  candidatos: CandidatoDivulga[];
}

/**
 * Conector do DivulgaCandContas.
 *
 * **Fonte complementar, não primária.** A API não é oficial nem documentada, e
 * o contrato muda sem aviso — em 31/07/2026, `/candidatura/listar/{ano}/{UF}/
 * {codEleicao}/{cargo}/candidatos` respondia 200 com dados reais, enquanto
 * `/eleicao/eleicoes-anos` retornava 404 e `/eleicao/eleicao-atual` retornava
 * 400. Por isso a carga de candidatos vem do CSV oficial (CKAN) e este conector
 * serve só para foto e detalhe individual sob demanda.
 *
 * Regras de convivência, todas obrigatórias: fila serializada em 1 req/s,
 * `User-Agent` identificado, backoff exponencial, cache de 24h e **modo
 * degradado** — se cair, o sistema continua com o que já sincronizou. Uma
 * campanha não pode parar porque um serviço não oficial saiu do ar.
 */
@Injectable()
export class ConectorDivulgaCand implements ConectorExterno {
  readonly identificador = 'DIVULGACAND';
  private readonly registrador = new Logger(ConectorDivulgaCand.name);
  private readonly http: ClienteHttp;
  private readonly urlBase: string;
  /** Cache em memória de 24h. Reduz a pressão sobre um serviço frágil. */
  private readonly cache = new Map<string, { valor: unknown; expiraEm: number }>();
  private static readonly VALIDADE_CACHE_MS = 24 * 60 * 60 * 1000;

  constructor() {
    const configuracao = carregarConfiguracao();
    this.urlBase = configuracao.DIVULGACAND_URL_BASE;
    this.http = new ClienteHttp('DivulgaCand', {
      userAgent: configuracao.INTEGRACOES_USER_AGENT,
      requisicoesPorSegundo: configuracao.DIVULGACAND_REQ_POR_SEGUNDO,
      tentativasMaximas: 3,
      tempoLimiteMs: 25_000,
    });
  }

  async verificarDisponibilidade(): Promise<boolean> {
    // Sonda com uma consulta histórica conhecida: é o único endpoint cujo
    // formato se manteve estável entre as verificações.
    return this.http.verificarDisponibilidade(
      `${this.urlBase}/candidatura/listar/2022/BR/544/1/candidatos`,
    );
  }

  /**
   * Candidatos de um cargo numa UF. `codigoEleicao` varia por pleito e precisa
   * ser descoberto/configurado — não há endpoint estável para consultá-lo.
   */
  async listarCandidatos(
    ano: number,
    uf: string,
    codigoEleicao: number,
    codigoCargo: number,
  ): Promise<CandidatoDivulga[]> {
    const chave = `${ano}/${uf}/${codigoEleicao}/${codigoCargo}`;
    const emCache = this.cache.get(chave);
    if (emCache && emCache.expiraEm > Date.now()) {
      return emCache.valor as CandidatoDivulga[];
    }

    try {
      const resposta = await this.http.obterJson<RespostaCandidatos>(
        `${this.urlBase}/candidatura/listar/${ano}/${uf}/${codigoEleicao}/${codigoCargo}/candidatos`,
      );
      const candidatos = resposta.candidatos ?? [];
      this.cache.set(chave, {
        valor: candidatos,
        expiraEm: Date.now() + ConectorDivulgaCand.VALIDADE_CACHE_MS,
      });
      return candidatos;
    } catch (erro) {
      // Modo degradado: devolve o cache vencido se houver, em vez de falhar.
      if (emCache) {
        this.registrador.warn(
          `DivulgaCandContas indisponível; usando cache vencido de ${chave}: ${String(erro)}`,
        );
        return emCache.valor as CandidatoDivulga[];
      }
      throw erro;
    }
  }

  async sincronizar(parametros: ParametrosSincronizacao): Promise<ResultadoSincronizacao> {
    const iniciadoEm = new Date();
    const disponivel = await this.verificarDisponibilidade();
    return {
      fonte: this.identificador,
      sucesso: disponivel,
      registrosProcessados: 0,
      registrosInseridos: 0,
      registrosAtualizados: 0,
      registrosIgnorados: 0,
      erros: disponivel
        ? []
        : [
            'DivulgaCandContas indisponível. A base de candidatos segue válida — ' +
              'a fonte primária é o CSV do TSE Dados Abertos.',
          ],
      iniciadoEm,
      finalizadoEm: new Date(),
    };
    void parametros;
  }
}
