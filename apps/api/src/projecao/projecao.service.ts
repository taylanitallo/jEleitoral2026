import { Injectable, Logger } from '@nestjs/common';
import type { ClaimsUsuario, NivelTerritorial } from '@jeleitoral/tipos';
import { BancoService } from '../banco/banco.service.js';
import { projetar, type IntencaoAmostrada, type ResultadoProjecao } from './motorProjecao.js';

interface LinhaIntencao {
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

      const fracaoHistorica = await this.obterFracaoHistorica(
        conexao,
        parametros.idSecao,
        parametros.idCandidato,
      );

      const resultado = projetar({
        eleitoradoBase: eleitorado[0]?.total_eleitores ?? 0,
        amostraTamanho: Number(amostra[0]?.total ?? 0),
        declaracoesValidas: Number(validas[0]?.total ?? 0),
        intencoesDoCandidato: intencoes.map<IntencaoAmostrada>((linha) => ({
          grauCerteza: linha.grau_certeza,
          porDomicilio: linha.por_domicilio,
          quantidade: Number(linha.quantidade),
        })),
        fracaoHistorica,
      });

      await conexao.query(
        `insert into public.projecoes
           (id_organizacao, id_campanha, id_cargo, id_candidato, nivel, id_referencia,
            votos_projetados, intervalo_min, intervalo_max, indice_confianca,
            cobertura_amostral, eleitorado_base, amostra_tamanho, metodo, insumos, calculado_em)
         values ($1, $2, $3, $4, 'SECAO', $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, now())
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
          parametros.idCampanha,
          parametros.idCargo,
          parametros.idCandidato,
          parametros.idSecao,
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

      return resultado;
    });
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
    conexao: { query: (texto: string, valores: unknown[]) => Promise<{ rows: unknown[] }> },
    idSecao: string,
    idCandidato: string,
  ): Promise<number | null> {
    const { rows } = (await conexao.query(
      `with alvo as (
         select c.numero_urna, p.sigla
           from public.candidatos c
           left join public.partidos p on p.id = c.id_partido
          where c.id = $2
       ),
       total as (
         select sum(votos)::numeric as votos
           from public.resultados_oficiais
          where id_secao = $1 and ano = 2022 and turno = 1 and tipo = 'NOMINAL'
       )
       select
         coalesce(
           (select sum(r.votos) from public.resultados_oficiais r, alvo a
             where r.id_secao = $1 and r.ano = 2022 and r.turno = 1
               and r.numero_urna = a.numero_urna),
           (select sum(r.votos) from public.resultados_oficiais r, alvo a
             where r.id_secao = $1 and r.ano = 2022 and r.turno = 1
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
