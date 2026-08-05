import type { UsoTokens } from './provedores/provedorIa.js';

/**
 * Preço por milhão de tokens, por modelo.
 *
 * Substitui as duas constantes que existiam em `ia.service.ts`
 * (`PRECO_ENTRADA_POR_MILHAO = 5`, `PRECO_SAIDA_POR_MILHAO = 25`). Elas eram os
 * preços do **Claude Opus 5**, enquanto o modelo padrão configurado é o
 * **Sonnet 5**, a US$ 3 / US$ 15 — ou seja, todo custo gravado em `usos_ia`
 * saiu cerca de 67% acima do real, e nada no sistema denunciava isso.
 *
 * Preço fixo no código só funciona enquanto existe um modelo. Com dois
 * provedores e vários modelos, ele deixa de ser aproximação e vira número
 * inventado.
 */
export interface PrecoModelo {
  /** Dólares por milhão de tokens. */
  entrada: number;
  saida: number;
  /**
   * Leitura de cache custa cerca de 10% da entrada; escrita custa 1,25× (TTL de
   * 5 minutos). Ficavam fora da conta antiga, que só somava entrada e saída —
   * e o diagnóstico usa cache no bloco de sistema, então a diferença é real.
   */
  cacheLeitura: number;
  cacheEscrita: number;
}

/**
 * Tabela de preços.
 *
 * Anthropic: valores oficiais por milhão de tokens. Cache derivado das regras
 * publicadas (leitura ≈ 0,1× entrada; escrita ≈ 1,25× entrada no TTL padrão).
 *
 * Gemini: **deliberadamente ausente.** Não coloco preço que eu não tenha
 * conferido na fonte — um número plausível e errado é pior que a ausência,
 * porque a ausência o sistema detecta e reporta (ver `calcularCusto`), e o
 * número errado ele registra com ar de verdade. Preencha ao ativar o provedor,
 * com os valores da tabela oficial do Google.
 */
export const PRECOS_POR_MODELO: Record<string, PrecoModelo> = {
  // --- Anthropic -------------------------------------------------------------
  'claude-opus-5': { entrada: 5, saida: 25, cacheLeitura: 0.5, cacheEscrita: 6.25 },
  'claude-opus-4-8': { entrada: 5, saida: 25, cacheLeitura: 0.5, cacheEscrita: 6.25 },
  'claude-opus-4-7': { entrada: 5, saida: 25, cacheLeitura: 0.5, cacheEscrita: 6.25 },
  'claude-sonnet-5': { entrada: 3, saida: 15, cacheLeitura: 0.3, cacheEscrita: 3.75 },
  'claude-sonnet-4-6': { entrada: 3, saida: 15, cacheLeitura: 0.3, cacheEscrita: 3.75 },
  'claude-haiku-4-5': { entrada: 1, saida: 5, cacheLeitura: 0.1, cacheEscrita: 1.25 },
  'claude-fable-5': { entrada: 10, saida: 50, cacheLeitura: 1, cacheEscrita: 12.5 },

  // --- Gemini ------------------------------------------------------------
  // Descomente e preencha com os valores oficiais em
  // https://ai.google.dev/gemini-api/docs/pricing antes de ativar o provedor.
  // `MODELO_PADRAO.gemini` (fabricaProvedor.ts) usa 'gemini-2.5-pro'.
  //
  // 'gemini-2.5-pro': { entrada: 0, saida: 0, cacheLeitura: 0, cacheEscrita: 0 },
  // 'gemini-2.5-flash': { entrada: 0, saida: 0, cacheLeitura: 0, cacheEscrita: 0 },
};

export interface CustoCalculado {
  /** Em dólares. */
  custo: number;
  /**
   * Falso quando o modelo não está na tabela. A chamada NÃO falha por isso —
   * derrubar um diagnóstico porque falta uma linha de preço seria trocar um
   * problema contábil por um problema de disponibilidade. Mas o custo vai a
   * zero, e zero silencioso é exatamente o que produziu o defeito anterior,
   * então quem chama registra o aviso em `usos_ia.erro`.
   */
  precoConhecido: boolean;
  modeloUsadoNaTabela: string | null;
}

/**
 * Preço do modelo, tolerando sufixo de versão.
 *
 * Os provedores publicam variantes datadas (`claude-sonnet-5-20260114`,
 * `gemini-3-pro-preview-0514`). Exigir correspondência exata faria a tabela
 * envelhecer a cada republicação, e o custo cairia a zero sem ninguém notar.
 */
function acharPreco(modelo: string): { chave: string; preco: PrecoModelo } | null {
  const exato = PRECOS_POR_MODELO[modelo];
  if (exato) return { chave: modelo, preco: exato };

  // Prefixo mais longo que casa: `claude-opus-5` não pode capturar um
  // `claude-opus-5-turbo` que venha a ter outro preço, mas entre dois
  // candidatos o mais específico vence.
  let melhor: { chave: string; preco: PrecoModelo } | null = null;
  for (const [chave, preco] of Object.entries(PRECOS_POR_MODELO)) {
    if (modelo.startsWith(chave) && (!melhor || chave.length > melhor.chave.length)) {
      melhor = { chave, preco };
    }
  }
  return melhor;
}

export function calcularCusto(modelo: string, uso: UsoTokens): CustoCalculado {
  const encontrado = acharPreco(modelo);
  if (!encontrado) {
    return { custo: 0, precoConhecido: false, modeloUsadoNaTabela: null };
  }

  const { preco } = encontrado;
  const porMilhao = (tokens: number, valor: number): number => (tokens / 1_000_000) * valor;

  const custo =
    porMilhao(uso.entrada, preco.entrada) +
    porMilhao(uso.saida, preco.saida) +
    porMilhao(uso.cacheLeitura, preco.cacheLeitura) +
    porMilhao(uso.cacheEscrita, preco.cacheEscrita);

  return {
    // 6 casas: `usos_ia.custo_estimado` é numeric(10,6), e arredondar aqui
    // evita que o banco recuse uma chamada barata por excesso de casas.
    custo: Number(custo.toFixed(6)),
    precoConhecido: true,
    modeloUsadoNaTabela: encontrado.chave,
  };
}
