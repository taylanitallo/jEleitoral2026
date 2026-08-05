import { Controller, Get, Injectable, Module, Query } from '@nestjs/common';
import { ClaimsUsuario, FiltroGlobal, type ClassificacaoEleitor } from '@jeleitoral/tipos';
import { ExigePermissao } from '../autenticacao/autenticacao.guard.js';
import { Claims } from '../autenticacao/claimsUsuario.decorator.js';
import { BancoService } from '../banco/banco.service.js';
import { construirRecorte } from './construirRecorte.js';

export interface ResumoPainel {
  eleitoresMapeados: number;
  domiciliosVisitados: number;
  entrevistasConcluidas: number;
  eleitoradoDoRecorte: number;
  coberturaAmostral: number;
  porClassificacao: Array<{ classificacao: ClassificacaoEleitor; total: number }>;
  entrevistasPorDia: Array<{ dia: string; total: number }>;
  porBairro: Array<{
    idBairro: string;
    nome: string;
    mapeados: number;
    classificacaoDominante: ClassificacaoEleitor | null;
  }>;
}

/**
 * Agregações do painel.
 *
 * Todas as consultas rodam sob `executarComoUsuario`, ou seja, sob a RLS. Isso
 * tem uma consequência que vale entender: **os números que o coordenador vê são
 * diferentes dos que o entrevistador vê**, e isso está correto. O entrevistador
 * com escopo PROPRIO enxerga a cobertura da coleta dele; o administrador, a da
 * campanha. Não há um "modo painel" que ignore o escopo — seria a porta dos
 * fundos que a RLS existe para fechar.
 */
@Injectable()
export class PainelService {
  constructor(private readonly banco: BancoService) {}

  async resumir(claims: ClaimsUsuario, filtro: FiltroGlobal): Promise<ResumoPainel> {
    return this.banco.executarComoUsuario(claims, async (conexao) => {
      const recorteEntrevistados = construirRecorte(filtro, {
        idCampanha: 'e.id_campanha',
        idSecao: 'e.id_secao',
        idEquipe: 'e.id_equipe',
        idUsuario: 'e.id_usuario_cadastro',
        dataReferencia: 'e.criado_em',
      });

      const { rows: classificacao } = await conexao.query<{
        classificacao: ClassificacaoEleitor;
        total: string;
      }>(
        `select e.classificacao, count(*) as total
           from public.entrevistados e
          where e.anonimizado_em is null and ${recorteEntrevistados.predicado}
          group by e.classificacao`,
        recorteEntrevistados.parametros,
      );

      const eleitoresMapeados = classificacao.reduce(
        (soma, linha) => soma + Number(linha.total),
        0,
      );

      const recorteDomicilios = construirRecorte(filtro, {
        idCampanha: 'd.id_campanha',
        idBairro: 'd.id_bairro',
        idSecao: 'd.id_secao_provavel',
        idEquipe: 'd.id_equipe',
        idUsuario: 'd.id_usuario_cadastro',
        dataReferencia: 'd.criado_em',
      });

      const { rows: domicilios } = await conexao.query<{ total: string }>(
        `select count(*) as total from public.domicilios d where ${recorteDomicilios.predicado}`,
        recorteDomicilios.parametros,
      );

      const recorteEntrevistas = construirRecorte(filtro, {
        idCampanha: 'ent.id_campanha',
        idEquipe: 'ent.id_equipe',
        idUsuario: 'ent.id_usuario_entrevistador',
        dataReferencia: 'ent.data_hora',
      });

      // `entrevistas_vigentes`, e não `entrevistas`: uma entrevista retificada
      // é DUAS linhas na tabela base (migration 0030). Contar direto na base
      // dobraria o número aqui — o primeiro lugar que o coordenador olha.
      const { rows: entrevistas } = await conexao.query<{ total: string }>(
        `select count(*) as total from public.entrevistas_vigentes ent
          where ent.status in ('CONCLUIDA', 'VALIDADA') and ${recorteEntrevistas.predicado}`,
        recorteEntrevistas.parametros,
      );

      // Evolução temporal do mapeamento. Últimos 60 dias — a campanha inteira
      // cabe nisso e o gráfico não vira uma linha ilegível.
      const { rows: porDia } = await conexao.query<{ dia: string; total: string }>(
        `select to_char(date_trunc('day', ent.data_hora), 'YYYY-MM-DD') as dia,
                count(*) as total
           from public.entrevistas_vigentes ent
          where ent.status in ('CONCLUIDA', 'VALIDADA')
            and ent.data_hora > now() - interval '60 days'
            and ${recorteEntrevistas.predicado}
          group by 1 order by 1`,
        recorteEntrevistas.parametros,
      );

      const eleitoradoDoRecorte = await this.obterEleitorado(conexao, filtro);

      // Grade do mapa 3D do painel — sem malha geográfica (decisão do plano),
      // então só precisa de nome, contagem e a classificação que domina o
      // bairro. `mode()` é o agregado de conjunto ordenado do Postgres para
      // "valor mais frequente"; 40 bairros é o bastante para uma grade legível
      // sem virar uma parede de blocos minúsculos.
      const recorteBairros = construirRecorte(filtro, {
        idCampanha: 'b.id_campanha',
        idMunicipio: 'b.id_municipio',
      });
      const { rows: porBairro } = await conexao.query<{
        id: string;
        nome: string;
        mapeados: string;
        classificacao_dominante: ClassificacaoEleitor | null;
      }>(
        `select b.id, b.nome, count(distinct e.id) as mapeados,
                mode() within group (order by e.classificacao) as classificacao_dominante
           from public.bairros b
           left join public.domicilios d on d.id_bairro = b.id
           left join public.entrevistados e
             on e.id_domicilio = d.id and e.anonimizado_em is null
          where ${recorteBairros.predicado}
          group by b.id, b.nome
         having count(distinct e.id) > 0
          order by mapeados desc
          limit 40`,
        recorteBairros.parametros,
      );

      return {
        eleitoresMapeados,
        domiciliosVisitados: Number(domicilios[0]?.total ?? 0),
        entrevistasConcluidas: Number(entrevistas[0]?.total ?? 0),
        eleitoradoDoRecorte,
        coberturaAmostral:
          eleitoradoDoRecorte > 0 ? Math.min(1, eleitoresMapeados / eleitoradoDoRecorte) : 0,
        porClassificacao: classificacao.map((linha) => ({
          classificacao: linha.classificacao,
          total: Number(linha.total),
        })),
        entrevistasPorDia: porDia.map((linha) => ({ dia: linha.dia, total: Number(linha.total) })),
        porBairro: porBairro.map((linha) => ({
          idBairro: linha.id,
          nome: linha.nome,
          mapeados: Number(linha.mapeados),
          classificacaoDominante: linha.classificacao_dominante,
        })),
      };
    });
  }

  /**
   * Eleitorado do recorte, do TSE. É o denominador da cobertura.
   *
   * Sem seção, zona ou município no filtro não há denominador confiável —
   * devolvemos zero, e a interface mostra "cobertura indisponível" em vez de um
   * percentual inventado sobre uma base arbitrária.
   */
  private async obterEleitorado(
    conexao: { query: (texto: string, valores: unknown[]) => Promise<{ rows: unknown[] }> },
    filtro: FiltroGlobal,
  ): Promise<number> {
    const condicoes: string[] = ['el.ano_referencia = 2026'];
    const parametros: unknown[] = [];

    if (filtro.idSecao) {
      parametros.push(filtro.idSecao);
      condicoes.push(`s.id = $${parametros.length}`);
    } else if (filtro.idZona) {
      parametros.push(filtro.idZona);
      condicoes.push(`s.id_zona = $${parametros.length}`);
    } else if (filtro.idMunicipio) {
      parametros.push(filtro.idMunicipio);
      condicoes.push(`s.id_municipio = $${parametros.length}`);
    } else {
      return 0;
    }

    const { rows } = (await conexao.query(
      `select coalesce(sum(el.total_eleitores), 0)::bigint as total
         from public.eleitorado_secao el
         join public.secoes_eleitorais s on s.id = el.id_secao
        where ${condicoes.join(' and ')}`,
      parametros,
    )) as { rows: Array<{ total: string }> };

    return Number(rows[0]?.total ?? 0);
  }
}

@Controller('painel')
class PainelController {
  constructor(private readonly painel: PainelService) {}

  @Get('resumo')
  @ExigePermissao('campo.ler')
  async resumo(@Claims() claims: ClaimsUsuario, @Query() consulta: unknown): Promise<ResumoPainel> {
    return this.painel.resumir(claims, FiltroGlobal.parse(consulta));
  }
}

@Module({
  controllers: [PainelController],
  providers: [BancoService, PainelService],
  exports: [PainelService],
})
export class PainelModule {}
