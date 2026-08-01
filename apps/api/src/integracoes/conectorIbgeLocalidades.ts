import { Injectable, Logger } from '@nestjs/common';
import type {
  ConectorExterno,
  ParametrosSincronizacao,
  ResultadoSincronizacao,
} from '@jeleitoral/tipos';
import { BancoService } from '../banco/banco.service.js';
import { carregarConfiguracao } from '../comum/configuracao.js';
import { ClienteHttp } from './clienteHttp.js';

interface EstadoIbge {
  id: number;
  sigla: string;
  nome: string;
  regiao: { id: number; sigla: string; nome: string };
}

interface MunicipioIbge {
  id: number;
  nome: string;
  microrregiao?: {
    id: number;
    nome: string;
    mesorregiao?: { id: number; nome: string; UF?: { id: number; sigla: string } };
  } | null;
  // Municípios sem microrregião trazem a UF por este caminho alternativo.
  'regiao-imediata'?: {
    'regiao-intermediaria'?: { UF?: { id: number; sigla: string } };
  } | null;
}

interface DistritoIbge {
  id: number;
  nome: string;
  municipio: { id: number };
}

interface SubdistritoIbge {
  id: number;
  nome: string;
  distrito: { id: number };
}

/**
 * Conector do IBGE Localidades.
 *
 * Entrega UFs, municípios, distritos e subdistritos. **Não entrega bairros** —
 * a hierarquia da API para no subdistrito; a rota `/municipios/{id}/bairros`
 * responde 404 (verificado em 31/07/2026). Bairro no jEleitoral vem do cache de
 * CEP e do cadastro em campo, com curadoria.
 *
 * Escreve em tabelas de REFERÊNCIA, sem `id_organizacao` — dado público,
 * compartilhado por todos os clientes. É um dos poucos lugares em que
 * `executarEmTabelasDeReferencia` é legítimo.
 */
@Injectable()
export class ConectorIbgeLocalidades implements ConectorExterno {
  readonly identificador = 'IBGE_LOCALIDADES';
  private readonly registrador = new Logger(ConectorIbgeLocalidades.name);
  private readonly http: ClienteHttp;
  private readonly urlBase: string;

  constructor(private readonly banco: BancoService) {
    const configuracao = carregarConfiguracao();
    this.urlBase = configuracao.IBGE_URL_BASE;
    this.http = new ClienteHttp('IBGE', {
      userAgent: configuracao.INTEGRACOES_USER_AGENT,
      requisicoesPorSegundo: 5,
      tempoLimiteMs: 60_000,
    });
  }

  async verificarDisponibilidade(): Promise<boolean> {
    return this.http.verificarDisponibilidade(`${this.urlBase}/estados/35`);
  }

  /**
   * Sincroniza. Sem `uf` nos parâmetros, carrega o país inteiro (necessário só
   * na primeira carga); com `uf`, carrega apenas aquele estado — que é o modo
   * normal, dada a decisão de carga sob demanda por UF.
   */
  async sincronizar(parametros: ParametrosSincronizacao): Promise<ResultadoSincronizacao> {
    const iniciadoEm = new Date();
    const erros: string[] = [];
    let inseridos = 0;
    let atualizados = 0;

    try {
      const estados = await this.http.obterJson<EstadoIbge[]>(`${this.urlBase}/estados`);
      const estadosAlvo = parametros.uf
        ? estados.filter((estado) => estado.sigla === parametros.uf)
        : estados;

      if (parametros.uf && estadosAlvo.length === 0) {
        throw new Error(`UF ${parametros.uf} não encontrada no IBGE.`);
      }

      await this.banco.executarEmTabelasDeReferencia(async (conexao) => {
        for (const estado of estados) {
          const resultado = await conexao.query(
            `insert into public.estados (id_ibge, sigla, nome, regiao)
             values ($1, $2, $3, $4)
             on conflict (id_ibge) do update
               set sigla = excluded.sigla, nome = excluded.nome, regiao = excluded.regiao
             returning (xmax = 0) as inserido`,
            [estado.id, estado.sigla, estado.nome, estado.regiao.nome],
          );
          if (resultado.rows[0]?.inserido) inseridos += 1;
          else atualizados += 1;
        }

        for (const estado of estadosAlvo) {
          this.registrador.log(`Carregando municípios de ${estado.sigla}…`);
          const municipios = await this.http.obterJson<MunicipioIbge[]>(
            `${this.urlBase}/estados/${estado.id}/municipios`,
          );

          for (const municipio of municipios) {
            const micro = municipio.microrregiao;
            const resultado = await conexao.query(
              `insert into public.municipios
                 (id_ibge, id_estado, nome, id_microrregiao, nome_microrregiao,
                  id_mesorregiao, nome_mesorregiao)
               values ($1, $2, $3, $4, $5, $6, $7)
               on conflict (id_ibge) do update
                 set nome = excluded.nome,
                     id_microrregiao = excluded.id_microrregiao,
                     nome_microrregiao = excluded.nome_microrregiao,
                     id_mesorregiao = excluded.id_mesorregiao,
                     nome_mesorregiao = excluded.nome_mesorregiao
               returning (xmax = 0) as inserido`,
              [
                municipio.id,
                estado.id,
                municipio.nome,
                micro?.id ?? null,
                micro?.nome ?? null,
                micro?.mesorregiao?.id ?? null,
                micro?.mesorregiao?.nome ?? null,
              ],
            );
            if (resultado.rows[0]?.inserido) inseridos += 1;
            else atualizados += 1;
          }

          // Distritos e subdistritos vêm por UF numa tacada só — muito mais
          // barato do que uma chamada por município.
          const distritos = await this.http.obterJson<DistritoIbge[]>(
            `${this.urlBase}/estados/${estado.id}/distritos`,
          );
          for (const distrito of distritos) {
            await conexao.query(
              `insert into public.distritos (id_ibge, id_municipio, nome)
               values ($1, $2, $3)
               on conflict (id_ibge) do update set nome = excluded.nome`,
              [distrito.id, distrito.municipio.id, distrito.nome],
            );
            inseridos += 1;
          }

          try {
            const subdistritos = await this.http.obterJson<SubdistritoIbge[]>(
              `${this.urlBase}/estados/${estado.id}/subdistritos`,
            );
            for (const subdistrito of subdistritos) {
              await conexao.query(
                `insert into public.subdistritos (id_ibge, id_distrito, nome)
                 values ($1, $2, $3)
                 on conflict (id_ibge) do update set nome = excluded.nome`,
                [subdistrito.id, subdistrito.distrito.id, subdistrito.nome],
              );
              inseridos += 1;
            }
          } catch (erro) {
            // Nem toda UF tem subdistrito. Falhar aqui não invalida a carga.
            erros.push(`Subdistritos de ${estado.sigla}: ${String(erro)}`);
          }
        }
      });
    } catch (erro) {
      erros.push(String(erro));
    }

    return {
      fonte: this.identificador,
      sucesso: erros.length === 0,
      registrosProcessados: inseridos + atualizados,
      registrosInseridos: inseridos,
      registrosAtualizados: atualizados,
      registrosIgnorados: 0,
      erros,
      iniciadoEm,
      finalizadoEm: new Date(),
    };
  }
}
