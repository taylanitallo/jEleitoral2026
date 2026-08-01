/**
 * Indicadores gerenciais da campanha.
 *
 * Lógica pura. Este módulo é de **controle interno** e não substitui a
 * prestação de contas à Justiça Eleitoral — a interface diz isso, e o
 * `codigo_tse` na categoria existe só para facilitar a conciliação posterior
 * pelo contador.
 *
 * O indicador que importa aqui não é "quanto gastamos" — o extrato bancário
 * responde isso. É **"quanto custou cada voto que conquistamos"**, por
 * território, para decidir onde colocar o próximo real.
 */

export interface LancamentoAgregado {
  idTerritorio: string | null;
  totalDespesa: number;
  totalReceita: number;
}

export interface DesempenhoTerritorio {
  idTerritorio: string;
  eleitoresMapeados: number;
  votosProjetados: number;
}

export interface CustoPorTerritorio {
  idTerritorio: string;
  investido: number;
  eleitoresMapeados: number;
  votosProjetados: number;
  /** `null` quando não há mapeamento — dividir por zero produziria infinito. */
  custoPorEleitorMapeado: number | null;
  custoPorVotoProjetado: number | null;
  /** Posição relativa: 1 é o território mais eficiente. */
  posicaoEficiencia: number;
}

/**
 * Cruza investimento com resultado por território.
 *
 * Territórios sem investimento registrado entram com zero em vez de sumir: um
 * bairro que rende votos sem custo nenhum é exatamente o que o coordenador
 * precisa ver, e filtrá-lo o esconderia.
 */
export function calcularCustoPorTerritorio(
  lancamentos: readonly LancamentoAgregado[],
  desempenho: readonly DesempenhoTerritorio[],
): CustoPorTerritorio[] {
  const investimentoPorTerritorio = new Map<string, number>();
  for (const lancamento of lancamentos) {
    if (!lancamento.idTerritorio) continue;
    investimentoPorTerritorio.set(
      lancamento.idTerritorio,
      (investimentoPorTerritorio.get(lancamento.idTerritorio) ?? 0) + lancamento.totalDespesa,
    );
  }

  const linhas = desempenho.map((item) => {
    const investido = investimentoPorTerritorio.get(item.idTerritorio) ?? 0;
    return {
      idTerritorio: item.idTerritorio,
      investido,
      eleitoresMapeados: item.eleitoresMapeados,
      votosProjetados: item.votosProjetados,
      custoPorEleitorMapeado:
        item.eleitoresMapeados > 0 ? investido / item.eleitoresMapeados : null,
      custoPorVotoProjetado: item.votosProjetados > 0 ? investido / item.votosProjetados : null,
      posicaoEficiencia: 0,
    };
  });

  // Eficiência = menor custo por voto projetado. Quem ainda não tem projeção
  // fica no fim da fila, não no começo: ausência de dado não é eficiência.
  const ordenadas = [...linhas].sort((a, b) => {
    if (a.custoPorVotoProjetado === null && b.custoPorVotoProjetado === null) return 0;
    if (a.custoPorVotoProjetado === null) return 1;
    if (b.custoPorVotoProjetado === null) return -1;
    return a.custoPorVotoProjetado - b.custoPorVotoProjetado;
  });

  ordenadas.forEach((linha, indice) => {
    linha.posicaoEficiencia = indice + 1;
  });

  return linhas;
}

export interface ResumoFinanceiro {
  totalReceita: number;
  totalDespesa: number;
  saldo: number;
  /** Média diária de gasto no período observado. */
  queimaDiaria: number;
  /** Dias até o saldo acabar no ritmo atual. `null` se não está queimando caixa. */
  diasDeCaixa: number | null;
  /** `null` quando o saldo dura além da eleição — o que é o desejado. */
  diasFaltandoParaOPleito: number;
  alerta: string | null;
}

/**
 * Ritmo de queima e fôlego de caixa.
 *
 * A pergunta operacional é uma só: **o dinheiro chega até o dia da eleição?**
 * Uma campanha que fica sem caixa na última semana perde exatamente a semana
 * que mais rende voto.
 */
export function resumirFinanceiro(entrada: {
  totalReceita: number;
  totalDespesa: number;
  diasDecorridos: number;
  dataPleito: Date;
  hoje: Date;
}): ResumoFinanceiro {
  const saldo = entrada.totalReceita - entrada.totalDespesa;
  const queimaDiaria = entrada.totalDespesa / Math.max(1, entrada.diasDecorridos);

  const MS_POR_DIA = 24 * 60 * 60 * 1000;
  const diasFaltandoParaOPleito = Math.max(
    0,
    Math.ceil((entrada.dataPleito.getTime() - entrada.hoje.getTime()) / MS_POR_DIA),
  );

  const diasDeCaixa = queimaDiaria > 0 ? Math.floor(saldo / queimaDiaria) : null;

  let alerta: string | null = null;
  if (saldo < 0) {
    alerta = 'Despesas já superam as receitas registradas.';
  } else if (diasDeCaixa !== null && diasDeCaixa < diasFaltandoParaOPleito) {
    alerta =
      `No ritmo atual o caixa dura ${diasDeCaixa} dia(s), ` +
      `mas faltam ${diasFaltandoParaOPleito} até o pleito.`;
  }

  return {
    totalReceita: entrada.totalReceita,
    totalDespesa: entrada.totalDespesa,
    saldo,
    queimaDiaria,
    diasDeCaixa,
    diasFaltandoParaOPleito,
    alerta,
  };
}

/**
 * Compara previsto e realizado por centro de custo.
 *
 * O desvio é devolvido em valor e em fração — quem lê o relatório quer os dois:
 * "estourou R$ 12 mil" para a conversa com o tesoureiro, "estourou 40%" para a
 * conversa com o candidato.
 */
export function compararOrcamento(
  previsto: ReadonlyArray<{ idCentroCusto: string; valor: number }>,
  realizado: ReadonlyArray<{ idCentroCusto: string; valor: number }>,
): Array<{
  idCentroCusto: string;
  previsto: number;
  realizado: number;
  desvio: number;
  desvioFracao: number | null;
  estourou: boolean;
}> {
  const mapaRealizado = new Map(realizado.map((item) => [item.idCentroCusto, item.valor]));
  const centros = new Set([
    ...previsto.map((item) => item.idCentroCusto),
    ...realizado.map((item) => item.idCentroCusto),
  ]);

  return [...centros].map((idCentroCusto) => {
    const valorPrevisto = previsto.find((p) => p.idCentroCusto === idCentroCusto)?.valor ?? 0;
    const valorRealizado = mapaRealizado.get(idCentroCusto) ?? 0;
    const desvio = valorRealizado - valorPrevisto;
    return {
      idCentroCusto,
      previsto: valorPrevisto,
      realizado: valorRealizado,
      desvio,
      // Gasto sem orçamento previsto não tem fração: dividir por zero daria
      // "infinito por cento", que não ajuda ninguém a decidir nada.
      desvioFracao: valorPrevisto > 0 ? desvio / valorPrevisto : null,
      estourou: desvio > 0,
    };
  });
}
