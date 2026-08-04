import { Injectable, Logger } from '@nestjs/common';
import type {
  ConectorExterno,
  ParametrosSincronizacao,
  ResultadoSincronizacao,
} from '@jeleitoral/tipos';
import { BancoService } from '../banco/banco.service.js';
import { carregarConfiguracao } from '../comum/configuracao.js';
import { ClienteHttp } from './clienteHttp.js';
import { escolherCsvDaUf, lerZip, pareceZip } from './lerZip.js';

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

      await this.banco.executarEmTabelasDeReferencia(async (conexao) => {
        // Cache de secao: sem ele, cada uma das milhoes de linhas faria a mesma
        // consulta de resolucao — o perfil traz varias linhas por secao, uma
        // por faixa etaria, genero e escolaridade.
        const secoesResolvidas = new Map<string, string | null>();

        processados = await this.percorrerCsv(recurso.url, parametros.uf, async (linha) => {
          const numeroZona = Number(linha['NR_ZONA']);
          const numeroSecao = Number(linha['NR_SECAO']);
          const idMunicipio = Number(linha['CD_MUNICIPIO_IBGE'] ?? linha['CD_MUNICIPIO']);
          const totalEleitores = Number(linha['QT_ELEITORES_PERFIL'] ?? linha['QT_ELEITORES'] ?? 0);
          // `return` e nao `continue`: isto agora e o corpo de um callback por
          // linha, e nao mais de um `for`.
          if (!numeroZona || !numeroSecao) return;

          const chaveSecao = `${numeroZona}:${numeroSecao}`;
          let idSecao = secoesResolvidas.get(chaveSecao);

          if (idSecao === undefined) {
            const { rows } = await conexao.query<{ id: string }>(
              `select s.id
                 from public.secoes_eleitorais s
                 join public.zonas_eleitorais z on z.id = s.id_zona
                 join public.estados e on e.id_ibge = z.id_estado
                where e.sigla = $1 and z.numero = $2 and s.numero = $3
                limit 1`,
              [parametros.uf, numeroZona, numeroSecao],
            );
            // Guarda tambem a ausencia: sem isso, secao inexistente seria
            // reconsultada em cada uma das dezenas de linhas de perfil dela.
            idSecao = rows[0]?.id ?? null;
            secoesResolvidas.set(chaveSecao, idSecao);
          }

          if (!idSecao) {
            // Seção ainda não carregada. Não é erro fatal: a carga de locais e
            // seções roda antes e pode estar defasada.
            return;
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
        });
      });
    } catch (erro) {
      erros.push(String(erro));
    }

    /*
     * Ler o arquivo inteiro e não gravar nada NÃO é sucesso.
     *
     * Antes desta guarda, a carga do Ceará devolveu "OK, 483.935 processados, 0
     * inseridos" — o conector tinha lido bytes de ZIP como texto e nenhuma
     * linha casou com seção nenhuma. Reportar sucesso ali é o pior desfecho
     * possível: a projeção fica sem denominador e o número que ela devolve
     * parece legítimo.
     */
    if (erros.length === 0 && processados > 0 && inseridos === 0) {
      erros.push(
        `${processados} linhas lidas e nenhuma gravada. O layout do arquivo mudou, ` +
          'ou as seções eleitorais desta UF ainda não foram carregadas.',
      );
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
  async baixarCsvPublico(url: string, uf?: string): Promise<Array<Record<string, string>>> {
    return this.baixarCsv(url, uf);
  }

  /**
   * Baixa e interpreta um recurso do TSE.
   *
   * O `uf` não é enfeite: os arquivos nacionais trazem um CSV por estado dentro
   * do mesmo ZIP, e sem ele a carga do Ceará traz a Bahia — a primeira entrada
   * em ordem alfabética.
   */
  /**
   * Percorre o CSV entregando um registro por vez.
   *
   * O perfil do eleitorado por secao do Ceara tem milhoes de linhas. Guardar
   * todas como objeto antes de gravar derruba o processo com heap out of
   * memory — e derruba depois de vinte minutos de download, o que torna cada
   * tentativa cara. Entregar por callback mantem o uso de memoria constante,
   * qualquer que seja o tamanho da UF.
   */
  private async percorrerCsv(
    url: string,
    uf: string | undefined,
    aoLer: (registro: Record<string, string>) => Promise<void> | void,
  ): Promise<number> {
    const conteudo = await this.obterConteudo(url, uf);
    const separar = (linha: string): string[] =>
      linha.split(';').map((campo) => campo.replace(/^"|"$/g, '').trim());

    let cabecalho: string[] | null = null;
    let inicio = 0;
    let lidos = 0;

    const processar = async (bruta: string): Promise<void> => {
      // Os arquivos do TSE usam CRLF; o corte e feito no LF e sobra o CR.
      const linha = bruta.endsWith('\r') ? bruta.slice(0, -1) : bruta;
      if (linha.trim().length === 0) return;
      if (!cabecalho) {
        cabecalho = separar(linha);
        return;
      }
      const valores = separar(linha);
      const registro: Record<string, string> = {};
      for (let i = 0; i < cabecalho.length; i += 1) registro[cabecalho[i]!] = valores[i] ?? '';
      lidos += 1;
      await aoLer(registro);
    };

    for (let i = 0; i < conteudo.length; i += 1) {
      if (conteudo[i] === 0x0a) {
        await processar(conteudo.toString('latin1', inicio, i));
        inicio = i + 1;
      }
    }
    if (inicio < conteudo.length) {
      await processar(conteudo.toString('latin1', inicio, conteudo.length));
    }
    return lidos;
  }

  /** Baixa o recurso e devolve o CSV ja descompactado, quando vier em ZIP. */
  private async obterConteudo(url: string, uf?: string): Promise<Buffer> {
    const fluxo = await this.http.obterFluxo(url);
    const bytes = Buffer.from(await new Response(fluxo).arrayBuffer());
    // O catalogo CKAN anuncia estes recursos como CSV, mas entrega ZIP. Decidir
    // pelos bytes evita depender de o TSE ser coerente.
    return pareceZip(bytes) ? escolherCsvDaUf(lerZip(bytes), uf ?? '').conteudo : bytes;
  }

  private async baixarCsv(url: string, uf?: string): Promise<Array<Record<string, string>>> {
    const fluxo = await this.http.obterFluxo(url);
    const bytes = Buffer.from(await new Response(fluxo).arrayBuffer());

    // O catálogo CKAN anuncia estes recursos como CSV, mas entrega ZIP. Decidir
    // pelos bytes, e não pela extensão da URL nem pelo `format` do catálogo, é o
    // que evita depender de o TSE ser coerente.
    const conteudo = pareceZip(bytes)
      ? escolherCsvDaUf(lerZip(bytes), uf ?? '').conteudo
      : bytes;

    /*
     * Percorre linha a linha sobre o Buffer, sem transformar o arquivo inteiro
     * em uma string.
     *
     * O perfil do eleitorado por seção do Ceará descompacta para mais de meio
     * gigabyte, e `TextDecoder.decode` do arquivo todo estoura o limite de
     * string do V8 com `Cannot create a string longer than 0x1fffffe8
     * characters`. O erro não menciona tamanho de arquivo nem UF, e some ao
     * testar com um estado pequeno — o que faria a carga funcionar em
     * homologação com SE e falhar em produção com SP.
     *
     * `latin1` no `toString` é o mesmo ISO-8859-1: byte a caractere, um para
     * um. Preservar isso importa porque "JOSÉ" lido como UTF-8 vira "JOS?" e
     * quebra a deduplicação por nome mais adiante.
     */
    const separar = (linha: string): string[] =>
      linha.split(';').map((campo) => campo.replace(/^"|"$/g, '').trim());

    const registros: Array<Record<string, string>> = [];
    let cabecalho: string[] | null = null;
    let inicio = 0;

    const processarLinha = (bruta: string): void => {
      const linha = bruta.endsWith('\r') ? bruta.slice(0, -1) : bruta;
      if (linha.trim().length === 0) return;

      if (!cabecalho) {
        cabecalho = separar(linha);
        return;
      }

      const valores = separar(linha);
      const registro: Record<string, string> = {};
      for (let i = 0; i < cabecalho.length; i += 1) {
        registro[cabecalho[i]!] = valores[i] ?? '';
      }
      registros.push(registro);
    };

    for (let i = 0; i < conteudo.length; i += 1) {
      if (conteudo[i] === 0x0a) {
        processarLinha(conteudo.toString('latin1', inicio, i));
        inicio = i + 1;
      }
    }
    // Arquivo que não termina em quebra de linha — comum quando é gerado por
    // exportação e não por editor.
    if (inicio < conteudo.length) {
      processarLinha(conteudo.toString('latin1', inicio, conteudo.length));
    }

    return registros;
  }
}
