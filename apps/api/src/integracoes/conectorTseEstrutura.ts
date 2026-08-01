import { Injectable, Logger } from '@nestjs/common';
import type {
  ConectorExterno,
  ParametrosSincronizacao,
  ResultadoSincronizacao,
} from '@jeleitoral/tipos';
import { BancoService } from '../banco/banco.service.js';
import { ConectorTseDadosAbertos } from './conectorTseDadosAbertos.js';

/**
 * Carga da estrutura eleitoral: zonas, locais de votação e seções.
 *
 * Vem do recurso "Eleitorado por local de votação" do dataset `eleitorado-2026`,
 * que traz, por UF, a lista de zonas, locais e seções com endereço e
 * coordenadas — é a única fonte pública que amarra as três coisas de uma vez.
 *
 * Roda antes do perfil do eleitorado por seção: aquele carrega totais e precisa
 * das seções já existirem para casar. A ordem está documentada aqui porque
 * inverter produz uma carga que "funciona" e não grava nada, silenciosamente.
 */
@Injectable()
export class ConectorTseEstrutura implements ConectorExterno {
  readonly identificador = 'TSE_ESTRUTURA';
  private readonly registrador = new Logger(ConectorTseEstrutura.name);

  constructor(
    private readonly banco: BancoService,
    private readonly ckan: ConectorTseDadosAbertos,
  ) {}

  async verificarDisponibilidade(): Promise<boolean> {
    return this.ckan.verificarDisponibilidade();
  }

  async sincronizar(parametros: ParametrosSincronizacao): Promise<ResultadoSincronizacao> {
    const iniciadoEm = new Date();
    const erros: string[] = [];
    let processados = 0;
    let inseridos = 0;

    if (!parametros.uf) {
      return this.resultadoVazio(iniciadoEm, [
        'Informe a UF: a estrutura eleitoral é carregada por estado.',
      ]);
    }

    const ano = parametros.ano ?? 2026;

    try {
      const recursos = await this.ckan.listarRecursos(`eleitorado-${ano}`);
      const recurso = recursos.find((item) =>
        item.name.toLowerCase().includes('eleitorado por local de votação'),
      );
      if (!recurso) {
        throw new Error(
          'Recurso "Eleitorado por local de votação" não encontrado no dataset. ' +
            `Disponíveis: ${recursos.map((r) => r.name).join(' | ')}`,
        );
      }

      this.registrador.log(`Carregando estrutura eleitoral de ${parametros.uf}…`);
      const linhas = await this.ckan.baixarCsvPublico(recurso.url);

      // Filtra a UF no cliente: o arquivo é nacional neste recurso específico.
      const daUf = linhas.filter((linha) => linha['SG_UF'] === parametros.uf);
      processados = daUf.length;

      if (daUf.length === 0) {
        throw new Error(
          `Nenhuma linha para ${parametros.uf}. O layout do arquivo pode ter mudado — ` +
            `colunas encontradas: ${Object.keys(linhas[0] ?? {}).join(', ')}`,
        );
      }

      await this.banco.executarEmTabelasDeReferencia(async (conexao) => {
        // Cache local para não consultar o banco a cada uma das dezenas de
        // milhares de linhas.
        const zonasCriadas = new Map<number, string>();
        const locaisCriados = new Map<string, string>();

        const { rows: estados } = await conexao.query<{ id_ibge: number }>(
          'select id_ibge from public.estados where sigla = $1',
          [parametros.uf],
        );
        const idEstado = estados[0]?.id_ibge;
        if (!idEstado) {
          throw new Error(
            `UF ${parametros.uf} não está carregada. Rode a sincronização do IBGE antes.`,
          );
        }

        for (const linha of daUf) {
          const numeroZona = Number(linha['NR_ZONA']);
          const numeroSecao = Number(linha['NR_SECAO']);
          const codigoLocal = Number(linha['NR_LOCAL_VOTACAO']);
          const idMunicipio = Number(linha['CD_MUNICIPIO_IBGE'] ?? 0);
          if (!numeroZona || !numeroSecao || !codigoLocal || !idMunicipio) continue;

          let idZona = zonasCriadas.get(numeroZona);
          if (!idZona) {
            const { rows } = await conexao.query<{ id: string }>(
              `insert into public.zonas_eleitorais (id_estado, numero, id_municipio_sede)
               values ($1, $2, $3)
               on conflict (id_estado, numero) do update set id_municipio_sede = excluded.id_municipio_sede
               returning id`,
              [idEstado, numeroZona, idMunicipio],
            );
            idZona = rows[0]!.id;
            zonasCriadas.set(numeroZona, idZona);
          }

          const chaveLocal = `${numeroZona}:${codigoLocal}`;
          let idLocal = locaisCriados.get(chaveLocal);
          if (!idLocal) {
            const { rows } = await conexao.query<{ id: string }>(
              `insert into public.locais_votacao
                 (id_zona, id_municipio, codigo, nome, endereco, bairro_declarado, cep,
                  latitude, longitude)
               values ($1, $2, $3, $4, $5, $6, $7, $8, $9)
               on conflict (id_zona, codigo) do update
                 set nome = excluded.nome, endereco = excluded.endereco,
                     latitude = coalesce(excluded.latitude, public.locais_votacao.latitude),
                     longitude = coalesce(excluded.longitude, public.locais_votacao.longitude)
               returning id`,
              [
                idZona,
                idMunicipio,
                codigoLocal,
                linha['NM_LOCAL_VOTACAO'] ?? `Local ${codigoLocal}`,
                linha['DS_ENDERECO'] ?? null,
                linha['NM_BAIRRO'] ?? null,
                (linha['NR_CEP'] ?? '').replace(/\D+/g, '') || null,
                numeroOuNulo(linha['NR_LATITUDE']),
                numeroOuNulo(linha['NR_LONGITUDE']),
              ],
            );
            idLocal = rows[0]!.id;
            locaisCriados.set(chaveLocal, idLocal);
          }

          await conexao.query(
            `insert into public.secoes_eleitorais
               (id_zona, id_local_votacao, id_municipio, numero)
             values ($1, $2, $3, $4)
             on conflict (id_zona, numero) do update
               set id_local_votacao = excluded.id_local_votacao`,
            [idZona, idLocal, idMunicipio, numeroSecao],
          );
          inseridos += 1;
        }

        this.registrador.log(
          `${parametros.uf}: ${zonasCriadas.size} zonas, ${locaisCriados.size} locais, ${inseridos} seções.`,
        );
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

  private resultadoVazio(iniciadoEm: Date, erros: string[]): ResultadoSincronizacao {
    return {
      fonte: this.identificador,
      sucesso: false,
      registrosProcessados: 0,
      registrosInseridos: 0,
      registrosAtualizados: 0,
      registrosIgnorados: 0,
      erros,
      iniciadoEm,
      finalizadoEm: new Date(),
    };
  }
}

/**
 * As coordenadas do TSE vêm com vírgula decimal e, quando ausentes, com o
 * literal "-1" em vez de vazio. Converter sem tratar isso colocaria todos os
 * locais de votação sem GPS no meio do Atlântico — e o antifraude passaria a
 * acusar GPS distante em massa.
 */
function numeroOuNulo(valor: string | undefined): number | null {
  if (!valor) return null;
  const numero = Number(valor.replace(',', '.'));
  if (!Number.isFinite(numero) || numero === -1 || numero === 0) return null;
  return numero;
}
