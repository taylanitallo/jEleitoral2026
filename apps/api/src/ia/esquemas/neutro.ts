/**
 * Descritor de esquema independente de fornecedor.
 *
 * Existe porque Anthropic e Gemini pedem dialetos **incompatíveis** de JSON
 * Schema para a mesma coisa:
 *
 *   | conceito            | Anthropic                | Gemini                    |
 *   |---------------------|--------------------------|---------------------------|
 *   | fechar o objeto     | exige additionalProperties: false | NÃO aceita a chave |
 *   | nomes de tipo       | minúsculo (`"object"`)   | maiúsculo (`"OBJECT"`)    |
 *   | campo opcional      | `anyOf [T, null]`        | `nullable: true`          |
 *   | ordem dos campos    | irrelevante              | `propertyOrdering`        |
 *   | limites de tamanho  | rejeitados               | aceitos (não usamos)      |
 *   | reaproveitar tipo   | `$ref` aceito            | `$ref` NÃO aceito         |
 *
 * A tentação é escrever dois JSON Schemas à mão. Não fazemos isso: dois
 * arquivos que precisam dizer a mesma coisa divergem no primeiro campo novo, e
 * a divergência não quebra o build — ela aparece como o modelo devolvendo um
 * formato que o Zod recusa, meses depois, só num dos provedores.
 *
 * Uma fonte de verdade, dois compiladores, e um teste que confere as duas
 * saídas contra as restrições de cada fornecedor.
 *
 * O descritor é pequeno de propósito: cobre exatamente o que os esquemas deste
 * sistema usam. Crescer só quando um esquema real precisar.
 */
export type EsquemaNeutro =
  | { tipo: 'texto'; descricao?: string; enumeracao?: readonly string[] }
  | { tipo: 'numero'; descricao?: string; inteiro?: boolean }
  | { tipo: 'booleano'; descricao?: string }
  | { tipo: 'lista'; descricao?: string; itens: EsquemaNeutro }
  | {
      tipo: 'objeto';
      descricao?: string;
      campos: Record<string, EsquemaNeutro>;
      /** Chaves que podem vir nulas. As demais são obrigatórias. */
      opcionais?: readonly string[];
    };

/** Atalhos para os esquemas ficarem legíveis onde são declarados. */
export const texto = (opcoes: { descricao?: string; enumeracao?: readonly string[] } = {}) =>
  ({ tipo: 'texto', ...opcoes }) as const satisfies EsquemaNeutro;

export const numero = (opcoes: { descricao?: string; inteiro?: boolean } = {}) =>
  ({ tipo: 'numero', ...opcoes }) as const satisfies EsquemaNeutro;

export const booleano = (descricao?: string) =>
  ({ tipo: 'booleano', descricao }) as const satisfies EsquemaNeutro;

export const lista = (itens: EsquemaNeutro, descricao?: string) =>
  ({ tipo: 'lista', itens, descricao }) as const satisfies EsquemaNeutro;

export const objeto = (
  campos: Record<string, EsquemaNeutro>,
  opcoes: { descricao?: string; opcionais?: readonly string[] } = {},
) => ({ tipo: 'objeto', campos, ...opcoes }) as const satisfies EsquemaNeutro;
