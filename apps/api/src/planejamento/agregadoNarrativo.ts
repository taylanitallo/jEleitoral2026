/**
 * Monta o agregado que alimenta a sugestão de eixos narrativos.
 *
 * Lógica pura, sem banco, pelo mesmo motivo de `motorProjecao` e
 * `construirRecorte`: dá para testar de verdade, e este em particular **precisa**
 * ser testado, porque é o único ponto do sistema em que dado de campo atravessa
 * para um provedor externo.
 *
 * Três armadilhas concretas governam o formato de saída, e todas vêm de
 * `redacaoSegura.garantirSemDadoPessoal`, que **recusa** o payload inteiro em
 * vez de sanitizar:
 *
 *  1. **A chave `nome` é proibida.** Um `select b.nome` aliasado como `nome`
 *     mataria a requisição. Por isso `rotuloTerritorio`.
 *  2. **Latitude e longitude são proibidas.** Nunca entram, nem "só para
 *     contexto".
 *  3. **Texto livre não entra.** `titulo` e `descricao` de problema são
 *     digitados por coordenador; um telefone anotado ali dispara o padrão de
 *     documento e derruba a chamada. Vão só tema, contagem, gravidade e
 *     território.
 *  4. **UUID não entra** — e esta foi descoberta pelo teste, não prevista. Um
 *     `id_referencia` como `11111111-1111-4111-8111-111111111111` perde os
 *     hífens na normalização e vira uma sequência de dígitos que o padrão de
 *     TÍTULO DE ELEITOR casa. A barreira recusaria toda sugestão de narrativa,
 *     em produção, com uma mensagem que não aponta para cá. E não há perda: o
 *     modelo não faz nada com um UUID — ele precisa do rótulo legível, e é o
 *     rótulo que ele devolve.
 *
 * O que sobra é suficiente: a IA não precisa ler as queixas para dizer que
 * saneamento aparece em seis bairros com gravidade média 4,2 — precisa do
 * número.
 */

export interface ProblemaAgregado {
  tema: string;
  quantidadeProblemas: number;
  somaRelatos: number;
  gravidadeMedia: number;
}

export interface ProblemaPorTerritorio {
  nivel: string;
  /** NUNCA `nome`: essa chave é bloqueada pela barreira de dado pessoal. */
  rotuloTerritorio: string;
  temaPrincipal: string;
  quantidadeProblemas: number;
}

export interface ClimaEleitoral {
  nivel: string;
  rotuloTerritorio: string;
  apoiador: number;
  provavel: number;
  indeciso: number;
  oposicao: number;
  naoInformou: number;
  eleitoradoBase: number;
}

export interface AgregadoNarrativo {
  temasMaisCitados: ProblemaAgregado[];
  distribuicaoPorTerritorio: ProblemaPorTerritorio[];
  climaEleitoral: ClimaEleitoral[];
  coberturaAmostral: number;
  totalProblemas: number;
  totalRelatos: number;
}

export interface EntradaAgregado {
  problemasPorTema: ReadonlyArray<{
    tema: string;
    quantidadeProblemas: number;
    somaRelatos: number;
    gravidadeMedia: number;
  }>;
  problemasPorTerritorio: ReadonlyArray<{
    nivel: string;
    idReferencia: string;
    rotuloTerritorio: string;
    temaPrincipal: string;
    quantidadeProblemas: number;
  }>;
  classificacaoPorTerritorio: ReadonlyArray<{
    nivel: string;
    idReferencia: string;
    rotuloTerritorio: string;
    apoiador: number;
    provavel: number;
    indeciso: number;
    oposicao: number;
    naoInformou: number;
    eleitoradoBase: number;
  }>;
  coberturaAmostral: number;
}

/** Quantos itens por lista vão ao modelo. */
const LIMITE_TEMAS = 10;
const LIMITE_TERRITORIOS = 20;

/**
 * Constrói o agregado, com **lista branca explícita de campos**.
 *
 * Copiar campo a campo, e não espalhar o objeto de entrada, é deliberado: um
 * `...linha` levaria junto qualquer coluna nova que alguém acrescentasse à
 * consulta, e a primeira delas com nome sensível derrubaria a chamada — ou,
 * pior, passaria.
 */
export function montarAgregadoNarrativo(entrada: EntradaAgregado): AgregadoNarrativo {
  const temasMaisCitados = [...entrada.problemasPorTema]
    // Ordena por RELATOS, não por quantidade de problemas: um problema citado
    // quarenta vezes pesa mais que quatro citados uma vez cada.
    .sort((a, b) => b.somaRelatos - a.somaRelatos)
    .slice(0, LIMITE_TEMAS)
    .map((linha) => ({
      tema: linha.tema,
      quantidadeProblemas: linha.quantidadeProblemas,
      somaRelatos: linha.somaRelatos,
      // Duas casas bastam e evitam mandar ruído de ponto flutuante ao modelo.
      gravidadeMedia: Number(linha.gravidadeMedia.toFixed(2)),
    }));

  const distribuicaoPorTerritorio = [...entrada.problemasPorTerritorio]
    .sort((a, b) => b.quantidadeProblemas - a.quantidadeProblemas)
    .slice(0, LIMITE_TERRITORIOS)
    .map((linha) => ({
      nivel: linha.nivel,
      rotuloTerritorio: linha.rotuloTerritorio,
      temaPrincipal: linha.temaPrincipal,
      quantidadeProblemas: linha.quantidadeProblemas,
    }));

  /*
   * O cruzamento que dá inteligência real ao resultado.
   *
   * "O problema mais citado no Bairro X é SANEAMENTO, e o Bairro X tem 48% de
   * indecisos" produz um eixo acionável. Só a lista de problemas produziria um
   * plano de governo genérico.
   */
  const climaEleitoral = [...entrada.classificacaoPorTerritorio]
    .sort((a, b) => b.eleitoradoBase - a.eleitoradoBase)
    .slice(0, LIMITE_TERRITORIOS)
    .map((linha) => ({
      nivel: linha.nivel,
      rotuloTerritorio: linha.rotuloTerritorio,
      apoiador: linha.apoiador,
      provavel: linha.provavel,
      indeciso: linha.indeciso,
      oposicao: linha.oposicao,
      naoInformou: linha.naoInformou,
      eleitoradoBase: linha.eleitoradoBase,
    }));

  return {
    temasMaisCitados,
    distribuicaoPorTerritorio,
    climaEleitoral,
    coberturaAmostral: entrada.coberturaAmostral,
    totalProblemas: entrada.problemasPorTema.reduce((s, l) => s + l.quantidadeProblemas, 0),
    totalRelatos: entrada.problemasPorTema.reduce((s, l) => s + l.somaRelatos, 0),
  };
}
