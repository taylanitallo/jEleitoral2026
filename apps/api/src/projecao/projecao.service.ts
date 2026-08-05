import { Injectable, Logger } from '@nestjs/common';
import type { ClaimsUsuario, NivelTerritorial } from '@jeleitoral/tipos';
import { BancoService } from '../banco/banco.service.js';
import {
  agregar,
  projetar,
  type IntencaoAmostrada,
  type ResultadoProjecao,
} from './motorProjecao.js';

/**
 * O mínimo que este serviço precisa de uma conexão.
 *
 * Tipo próprio em vez de `PoolClient` para que `calcularSecao` e `persistir`
 * possam receber tanto a conexão da transação quanto um duplo em teste.
 */
interface ConexaoConsulta {
  query: <T extends Record<string, unknown> = Record<string, unknown>>(
    texto: string,
    valores?: unknown[],
  ) => Promise<{ rows: T[] }>;
}

interface LinhaIntencao extends Record<string, unknown> {
  grau_certeza: number;
  por_domicilio: boolean;
  quantidade: number;
}

/**
 * Reúne os insumos do banco e entrega ao motor.
 *
 * Toda a decisão estatística fica em `motorProjecao.ts`, que é puro e testado.
 * Aqui só há consulta e persistência — a separação existe para que a regra que
 * define o número da campanha não precise de um banco de pé para ser conferida.
 */
@Injectable()
export class ProjecaoService {
  private readonly registrador = new Logger(ProjecaoService.name);

  constructor(private readonly banco: BancoService) {}

  /**
   * Recalcula e persiste a projeção de um candidato numa seção.
   *
   * Grava em `projecoes` com o método e os insumos usados, para que a pergunta
   * "de onde saiu esse número?" tenha resposta meses depois.
   */
  async recalcularSecao(
    claims: ClaimsUsuario,
    parametros: {
      idCampanha: string;
      idCandidato: string;
      idCargo: string;
      idSecao: string;
      anoReferencia?: number;
    },
  ): Promise<ResultadoProjecao> {
    const ano = parametros.anoReferencia ?? 2026;

    return this.banco.executarComoUsuario(claims, async (conexao) => {
      const resultado = await this.calcularSecao(conexao, { ...parametros, ano });
      await this.persistir(conexao, claims, {
        idCampanha: parametros.idCampanha,
        idCargo: parametros.idCargo,
        idCandidato: parametros.idCandidato,
        nivel: 'SECAO',
        idReferencia: parametros.idSecao,
        resultado,
      });
      return resultado;
    });
  }

  /**
   * Reúne os insumos de UMA seção e chama o motor. Não persiste.
   *
   * Separado de `recalcularSecao` porque `recalcularCampanha` precisa calcular
   * centenas de seções dentro da mesma transação e agregá-las antes de gravar —
   * com o cálculo preso à persistência, cada seção abriria a própria conexão.
   */
  private async calcularSecao(
    conexao: ConexaoConsulta,
    parametros: {
      idCampanha: string;
      idCandidato: string;
      idCargo: string;
      idSecao: string;
      ano: number;
    },
  ): Promise<ResultadoProjecao> {
    const ano = parametros.ano;
    {
      const { rows: eleitorado } = await conexao.query<{ total_eleitores: number }>(
        'select total_eleitores from public.eleitorado_secao where id_secao = $1 and ano_referencia = $2',
        [parametros.idSecao, ano],
      );

      const { rows: amostra } = await conexao.query<{ total: string }>(
        `select count(distinct e.id) as total
           from public.entrevistados e
          where e.id_campanha = $1 and e.id_secao = $2 and e.anonimizado_em is null`,
        [parametros.idCampanha, parametros.idSecao],
      );

      // Intenções individuais e declarações por domicílio, unificadas para o
      // motor, que aplica pesos diferentes a cada natureza.
      const { rows: intencoes } = await conexao.query<LinhaIntencao>(
        `select i.grau_certeza, false as por_domicilio, 1 as quantidade
           from public.intencoes_voto i
           join public.entrevistas ent on ent.id = i.id_entrevista
           join public.entrevistados e on e.id = ent.id_entrevistado
          where i.id_campanha = $1 and i.id_candidato = $2 and e.id_secao = $3
            and ent.status in ('CONCLUIDA', 'VALIDADA')
         union all
         select 3 as grau_certeza, true as por_domicilio, v.quantidade_declarada as quantidade
           from public.votos_domicilio v
           join public.entrevistas ent on ent.id = v.id_entrevista
           join public.entrevistados e on e.id = ent.id_entrevistado
          where v.id_campanha = $1 and v.id_candidato = $2 and e.id_secao = $3
            and ent.status in ('CONCLUIDA', 'VALIDADA')`,
        [parametros.idCampanha, parametros.idCandidato, parametros.idSecao],
      );

      const { rows: validas } = await conexao.query<{ total: string }>(
        `select count(*) as total
           from public.intencoes_voto i
           join public.entrevistas ent on ent.id = i.id_entrevista
           join public.entrevistados e on e.id = ent.id_entrevistado
          where i.id_campanha = $1 and i.id_cargo = $2 and e.id_secao = $3
            and ent.status in ('CONCLUIDA', 'VALIDADA')`,
        [parametros.idCampanha, parametros.idCargo, parametros.idSecao],
      );

      /*
       * Quantos votos o eleitor dá neste cargo. Senador: 2.
       *
       * Sem passar isto, a projeção de Senador saía pela metade — a fração era
       * calculada sobre votos e multiplicada por eleitores.
       */
      const { rows: cargo } = await conexao.query<{ quantidade_votos_permitida: number }>(
        'select quantidade_votos_permitida from public.cargos where id = $1',
        [parametros.idCargo],
      );

      const fracaoHistorica = await this.obterFracaoHistorica(
        conexao,
        parametros.idSecao,
        parametros.idCandidato,
      );

      const resultado = projetar({
        eleitoradoBase: eleitorado[0]?.total_eleitores ?? 0,
        amostraTamanho: Number(amostra[0]?.total ?? 0),
        declaracoesValidas: Number(validas[0]?.total ?? 0),
        votosPorEleitor: cargo[0]?.quantidade_votos_permitida ?? 1,
        intencoesDoCandidato: intencoes.map<IntencaoAmostrada>((linha) => ({
          grauCerteza: linha.grau_certeza,
          porDomicilio: linha.por_domicilio,
          quantidade: Number(linha.quantidade),
        })),
        fracaoHistorica,
      });

      return resultado;
    }
  }

  /** Grava (ou atualiza) uma projeção em `public.projecoes`. */
  private async persistir(
    conexao: ConexaoConsulta,
    claims: ClaimsUsuario,
    dados: {
      idCampanha: string;
      idCargo: string;
      idCandidato: string;
      nivel: NivelTerritorial;
      idReferencia: string;
      resultado: ResultadoProjecao;
    },
  ): Promise<void> {
    const { resultado } = dados;
    await conexao.query(
      `insert into public.projecoes
         (id_organizacao, id_campanha, id_cargo, id_candidato, nivel, id_referencia,
          votos_projetados, intervalo_min, intervalo_max, indice_confianca,
          cobertura_amostral, eleitorado_base, amostra_tamanho, metodo, insumos, calculado_em)
       values ($1, $2, $3, $4, $5::public.nivel_territorial, $6, $7, $8, $9, $10, $11, $12, $13,
               $14, $15, now())
       on conflict (id_campanha, id_candidato, nivel, id_referencia) do update
         set votos_projetados = excluded.votos_projetados,
             intervalo_min = excluded.intervalo_min,
             intervalo_max = excluded.intervalo_max,
             indice_confianca = excluded.indice_confianca,
             cobertura_amostral = excluded.cobertura_amostral,
             eleitorado_base = excluded.eleitorado_base,
             amostra_tamanho = excluded.amostra_tamanho,
             metodo = excluded.metodo,
             insumos = excluded.insumos,
             calculado_em = now()`,
      [
        claims.idOrganizacao,
        dados.idCampanha,
        dados.idCargo,
        dados.idCandidato,
        dados.nivel,
        dados.idReferencia,
        resultado.votosProjetados,
        resultado.intervaloMin,
        resultado.intervaloMax,
        resultado.indiceConfianca,
        resultado.coberturaAmostral,
        Number(resultado.insumos['eleitoradoBase'] ?? 0),
        Number(resultado.insumos['amostraTamanho'] ?? 0),
        resultado.metodo,
        JSON.stringify(resultado.insumos),
      ],
    );
  }

  /**
   * Recalcula a projeção de TODA a chapa e agrega para bairro, zona e município.
   *
   * Existe por dois motivos que se somam. Primeiro: `POST /projecao/secao`
   * calculava uma seção de um candidato por chamada, e uma campanha municipal
   * tem centenas de seções vezes seis candidatos — ninguém ia clicar isso.
   * Segundo, e mais importante: `agregar()` estava implementado em
   * `motorProjecao.ts` e **nunca era chamado por ninguém**, então não existia
   * projeção de bairro, de zona nem de município. Só de seção, uma a uma.
   *
   * Grava a agregação também em `projecoes_diarias`, que é a série temporal.
   * `projecoes` é sobrescrita a cada recálculo — está certo para o estado
   * corrente e é exatamente por isso que a curva precisa de outra tabela.
   */
  async recalcularCampanha(
    claims: ClaimsUsuario,
    parametros: { idCampanha: string; idsCandidatos?: string[]; anoReferencia?: number },
  ): Promise<{ candidatos: number; secoes: number; agregados: number; parcial: boolean }> {
    const ano = parametros.anoReferencia ?? 2026;

    const candidatos = await this.banco.executarComoUsuario(claims, async (conexao) => {
      const { rows } = await conexao.query<{ id: string; id_cargo: string; nome_urna: string }>(
        `select c.id, c.id_cargo, c.nome_urna
           from public.candidatos c
          where c.id_campanha = $1 and c.ativo
            and ($2::uuid[] is null or c.id = any($2::uuid[]))
            -- Sem lista explícita, roda a chapa: são os candidatos que a
            -- campanha precisa projetar todo dia.
            and ($2::uuid[] is not null or c.proprio)
          order by c.nome_urna`,
        [parametros.idCampanha, parametros.idsCandidatos ?? null],
      );
      return rows;
    });

    if (candidatos.length === 0) {
      return { candidatos: 0, secoes: 0, agregados: 0, parcial: false };
    }

    const secoes = await this.banco.executarComoUsuario(claims, async (conexao) => {
      const { rows } = await conexao.query<{
        id_secao: string;
        id_municipio: number;
        id_zona: string;
        id_bairro: string | null;
      }>(
        // A seção só entra se tiver eleitorado carregado: sem denominador, o
        // motor devolve SEM_BASE e a linha só polui o ranking.
        `select distinct s.id as id_secao, s.id_municipio, s.id_zona, sb.id_bairro
           from public.secoes_eleitorais s
           join public.eleitorado_secao el
                on el.id_secao = s.id and el.ano_referencia = $2
           left join public.secao_bairros sb
                on sb.id_secao = s.id and sb.id_campanha = $1
          where exists (
            select 1 from public.campanhas c
             where c.id = $1
               and (c.id_municipio_base is null or c.id_municipio_base = s.id_municipio)
          )`,
        [parametros.idCampanha, ano],
      );
      return rows;
    });

    /*
     * Teto de trabalho.
     *
     * Não existe fila assíncrona neste sistema — `exportacoes` grava PENDENTE e
     * nada processa. Em vez de prometer processamento que não acontece, o
     * método recorta e diz que recortou. Melhor um número honesto e parcial que
     * uma requisição de dez minutos que o proxy derruba pela metade.
     */
    const TETO_PARES = 4000;
    const parcial = candidatos.length * secoes.length > TETO_PARES;
    const secoesUsadas = parcial
      ? secoes.slice(0, Math.max(1, Math.floor(TETO_PARES / candidatos.length)))
      : secoes;

    let totalSecoes = 0;
    let totalAgregados = 0;
    const hoje = new Date().toISOString().slice(0, 10);

    for (const candidato of candidatos) {
      // Uma transação por candidato: uma campanha grande não pode manter uma
      // transação aberta por minutos, e falha num candidato não desfaz os outros.
      const agregados = await this.banco.executarComoUsuario(claims, async (conexao) => {
        const porBairro = new Map<string, ResultadoProjecao[]>();
        const porZona = new Map<string, ResultadoProjecao[]>();
        const porMunicipio = new Map<string, ResultadoProjecao[]>();

        for (const secao of secoesUsadas) {
          const resultado = await this.calcularSecao(conexao, {
            idCampanha: parametros.idCampanha,
            idCandidato: candidato.id,
            idCargo: candidato.id_cargo,
            idSecao: secao.id_secao,
            ano,
          });

          await this.persistir(conexao, claims, {
            idCampanha: parametros.idCampanha,
            idCargo: candidato.id_cargo,
            idCandidato: candidato.id,
            nivel: 'SECAO',
            idReferencia: secao.id_secao,
            resultado,
          });
          totalSecoes += 1;

          if (secao.id_bairro) {
            const lista = porBairro.get(secao.id_bairro) ?? [];
            lista.push(resultado);
            porBairro.set(secao.id_bairro, lista);
          }
          for (const [mapa, chave] of [
            [porZona, secao.id_zona],
            [porMunicipio, String(secao.id_municipio)],
          ] as const) {
            const lista = mapa.get(chave) ?? [];
            lista.push(resultado);
            mapa.set(chave, lista);
          }
        }

        let gravados = 0;
        for (const [nivel, mapa] of [
          ['BAIRRO', porBairro],
          ['ZONA', porZona],
          ['MUNICIPIO', porMunicipio],
        ] as const) {
          for (const [idReferencia, lista] of mapa) {
            const agregado = agregar(lista);
            const resultado: ResultadoProjecao = { ...agregado, insumos: {} };

            await this.persistir(conexao, claims, {
              idCampanha: parametros.idCampanha,
              idCargo: candidato.id_cargo,
              idCandidato: candidato.id,
              nivel,
              idReferencia,
              resultado,
            });

            // A série temporal. `on conflict` por dia: rodar duas vezes no
            // mesmo dia atualiza, não duplica.
            await conexao.query(
              `insert into public.projecoes_diarias
                 (id_organizacao, id_campanha, id_cargo, id_candidato, nivel, id_referencia,
                  data_referencia, votos_projetados, intervalo_min, intervalo_max,
                  indice_confianca, cobertura_amostral, eleitorado_base, amostra_tamanho, metodo)
               values ($1,$2,$3,$4,$5::public.nivel_territorial,$6,$7::date,$8,$9,$10,$11,$12,$13,$14,$15)
               on conflict (id_campanha, id_candidato, nivel, id_referencia, data_referencia)
               do update set votos_projetados = excluded.votos_projetados,
                             intervalo_min = excluded.intervalo_min,
                             intervalo_max = excluded.intervalo_max,
                             indice_confianca = excluded.indice_confianca,
                             cobertura_amostral = excluded.cobertura_amostral,
                             eleitorado_base = excluded.eleitorado_base,
                             amostra_tamanho = excluded.amostra_tamanho,
                             metodo = excluded.metodo`,
              [
                claims.idOrganizacao,
                parametros.idCampanha,
                candidato.id_cargo,
                candidato.id,
                nivel,
                idReferencia,
                hoje,
                resultado.votosProjetados,
                resultado.intervaloMin,
                resultado.intervaloMax,
                resultado.indiceConfianca,
                resultado.coberturaAmostral,
                lista.reduce((s, p) => s + Number(p.insumos['eleitoradoBase'] ?? 0), 0),
                lista.reduce((s, p) => s + Number(p.insumos['amostraTamanho'] ?? 0), 0),
                resultado.metodo,
              ],
            );
            gravados += 1;
          }
        }
        return gravados;
      });
      totalAgregados += agregados;
    }

    this.registrador.log(
      `Projeção recalculada: ${candidatos.length} candidato(s), ${totalSecoes} seção(ões), ` +
        `${totalAgregados} agregado(s).`,
    );

    return {
      candidatos: candidatos.length,
      secoes: totalSecoes,
      agregados: totalAgregados,
      parcial,
    };
  }

  /**
   * Desempenho do candidato (ou do seu partido) na mesma seção em 2022, como
   * fração dos votos válidos.
   *
   * Casamos pelo número de urna: o `id` interno do candidato de 2026 não existe
   * na base histórica. Quando o candidato é estreante, cai para o desempenho do
   * partido — melhor âncora do que nenhuma, e o método fica registrado.
   */
  private async obterFracaoHistorica(
    conexao: ConexaoConsulta,
    idSecao: string,
    idCandidato: string,
  ): Promise<number | null> {
    const { rows } = (await conexao.query(
      /*
       * O filtro por CARGO é o que impede a chapa de contaminar o histórico.
       *
       * Sem `r.codigo_cargo = a.codigo_tse`, o número "22" casava com o
       * presidente E com o governador de 2022 ao mesmo tempo, e os votos
       * somavam. Pior: o denominador `total` somava todos os NOMINAL de todos
       * os cargos da seção. Numerador e denominador erravam em direções
       * diferentes, e o resultado ainda parecia uma fração plausível — o tipo
       * de defeito que ninguém percebe olhando o número.
       */
      `with alvo as (
         select c.numero_urna, p.sigla, cg.codigo_tse
           from public.candidatos c
           join public.cargos cg on cg.id = c.id_cargo
           left join public.partidos p on p.id = c.id_partido
          where c.id = $2
       ),
       total as (
         select sum(r.votos)::numeric as votos
           from public.resultados_oficiais r, alvo a
          where r.id_secao = $1 and r.ano = 2022 and r.turno = 1
            and r.tipo = 'NOMINAL' and r.codigo_cargo = a.codigo_tse
       )
       select
         coalesce(
           (select sum(r.votos) from public.resultados_oficiais r, alvo a
             where r.id_secao = $1 and r.ano = 2022 and r.turno = 1
               and r.codigo_cargo = a.codigo_tse
               and r.numero_urna = a.numero_urna),
           (select sum(r.votos) from public.resultados_oficiais r, alvo a
             where r.id_secao = $1 and r.ano = 2022 and r.turno = 1
               and r.codigo_cargo = a.codigo_tse
               and r.sigla_partido = a.sigla)
         )::numeric as votos_alvo,
         (select votos from total) as votos_total`,
      [idSecao, idCandidato],
    )) as { rows: Array<{ votos_alvo: string | null; votos_total: string | null }> };

    const linha = rows[0];
    const total = Number(linha?.votos_total ?? 0);
    const alvo = Number(linha?.votos_alvo ?? 0);
    if (!total || !alvo) return null;
    return Math.min(1, alvo / total);
  }

  /** Ranking de seções por potencial: onde há voto a ganhar. */
  async listarProjecoes(
    claims: ClaimsUsuario,
    parametros: { idCampanha: string; idCandidato: string; nivel?: NivelTerritorial },
  ): Promise<unknown[]> {
    return this.banco.executarComoUsuario(claims, async (conexao) => {
      const { rows } = await conexao.query(
        `select nivel, id_referencia, votos_projetados, intervalo_min, intervalo_max,
                indice_confianca, cobertura_amostral, eleitorado_base, amostra_tamanho,
                metodo, calculado_em
           from public.projecoes
          where id_campanha = $1 and id_candidato = $2
            and ($3::text is null or nivel = $3::public.nivel_territorial)
          order by votos_projetados desc
          limit 500`,
        [parametros.idCampanha, parametros.idCandidato, parametros.nivel ?? null],
      );
      return rows;
    });
  }
}
