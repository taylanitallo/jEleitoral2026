import type { EsquemaNeutro } from './neutro.js';

/**
 * Compiladores do descritor neutro para o dialeto de cada fornecedor.
 *
 * Ver `neutro.ts` para a tabela de incompatibilidades que justifica isto
 * existir. `dialetos.spec.ts` é o que impede as duas saídas de violarem as
 * restrições — sem ele, a divergência só apareceria em produção, e só num dos
 * provedores.
 */

// --- Anthropic ---------------------------------------------------------------

/**
 * Dialeto da Anthropic: tipos em minúsculas, `additionalProperties: false`
 * obrigatório em todo objeto, e **todas** as chaves em `required`. Campo
 * opcional não sai do `required` — ele vira `anyOf [T, null]` e continua
 * exigido, o que é o modo de a API garantir que a chave sempre exista.
 *
 * Nenhuma palavra-chave de limite (`minLength`, `maximum`…): a API as rejeita.
 * Limite de tamanho vai no prompt e é conferido pelo Zod na chegada.
 */
export function paraAnthropic(esquema: EsquemaNeutro): Record<string, unknown> {
  switch (esquema.tipo) {
    case 'texto':
      return esquema.enumeracao
        ? { type: 'string', enum: [...esquema.enumeracao] }
        : { type: 'string' };

    case 'numero':
      return { type: esquema.inteiro ? 'integer' : 'number' };

    case 'booleano':
      return { type: 'boolean' };

    case 'lista':
      return { type: 'array', items: paraAnthropic(esquema.itens) };

    case 'objeto': {
      const opcionais = new Set(esquema.opcionais ?? []);
      const properties: Record<string, unknown> = {};

      for (const [chave, valor] of Object.entries(esquema.campos)) {
        const compilado = paraAnthropic(valor);
        properties[chave] = opcionais.has(chave)
          ? { anyOf: [compilado, { type: 'null' }] }
          : compilado;
      }

      return {
        type: 'object',
        properties,
        // Todas as chaves, inclusive as opcionais: a ausência é representada
        // por `null`, não por chave faltando.
        required: Object.keys(esquema.campos),
        additionalProperties: false,
      };
    }
  }
}

// --- Gemini ------------------------------------------------------------------

/**
 * Dialeto do Gemini: subconjunto do OpenAPI 3.0. Tipos em MAIÚSCULAS,
 * `nullable: true` para opcional, e **nunca** `additionalProperties` nem
 * `$ref` — a API recusa a requisição inteira se encontrar qualquer um dos dois.
 *
 * `propertyOrdering` não é decoração: sem ele a ordem em que o modelo emite os
 * campos varia entre chamadas, e a qualidade da saída cai de forma mensurável
 * quando um campo que depende de outro é gerado antes dele.
 */
export function paraGemini(esquema: EsquemaNeutro): Record<string, unknown> {
  switch (esquema.tipo) {
    case 'texto':
      return esquema.enumeracao
        ? { type: 'STRING', enum: [...esquema.enumeracao] }
        : { type: 'STRING' };

    case 'numero':
      return { type: esquema.inteiro ? 'INTEGER' : 'NUMBER' };

    case 'booleano':
      return { type: 'BOOLEAN' };

    case 'lista':
      return { type: 'ARRAY', items: paraGemini(esquema.itens) };

    case 'objeto': {
      const opcionais = new Set(esquema.opcionais ?? []);
      const chaves = Object.keys(esquema.campos);
      const properties: Record<string, unknown> = {};

      for (const [chave, valor] of Object.entries(esquema.campos)) {
        const compilado = paraGemini(valor);
        properties[chave] = opcionais.has(chave) ? { ...compilado, nullable: true } : compilado;
      }

      return {
        type: 'OBJECT',
        properties,
        // Só os obrigatórios, ao contrário da Anthropic.
        required: chaves.filter((chave) => !opcionais.has(chave)),
        propertyOrdering: chaves,
      };
    }
  }
}
