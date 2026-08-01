import { Injectable, Logger } from '@nestjs/common';
import type {
  ConectorExterno,
  ParametrosSincronizacao,
  ResultadoSincronizacao,
} from '@jeleitoral/tipos';
import { BancoService } from '../banco/banco.service.js';
import { carregarConfiguracao } from '../comum/configuracao.js';
import { ClienteHttp } from './clienteHttp.js';

interface RecursoCkan {
  id: string;
  name: string;
  format: string;
  url: string;
  last_modified: string | null;
}

interface RespostaPacoteCkan {
  success: boolean;
  result: { id: string; title: string; metadata_modified: string; resources: RecursoCkan[] };
}

/**
 * Conector do TSE Dados Abertos, via API CKAN.
 *
 * É a fonte PRIMÁRIA do sistema — decisão da Fase 0. O portal expõe CKAN em
 * `/api/3/action/package_show?id=<dataset>`, que lista os recursos com URL de
 * download direto. Descobrir o recurso pela API em vez de fixar a URL importa:
 * o TSE republica os arquivos e a URL muda.
 *
 * Datasets confirmados em 31/07/2026:
 *   • `eleitorado-2026`  — perfil do eleitorado por seção, um CSV POR UF
 *   • `candidatos-2026`  — candidatos, bens, coligações, vagas, redes sociais
 *   • `resultados-2022`  — resultados por seção, base do comparativo histórico
 *
 * Os CSVs do TSE são ISO-8859-1, separados por ponto e vírgula e com aspas em
 * todos os campos. Ler como UTF-8 corrompe todo acento — e "JOSÉ" viraria
 * "JOS?", quebrando a deduplicação por nome mais adiante.
 */
@Injectable()
export class ConectorTseDadosAbertos implements ConectorExterno {
  readonly identificador = 'TSE_DADOS_ABERTOS';
  private readonly registrador = new Logger(ConectorTseDadosAbertos.name);
  private readonly http: ClienteHttp;
  private readonly urlCkan: string;

  constructor(private readonly banco: BancoService) {
    const configuracao = carregarConfiguracao();
    this.urlCkan = configuracao.TSE_CKAN_URL_BASE;
    this.http = new ClienteHttp('TSE', {
      userAgent: configuracao.INTEGRACOES_USER_AGENT,
      requisicoesPorSegundo: 2,
      // Os arquivos são grandes; o tempo limite é do início da resposta, não do
      // download inteiro, mas ainda assim precisa de folga.
      tempoLimiteMs: 120_000,
    });
  }

  async verificarDisponibilidade(): Promise<boolean> {
    try {
      const resposta = await this.http.obterJson<{ success: boolean }>(
        `${this.urlCkan}/package_list`,
      );
      return resposta.success === true;
    } catch {
      return false;
    }
  }

  /** Lista os recursos de um dataset, com a data da última publicação. */
  async listarRecursos(dataset: string): Promise<RecursoCkan[]> {
    const resposta = await this.http.obterJson<RespostaPacoteCkan>(
      `${this.urlCkan}/package_show?id=${encodeURIComponent(dataset)}`,
    );
    if (!resposta.success) {
      throw new Error(`Dataset "${dataset}" não encontrado no portal do TSE.`);
    }
    return resposta.result.resources;
  }

  /**
   * Encontra o recurso de uma UF específica.
   *
   * Os nomes seguem o padrão "SP - Perfil do eleitorado por seção eleitoral -
   * 2026". Casamos pelo prefixo da sigla para evitar pegar o arquivo nacional
   * consolidado, que tem outro nome e outro layout.
   */
  private acharRecursoDaUf(recursos: RecursoCkan[], uf: string, trecho: string): RecursoCkan {
    const alvo = recursos.find(
      (recurso) =>
        recurso.name.toUpperCase().startsWith(`${uf.toUpperCase()} `) &&
        recurso.name.toLowerCase().includes(trecho.toLowerCase()),
    );
    if (!alvo) {
      throw new Error(
        `Recurso de ${uf} contendo "${trecho}" não encontrado. ` +
          `Recursos disponíveis: ${recursos.map((r) => r.name).join(' | ')}`,
      );
    }
    return alvo;
  }

  async sincronizar(parametros: ParametrosSincronizacao): Promise<ResultadoSincronizacao> {
    const iniciadoEm = new Date();
    const erros: string[] = [];
    let processados = 0;
    let inseridos = 0;

    if (!parametros.uf) {
      // Carga sob demanda por UF é a decisão da Fase 0: os resultados por seção
      // do Brasil inteiro passam de dezenas de GB e nenhuma campanha precisa
      // deles todos.
      return {
        fonte: this.identificador,
        sucesso: false,
        registrosProcessados: 0,
        registrosInseridos: 0,
        registrosAtualizados: 0,
        registrosIgnorados: 0,
        erros: ['Informe a UF: a carga do TSE é feita por estado, não nacional.'],
        iniciadoEm,
        finalizadoEm: new Date(),
      };
    }

    const ano = parametros.ano ?? 2026;

    try {
      const recursos = await this.listarRecursos(`eleitorado-${ano}`);
      const recurso = this.acharRecursoDaUf(recursos, parametros.uf, 'perfil do eleitorado');
      this.registrador.log(`Baixando "${recurso.name}" de ${recurso.url}…`);

      const linhas = await this.baixarCsv(recurso.url);
      processados = linhas.length;

      await this.banco.executarEmTabelasDeReferencia(async (conexao) => {
        for (const linha of linhas) {
          const numeroZona = Number(linha['NR_ZONA']);
          const numeroSecao = Number(linha['NR_SECAO']);
          const idMunicipio = Number(linha['CD_MUNICIPIO_IBGE'] ?? linha['CD_MUNICIPIO']);
          const totalEleitores = Number(linha['QT_ELEITORES_PERFIL'] ?? linha['QT_ELEITORES'] ?? 0);
          if (!numeroZona || !numeroSecao) continue;

          const { rows } = await conexao.query<{ id: string }>(
            `select s.id
               from public.secoes_eleitorais s
               join public.zonas_eleitorais z on z.id = s.id_zona
               join public.estados e on e.id_ibge = z.id_estado
              where e.sigla = $1 and z.numero = $2 and s.numero = $3
              limit 1`,
            [parametros.uf, numeroZona, numeroSecao],
          );
          const idSecao = rows[0]?.id;
          if (!idSecao) {
            // Seção ainda não carregada. Não é erro fatal: a carga de locais e
            // seções roda antes e pode estar defasada.
            continue;
          }

          await conexao.query(
            `insert into public.eleitorado_secao
               (id_secao, ano_referencia, total_eleitores, faixa_etaria, genero, escolaridade)
             values ($1, $2, $3, $4, $5, $6)
             on conflict (id_secao, ano_referencia) do update
               set total_eleitores = public.eleitorado_secao.total_eleitores + excluded.total_eleitores,
                   atualizado_em = now()`,
            [
              idSecao,
              ano,
              totalEleitores,
              JSON.stringify({
                [String(linha['DS_FAIXA_ETARIA'] ?? 'NAO_INFORMADO')]: totalEleitores,
              }),
              JSON.stringify({ [String(linha['DS_GENERO'] ?? 'NAO_INFORMADO')]: totalEleitores }),
              JSON.stringify({
                [String(linha['DS_GRAU_ESCOLARIDADE'] ?? 'NAO_INFORMADO')]: totalEleitores,
              }),
            ],
          );
          inseridos += 1;
          void idMunicipio;
        }
      });
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

  /**
   * Baixa e converte um CSV do TSE.
   *
   * Decodifica em ISO-8859-1 e separa por ponto e vírgula, retirando as aspas.
   * Implementação deliberadamente simples: os arquivos do TSE não usam ponto e
   * vírgula dentro de campo entre aspas, e uma biblioteca completa de CSV seria
   * peso morto para um formato tão previsível.
   */
  async baixarCsvPublico(url: string): Promise<Array<Record<string, string>>> {
    return this.baixarCsv(url);
  }

  private async baixarCsv(url: string): Promise<Array<Record<string, string>>> {
    const fluxo = await this.http.obterFluxo(url);
    const bytes = Buffer.from(await new Response(fluxo).arrayBuffer());
    const texto = new TextDecoder('iso-8859-1').decode(bytes);

    const linhas = texto.split(/\r?\n/).filter((linha) => linha.trim().length > 0);
    if (linhas.length < 2) return [];

    const separar = (linha: string): string[] =>
      linha.split(';').map((campo) => campo.replace(/^"|"$/g, '').trim());

    const cabecalho = separar(linhas[0]!);
    return linhas.slice(1).map((linha) => {
      const valores = separar(linha);
      const registro: Record<string, string> = {};
      cabecalho.forEach((coluna, indice) => {
        registro[coluna] = valores[indice] ?? '';
      });
      return registro;
    });
  }
}
