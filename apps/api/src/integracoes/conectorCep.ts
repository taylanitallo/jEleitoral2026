import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import type { ConectorExterno, ResultadoSincronizacao } from '@jeleitoral/tipos';
import { BancoService } from '../banco/banco.service.js';
import { carregarConfiguracao } from '../comum/configuracao.js';
import { ClienteHttp } from './clienteHttp.js';

export interface EnderecoPorCep {
  cep: string;
  logradouro: string | null;
  complemento: string | null;
  bairro: string | null;
  nomeMunicipio: string | null;
  idMunicipio: number | null;
  uf: string | null;
  latitude: number | null;
  longitude: number | null;
  fonte: 'CACHE' | 'BRASILAPI' | 'VIACEP';
}

interface RespostaBrasilApi {
  cep: string;
  state: string;
  city: string;
  neighborhood: string | null;
  street: string | null;
  location?: { coordinates?: { latitude?: string; longitude?: string } };
}

interface RespostaViaCep {
  cep: string;
  logradouro: string;
  complemento: string;
  bairro: string;
  localidade: string;
  uf: string;
  ibge: string;
  erro?: boolean | string;
}

/**
 * Consulta de CEP com cache permanente e dupla fonte.
 *
 * A ordem é: cache → BrasilAPI → ViaCEP. O cache não expira porque CEP não
 * muda de endereço com frequência relevante para uma campanha, e porque a
 * consulta de um cliente aproveita para todos — em campo, o mesmo CEP é
 * digitado dezenas de vezes por dia.
 *
 * O fallback existe porque as duas fontes são gratuitas e caem. Com as duas
 * fora do ar, o entrevistador ainda digita o endereço à mão: o CEP é
 * conveniência, não dependência.
 */
@Injectable()
export class ConectorCep implements ConectorExterno {
  readonly identificador = 'CEP';
  private readonly registrador = new Logger(ConectorCep.name);
  private readonly http: ClienteHttp;
  private readonly urlBrasilApi: string;
  private readonly urlViaCep: string;

  constructor(private readonly banco: BancoService) {
    const configuracao = carregarConfiguracao();
    this.urlBrasilApi = configuracao.BRASILAPI_URL_BASE;
    this.urlViaCep = configuracao.VIACEP_URL_BASE;
    this.http = new ClienteHttp('CEP', {
      userAgent: configuracao.INTEGRACOES_USER_AGENT,
      requisicoesPorSegundo: 10,
      tempoLimiteMs: 12_000,
    });
  }

  async verificarDisponibilidade(): Promise<boolean> {
    const brasilApi = await this.http.verificarDisponibilidade(
      `${this.urlBrasilApi}/cep/v2/01001000`,
    );
    if (brasilApi) return true;
    return this.http.verificarDisponibilidade(`${this.urlViaCep}/01001000/json/`);
  }

  async consultar(cepInformado: string): Promise<EnderecoPorCep> {
    const cep = cepInformado.replace(/\D+/g, '');
    if (cep.length !== 8) {
      throw new NotFoundException('CEP inválido. Informe 8 dígitos.');
    }

    const doCache = await this.lerDoCache(cep);
    if (doCache) return doCache;

    let endereco: EnderecoPorCep | null = null;
    try {
      endereco = await this.consultarBrasilApi(cep);
    } catch (erro) {
      this.registrador.warn(`BrasilAPI falhou para ${cep}: ${String(erro)}. Tentando ViaCEP.`);
    }

    if (!endereco) {
      try {
        endereco = await this.consultarViaCep(cep);
      } catch (erro) {
        this.registrador.warn(`ViaCEP também falhou para ${cep}: ${String(erro)}.`);
      }
    }

    if (!endereco) {
      throw new NotFoundException(
        'Não foi possível consultar o CEP agora. Preencha o endereço manualmente.',
      );
    }

    await this.gravarNoCache(endereco);
    return endereco;
  }

  private async lerDoCache(cep: string): Promise<EnderecoPorCep | null> {
    return this.banco.executarEmTabelasDeReferencia(async (conexao) => {
      const { rows } = await conexao.query(
        `select cep, logradouro, complemento, bairro, id_municipio, nome_municipio, uf,
                latitude, longitude
           from public.cache_cep where cep = $1`,
        [cep],
      );
      const linha = rows[0];
      if (!linha) return null;
      return {
        cep: linha.cep,
        logradouro: linha.logradouro,
        complemento: linha.complemento,
        bairro: linha.bairro,
        nomeMunicipio: linha.nome_municipio,
        idMunicipio: linha.id_municipio,
        uf: linha.uf,
        latitude: linha.latitude,
        longitude: linha.longitude,
        fonte: 'CACHE',
      };
    });
  }

  private async gravarNoCache(endereco: EnderecoPorCep): Promise<void> {
    await this.banco.executarEmTabelasDeReferencia(async (conexao) => {
      await conexao.query(
        `insert into public.cache_cep
           (cep, logradouro, complemento, bairro, id_municipio, nome_municipio, uf,
            latitude, longitude, fonte)
         values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
         on conflict (cep) do update
           set logradouro = excluded.logradouro,
               bairro = excluded.bairro,
               id_municipio = coalesce(excluded.id_municipio, public.cache_cep.id_municipio),
               consultado_em = now()`,
        [
          endereco.cep,
          endereco.logradouro,
          endereco.complemento,
          endereco.bairro,
          endereco.idMunicipio,
          endereco.nomeMunicipio,
          endereco.uf,
          endereco.latitude,
          endereco.longitude,
          endereco.fonte,
        ],
      );
    });
  }

  private async consultarBrasilApi(cep: string): Promise<EnderecoPorCep> {
    const dados = await this.http.obterJson<RespostaBrasilApi>(
      `${this.urlBrasilApi}/cep/v2/${cep}`,
    );
    const coordenadas = dados.location?.coordinates;
    return {
      cep,
      logradouro: dados.street,
      complemento: null,
      bairro: dados.neighborhood,
      nomeMunicipio: dados.city,
      // A BrasilAPI não devolve código IBGE; resolvemos pelo nome + UF.
      idMunicipio: await this.resolverMunicipio(dados.city, dados.state),
      uf: dados.state,
      latitude: coordenadas?.latitude ? Number(coordenadas.latitude) : null,
      longitude: coordenadas?.longitude ? Number(coordenadas.longitude) : null,
      fonte: 'BRASILAPI',
    };
  }

  private async consultarViaCep(cep: string): Promise<EnderecoPorCep> {
    const dados = await this.http.obterJson<RespostaViaCep>(`${this.urlViaCep}/${cep}/json/`);
    if (dados.erro) {
      throw new NotFoundException('CEP não encontrado.');
    }
    return {
      cep,
      logradouro: dados.logradouro || null,
      complemento: dados.complemento || null,
      bairro: dados.bairro || null,
      nomeMunicipio: dados.localidade || null,
      idMunicipio: dados.ibge ? Number(dados.ibge) : null,
      uf: dados.uf || null,
      latitude: null,
      longitude: null,
      fonte: 'VIACEP',
    };
  }

  /** Casa o nome devolvido pela fonte com o código IBGE já carregado. */
  private async resolverMunicipio(nome: string, uf: string): Promise<number | null> {
    return this.banco.executarEmTabelasDeReferencia(async (conexao) => {
      const { rows } = await conexao.query<{ id_ibge: number }>(
        `select m.id_ibge
           from public.municipios m
           join public.estados e on e.id_ibge = m.id_estado
          where e.sigla = $1
            and m.nome_normalizado = public.normalizar_texto($2)
          limit 1`,
        [uf, nome],
      );
      return rows[0]?.id_ibge ?? null;
    });
  }

  /**
   * O CEP não tem carga em massa: é consultado sob demanda. A "sincronização"
   * aqui serve apenas para o painel de integrações relatar disponibilidade.
   */
  async sincronizar(): Promise<ResultadoSincronizacao> {
    const iniciadoEm = new Date();
    const disponivel = await this.verificarDisponibilidade();
    return {
      fonte: this.identificador,
      sucesso: disponivel,
      registrosProcessados: 0,
      registrosInseridos: 0,
      registrosAtualizados: 0,
      registrosIgnorados: 0,
      erros: disponivel ? [] : ['Nenhuma das fontes de CEP respondeu.'],
      iniciadoEm,
      finalizadoEm: new Date(),
    };
  }
}
