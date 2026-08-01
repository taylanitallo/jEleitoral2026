import type { TipoMeta } from '@jeleitoral/tipos';

/**
 * Cálculo de atingimento de metas.
 *
 * Lógica pura. A pergunta que este arquivo responde não é "quanto já fizemos?"
 * — essa é fácil — mas **"do jeito que estamos indo, vamos chegar?"**. Numa
 * campanha de 65 dias, saber no dia 40 que a meta não fecha ainda dá tempo de
 * remanejar equipe; saber no dia 60 não dá.
 *
 * Por isso a situação é decidida pela projeção, não pelo realizado: uma meta com
 * 30% realizado no meio do prazo pode estar em rumo perfeito ou perdida, e o
 * número absoluto sozinho não distingue os dois casos.
 */

export type SituacaoMeta = 'ATINGIDA' | 'NO_RUMO' | 'ATENCAO' | 'EM_RISCO' | 'SEM_PRAZO';

export interface EntradaAvaliacaoMeta {
  tipo: TipoMeta;
  /** Votos absolutos, ou percentual de 0 a 100 quando o tipo é PERCENTUAL. */
  valor: number;
  /** Eleitorado do recorte. Necessário para converter meta percentual em votos. */
  eleitoradoBase: number;
  /** Votos já confirmados (apoiadores mapeados, por exemplo). */
  realizado: number;
  /** Votos projetados pelo motor de projeção para o fim do período. */
  projetado: number;
  inicioEm: Date;
  prazo: Date | null;
  hoje: Date;
}

export interface AvaliacaoMeta {
  /** Meta convertida para votos absolutos, qualquer que seja o tipo. */
  valorAlvo: number;
  percentualRealizado: number;
  percentualProjetado: number;
  situacao: SituacaoMeta;
  diasDecorridos: number;
  diasRestantes: number | null;
  /** Quantos votos por dia faltam para fechar no prazo. `null` sem prazo. */
  ritmoNecessarioPorDia: number | null;
  /** Ritmo observado até agora, em votos por dia. */
  ritmoAtualPorDia: number;
  mensagem: string;
}

/** Abaixo disso a projeção acende alerta amarelo em vez de verde. */
const LIMIAR_ATENCAO = 0.85;

const MS_POR_DIA = 24 * 60 * 60 * 1000;

function diasEntre(inicio: Date, fim: Date): number {
  return Math.max(0, Math.floor((fim.getTime() - inicio.getTime()) / MS_POR_DIA));
}

export function avaliarMeta(entrada: EntradaAvaliacaoMeta): AvaliacaoMeta {
  const valorAlvo =
    entrada.tipo === 'PERCENTUAL'
      ? (entrada.valor / 100) * entrada.eleitoradoBase
      : entrada.valor;

  const percentualRealizado = valorAlvo > 0 ? entrada.realizado / valorAlvo : 0;
  const percentualProjetado = valorAlvo > 0 ? entrada.projetado / valorAlvo : 0;

  const diasDecorridos = diasEntre(entrada.inicioEm, entrada.hoje);
  const diasRestantes = entrada.prazo ? diasEntre(entrada.hoje, entrada.prazo) : null;

  // O primeiro dia conta como um dia trabalhado, senão o ritmo do dia da
  // abertura seria uma divisão por zero.
  const ritmoAtualPorDia = entrada.realizado / Math.max(1, diasDecorridos);

  const faltam = Math.max(0, valorAlvo - entrada.realizado);
  const ritmoNecessarioPorDia =
    diasRestantes === null ? null : faltam / Math.max(1, diasRestantes);

  const situacao = decidirSituacao({
    valorAlvo,
    realizado: entrada.realizado,
    percentualProjetado,
    temPrazo: entrada.prazo !== null,
    prazoVencido: diasRestantes === 0 && entrada.prazo !== null && entrada.hoje > entrada.prazo,
  });

  return {
    valorAlvo,
    percentualRealizado,
    percentualProjetado,
    situacao,
    diasDecorridos,
    diasRestantes,
    ritmoNecessarioPorDia,
    ritmoAtualPorDia,
    mensagem: montarMensagem({
      situacao,
      faltam,
      diasRestantes,
      ritmoAtualPorDia,
      ritmoNecessarioPorDia,
    }),
  };
}

function decidirSituacao(dados: {
  valorAlvo: number;
  realizado: number;
  percentualProjetado: number;
  temPrazo: boolean;
  prazoVencido: boolean;
}): SituacaoMeta {
  if (dados.valorAlvo <= 0) return 'SEM_PRAZO';
  if (dados.realizado >= dados.valorAlvo) return 'ATINGIDA';
  // Prazo vencido sem atingir é risco consumado, não "atenção".
  if (dados.prazoVencido) return 'EM_RISCO';
  if (!dados.temPrazo) return 'SEM_PRAZO';
  if (dados.percentualProjetado >= 1) return 'NO_RUMO';
  if (dados.percentualProjetado >= LIMIAR_ATENCAO) return 'ATENCAO';
  return 'EM_RISCO';
}

function montarMensagem(dados: {
  situacao: SituacaoMeta;
  faltam: number;
  diasRestantes: number | null;
  ritmoAtualPorDia: number;
  ritmoNecessarioPorDia: number | null;
}): string {
  const arredondar = (valor: number): string => Math.ceil(valor).toLocaleString('pt-BR');

  switch (dados.situacao) {
    case 'ATINGIDA':
      return 'Meta atingida.';
    case 'SEM_PRAZO':
      return 'Meta sem prazo definido — não é possível avaliar o ritmo.';
    case 'NO_RUMO':
      return `No rumo. Faltam ${arredondar(dados.faltam)} votos em ${dados.diasRestantes} dia(s).`;
    case 'ATENCAO':
      return (
        `Atenção: a projeção fica pouco abaixo da meta. ` +
        `Seria preciso subir de ${arredondar(dados.ritmoAtualPorDia)} para ` +
        `${arredondar(dados.ritmoNecessarioPorDia ?? 0)} votos por dia.`
      );
    default:
      return (
        `Em risco. No ritmo atual de ${arredondar(dados.ritmoAtualPorDia)} votos/dia, ` +
        `a meta não fecha — precisaria de ${arredondar(dados.ritmoNecessarioPorDia ?? 0)} votos/dia.`
      );
  }
}

/**
 * Distribui uma meta de nível superior entre os recortes filhos,
 * proporcionalmente ao eleitorado de cada um.
 *
 * É como o coordenador transforma "40 mil votos no município" em metas por
 * bairro sem fazer conta à mão. A proporcionalidade pelo eleitorado é o padrão
 * mais defensável na ausência de histórico; onde houver histórico, o
 * coordenador ajusta manualmente — o sistema propõe, não impõe.
 *
 * O último recorte absorve a sobra do arredondamento, para que a soma das metas
 * filhas seja exatamente a meta mãe. Sem isso, um município com 300 bairros
 * "perderia" algumas centenas de votos na distribuição.
 */
export function distribuirMeta(
  valorTotal: number,
  recortes: ReadonlyArray<{ id: string; eleitorado: number }>,
): Array<{ id: string; valor: number }> {
  const eleitoradoTotal = recortes.reduce((soma, recorte) => soma + recorte.eleitorado, 0);
  if (eleitoradoTotal <= 0 || recortes.length === 0) {
    return recortes.map((recorte) => ({ id: recorte.id, valor: 0 }));
  }

  const distribuido = recortes.map((recorte) => ({
    id: recorte.id,
    valor: Math.floor((recorte.eleitorado / eleitoradoTotal) * valorTotal),
  }));

  const sobra = valorTotal - distribuido.reduce((soma, item) => soma + item.valor, 0);
  const ultimo = distribuido[distribuido.length - 1];
  if (ultimo) ultimo.valor += sobra;

  return distribuido;
}
