/**
 * Normalização e similaridade de texto.
 *
 * Base da deduplicação de logradouros e de entrevistados. A implementação de
 * `similaridade` reproduz a semântica de trigramas do `pg_trgm` — o mesmo
 * algoritmo que roda no PostgreSQL — para que a sugestão exibida na tela seja
 * a mesma que o banco calcularia. Divergir aqui geraria a situação absurda de
 * o front sugerir um duplicado que o back não reconhece.
 */

/** Remove acentuação preservando as letras: "SÃO JOSÉ" → "SAO JOSE". */
export function removerAcentos(valor: string): string {
  return valor.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
}

/** MAIÚSCULAS, sem acento, sem pontuação, espaços colapsados. */
export function normalizarTexto(valor: string | null | undefined): string {
  if (!valor) return '';
  return removerAcentos(valor)
    .toUpperCase()
    .replace(/[^A-Z0-9 ]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Abreviaturas que aparecem em cadastro de rua feito em campo, no celular,
 * com pressa. Sem expandir isso, "R. Sao Jose" e "Rua São José" viram dois
 * logradouros diferentes — que é exatamente o problema a evitar.
 */
const ABREVIACOES_LOGRADOURO: Record<string, string> = {
  R: 'RUA',
  RUA: 'RUA',
  AV: 'AVENIDA',
  AVE: 'AVENIDA',
  AVEN: 'AVENIDA',
  AVENIDA: 'AVENIDA',
  TV: 'TRAVESSA',
  TRAV: 'TRAVESSA',
  TRV: 'TRAVESSA',
  AL: 'ALAMEDA',
  PC: 'PRACA',
  PCA: 'PRACA',
  PRC: 'PRACA',
  ROD: 'RODOVIA',
  EST: 'ESTRADA',
  ESTR: 'ESTRADA',
  LG: 'LARGO',
  LOT: 'LOTEAMENTO',
  CJ: 'CONJUNTO',
  CONJ: 'CONJUNTO',
  VL: 'VILA',
  JD: 'JARDIM',
  JDM: 'JARDIM',
  PQ: 'PARQUE',
  BC: 'BECO',
  SIT: 'SITIO',
  POV: 'POVOADO',
};

/**
 * Partículas e títulos que poluem a comparação. "Rua Doutor José" e
 * "Rua Dr. José" devem colidir; "de", "da", "dos" não distinguem nada.
 */
const TITULOS_LOGRADOURO: Record<string, string> = {
  DR: 'DOUTOR',
  DRA: 'DOUTORA',
  PROF: 'PROFESSOR',
  PROFA: 'PROFESSORA',
  PE: 'PADRE',
  SAO: 'SAO',
  STA: 'SANTA',
  STO: 'SANTO',
  CEL: 'CORONEL',
  CAP: 'CAPITAO',
  GAL: 'GENERAL',
  PRES: 'PRESIDENTE',
  GOV: 'GOVERNADOR',
  SEN: 'SENADOR',
  DEP: 'DEPUTADO',
  VER: 'VEREADOR',
  MAL: 'MARECHAL',
  ENG: 'ENGENHEIRO',
  MIN: 'MINISTRO',
  DES: 'DESEMBARGADOR',
};

const PARTICULAS = new Set(['DE', 'DA', 'DO', 'DAS', 'DOS', 'E', 'D']);

/**
 * Forma canônica de um logradouro, usada como chave de deduplicação.
 * "Av. Pres. Dr. Getúlio Vargas" → "AVENIDA PRESIDENTE DOUTOR GETULIO VARGAS".
 */
export function normalizarLogradouro(valor: string | null | undefined): string {
  const palavras = normalizarTexto(valor).split(' ').filter(Boolean);
  return palavras
    .map((palavra) => ABREVIACOES_LOGRADOURO[palavra] ?? TITULOS_LOGRADOURO[palavra] ?? palavra)
    .filter((palavra) => !PARTICULAS.has(palavra))
    .join(' ');
}

/**
 * Forma canônica de nome de pessoa: remove partículas para que
 * "Maria de Souza" e "Maria Souza" colidam na busca de duplicidade.
 */
export function normalizarNomePessoa(valor: string | null | undefined): string {
  return normalizarTexto(valor)
    .split(' ')
    .filter((palavra) => palavra.length > 0 && !PARTICULAS.has(palavra))
    .join(' ');
}

/**
 * Gera o conjunto de trigramas no mesmo formato do `pg_trgm`: cada palavra é
 * prefixada por dois espaços e sufixada por um, e as janelas de 3 caracteres
 * são extraídas dessa forma.
 */
export function gerarTrigramas(valor: string): Set<string> {
  const trigramas = new Set<string>();
  const palavras = normalizarTexto(valor).split(' ').filter(Boolean);
  for (const palavra of palavras) {
    const acolchoada = `  ${palavra} `;
    for (let i = 0; i <= acolchoada.length - 3; i += 1) {
      trigramas.add(acolchoada.slice(i, i + 3));
    }
  }
  return trigramas;
}

/**
 * Similaridade de trigramas (índice de Jaccard), no intervalo [0, 1].
 * Equivalente ao operador `similarity()` do PostgreSQL.
 */
export function similaridade(a: string, b: string): number {
  const trigramasA = gerarTrigramas(a);
  const trigramasB = gerarTrigramas(b);
  if (trigramasA.size === 0 || trigramasB.size === 0) return 0;

  let intersecao = 0;
  for (const trigrama of trigramasA) {
    if (trigramasB.has(trigrama)) intersecao += 1;
  }
  const uniao = trigramasA.size + trigramasB.size - intersecao;
  return uniao === 0 ? 0 : intersecao / uniao;
}

/**
 * Limiar a partir do qual dois textos são tratados como possível duplicata.
 * 0,4 é o padrão do `pg_trgm`; subimos para 0,45 em logradouro porque a
 * expansão de abreviaturas já aproxima os candidatos e o limiar baixo gerava
 * ruído demais na fila de curadoria.
 */
export const LIMIAR_SIMILARIDADE_LOGRADOURO = 0.45;
export const LIMIAR_SIMILARIDADE_NOME = 0.5;

export interface SugestaoSimilar<T> {
  item: T;
  similaridade: number;
}

/**
 * Ordena candidatos por similaridade decrescente e devolve os `limite`
 * primeiros acima do limiar. Usado na tela de cadastro de logradouro e na
 * detecção de entrevistado duplicado.
 */
export function buscarSimilares<T>(
  consulta: string,
  candidatos: readonly T[],
  extrairTexto: (item: T) => string,
  opcoes: { limiar?: number; limite?: number } = {},
): Array<SugestaoSimilar<T>> {
  const limiar = opcoes.limiar ?? LIMIAR_SIMILARIDADE_LOGRADOURO;
  const limite = opcoes.limite ?? 5;
  return candidatos
    .map((item) => ({ item, similaridade: similaridade(consulta, extrairTexto(item)) }))
    .filter((resultado) => resultado.similaridade >= limiar)
    .sort((a, b) => b.similaridade - a.similaridade)
    .slice(0, limite);
}

/** Remove zeros à esquerda preservando o número: "0042" → "42". */
export function normalizarNumeroImovel(valor: string | null | undefined): string {
  const texto = normalizarTexto(valor);
  if (!texto || texto === 'SN' || texto === 'S N' || texto === 'SEM NUMERO') return 'SN';
  return texto.replace(/^0+(?=\d)/, '');
}
