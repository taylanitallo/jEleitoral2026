import { createHash } from 'node:crypto';
import { Injectable, Logger } from '@nestjs/common';
import type {
  ConectorExterno,
  ParametrosSincronizacao,
  ResultadoSincronizacao,
} from '@jeleitoral/tipos';
import { BancoService } from '../banco/banco.service.js';
import { carregarConfiguracao } from '../comum/configuracao.js';
import { analisarBoletim } from './analisarBoletim.js';
import { ClienteHttp } from './clienteHttp.js';

/**
 * Apuração ao vivo — o único canal genuinamente em tempo real do sistema, e o
 * único que funciona por poucas horas por ano.
 *
 * **Estado honesto deste arquivo:** o layout dos arquivos de divulgação de 2026
 * só é publicado pelo TSE às vésperas do pleito, e a URL de distribuição
 * também. O que está aqui é a estrutura — flag, poller, idempotência,
 * publicação em tempo real — com um parser que precisa ser confrontado com o
 * arquivo real assim que ele existir. `analisarBoletim` está isolada e
 * documentada justamente para ser a única peça a mudar nesse momento.
 *
 * Fica **desligado por flag**. Um poller batendo no TSE fora da noite de
 * apuração é ruído para eles e risco de bloqueio de IP para nós.
 */
@Injectable()
export class ConectorResultadosAoVivo implements ConectorExterno {
  readonly identificador = 'RESULTADOS_AO_VIVO';
  private readonly registrador = new Logger(ConectorResultadosAoVivo.name);
  private readonly http: ClienteHttp;
  private readonly habilitado: boolean;
  private readonly urlBase: string | undefined;
  private readonly intervaloSegundos: number;
  private temporizador: NodeJS.Timeout | null = null;

  constructor(private readonly banco: BancoService) {
    const configuracao = carregarConfiguracao();
    this.habilitado = configuracao.APURACAO_AO_VIVO_HABILITADA;
    this.urlBase = configuracao.APURACAO_URL_BASE;
    this.intervaloSegundos = configuracao.APURACAO_INTERVALO_SEGUNDOS;
    this.http = new ClienteHttp('ApuracaoAoVivo', {
      userAgent: configuracao.INTEGRACOES_USER_AGENT,
      // Um arquivo a cada 2 segundos, no máximo. Na noite da apuração o TSE
      // está sob a maior carga do ciclo eleitoral inteiro; sermos gentis não é
      // cortesia, é o que mantém nosso acesso.
      requisicoesPorSegundo: 0.5,
      tentativasMaximas: 2,
      tempoLimiteMs: 20_000,
    });
  }

  async verificarDisponibilidade(): Promise<boolean> {
    if (!this.habilitado || !this.urlBase) return false;
    return this.http.verificarDisponibilidade(this.urlBase);
  }

  /**
   * Liga o poller. Idempotente: chamar duas vezes não cria dois temporizadores.
   */
  iniciarPoller(uf: string, ano = 2026, turno = 1): void {
    if (!this.habilitado) {
      this.registrador.log('Apuração ao vivo desligada por configuração — poller não iniciado.');
      return;
    }
    if (this.temporizador) return;

    this.registrador.log(`Poller de apuração iniciado para ${uf} (${ano}, ${turno}º turno).`);
    this.temporizador = setInterval(() => {
      void this.sincronizar({ uf, ano, turno, forcarRecarga: false }).catch((erro) => {
        // Uma falha de rede na noite da apuração não pode derrubar o processo:
        // registra e tenta de novo no próximo ciclo.
        this.registrador.warn(`Ciclo de apuração falhou: ${String(erro)}`);
      });
    }, this.intervaloSegundos * 1000);
  }

  pararPoller(): void {
    if (this.temporizador) {
      clearInterval(this.temporizador);
      this.temporizador = null;
      this.registrador.log('Poller de apuração encerrado.');
    }
  }

  async sincronizar(parametros: ParametrosSincronizacao): Promise<ResultadoSincronizacao> {
    const iniciadoEm = new Date();
    const erros: string[] = [];
    let processados = 0;
    let inseridos = 0;

    if (!this.habilitado || !this.urlBase || !parametros.uf) {
      return {
        fonte: this.identificador,
        sucesso: false,
        registrosProcessados: 0,
        registrosInseridos: 0,
        registrosAtualizados: 0,
        registrosIgnorados: 0,
        erros: [
          !this.habilitado
            ? 'Apuração ao vivo desligada. Ative APURACAO_AO_VIVO_HABILITADA na noite do pleito.'
            : 'Informe a UF e configure APURACAO_URL_BASE.',
        ],
        iniciadoEm,
        finalizadoEm: new Date(),
      };
    }

    const ano = parametros.ano ?? 2026;
    const turno = parametros.turno ?? 1;

    try {
      const conteudo = await this.http.obterTexto(
        `${this.urlBase}/${ano}/${parametros.uf}/${turno}/ea20.txt`,
      );
      // Hash do arquivo inteiro: se nada mudou desde o último ciclo, não há o
      // que reprocessar. Numa apuração de 2 mil seções isso corta a maior parte
      // dos ciclos.
      const hash = createHash('sha256').update(conteudo).digest('hex');

      const boletins = analisarBoletim(conteudo);
      processados = boletins.length;

      await this.banco.executarEmTabelasDeReferencia(async (conexao) => {
        for (const boletim of boletins) {
          const { rowCount } = await conexao.query(
            `insert into public.boletins_apuracao
               (ano, turno, uf, codigo_cargo, arquivo_origem, hash_arquivo, conteudo)
             values ($1, $2, $3, $4, $5, $6, $7)
             on conflict (hash_arquivo, codigo_cargo) do nothing`,
            [
              ano,
              turno,
              parametros.uf,
              boletim.codigoCargo,
              'ea20',
              `${hash}:${boletim.numeroSecao}`,
              JSON.stringify(boletim),
            ],
          );
          if ((rowCount ?? 0) > 0) inseridos += 1;
        }
      });

      if (inseridos > 0) {
        this.registrador.log(`Apuração: ${inseridos} boletim(ns) novo(s) em ${parametros.uf}.`);
      }
    } catch (erro) {
      erros.push(String(erro));
    }

    return {
      fonte: this.identificador,
      sucesso: erros.length === 0,
      registrosProcessados: processados,
      registrosInseridos: inseridos,
      registrosAtualizados: 0,
      registrosIgnorados: processados - inseridos,
      erros,
      iniciadoEm,
      finalizadoEm: new Date(),
    };
  }
}
