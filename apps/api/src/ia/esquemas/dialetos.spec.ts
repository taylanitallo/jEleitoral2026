import { describe, expect, it } from 'vitest';
import { paraAnthropic, paraGemini } from './dialetos.js';
import { lista, numero, objeto, texto, type EsquemaNeutro } from './neutro.js';

/**
 * Este é o teste que sustenta a abstração de provedor.
 *
 * Os dois compiladores precisam produzir dialetos incompatíveis a partir da
 * mesma fonte, e cada fornecedor recusa a requisição inteira quando encontra
 * uma palavra-chave que não aceita. Sem estas asserções, a violação só
 * apareceria em produção, num provedor só, na forma de erro 400 sem explicação
 * útil.
 */

/** Esquema representativo: aninha objeto, lista, enum, opcional e inteiro. */
const ESQUEMA: EsquemaNeutro = objeto(
  {
    titulo: texto(),
    prioridade: texto({ enumeracao: ['ALTA', 'MEDIA', 'BAIXA'] }),
    quantidade: numero({ inteiro: true }),
    observacao: texto(),
    itens: lista(
      objeto({
        nome: texto(),
        peso: numero(),
      }),
    ),
  },
  { opcionais: ['observacao'] },
);

/** Percorre a árvore compilada, para asserir invariantes em TODO nível. */
function percorrer(no: unknown, visitar: (objeto: Record<string, unknown>) => void): void {
  if (Array.isArray(no)) {
    for (const filho of no) percorrer(filho, visitar);
    return;
  }
  if (no && typeof no === 'object') {
    const registro = no as Record<string, unknown>;
    visitar(registro);
    for (const valor of Object.values(registro)) percorrer(valor, visitar);
  }
}

describe('paraAnthropic', () => {
  const compilado = paraAnthropic(ESQUEMA);

  it('fecha todo objeto com additionalProperties: false', () => {
    // A API rejeita objeto aberto na saída estruturada.
    percorrer(compilado, (no) => {
      if (no['type'] === 'object') {
        expect(no['additionalProperties'], JSON.stringify(no)).toBe(false);
      }
    });
  });

  it('exige TODAS as chaves, inclusive as opcionais', () => {
    // Opcional é representado por `anyOf [T, null]`, não por chave ausente:
    // assim a chave sempre existe na resposta e o Zod não precisa distinguir
    // "veio nulo" de "não veio".
    percorrer(compilado, (no) => {
      if (no['type'] === 'object') {
        const propriedades = Object.keys(no['properties'] as Record<string, unknown>);
        expect(no['required']).toEqual(propriedades);
      }
    });
  });

  it('representa o campo opcional como anyOf com null', () => {
    const propriedades = (compilado['properties'] as Record<string, Record<string, unknown>>)!;
    expect(propriedades['observacao']!['anyOf']).toEqual([{ type: 'string' }, { type: 'null' }]);
  });

  it('não emite nenhuma palavra-chave de limite', () => {
    // `minLength`, `maximum` e afins fazem a API recusar a requisição.
    const serializado = JSON.stringify(compilado);
    for (const proibida of ['minLength', 'maxLength', 'minimum', 'maximum', 'minItems']) {
      expect(serializado, `emitiu ${proibida}`).not.toContain(proibida);
    }
  });

  it('usa nomes de tipo em minúsculas', () => {
    percorrer(compilado, (no) => {
      if (typeof no['type'] === 'string') {
        expect(no['type']).toBe((no['type'] as string).toLowerCase());
      }
    });
  });
});

describe('paraGemini', () => {
  const compilado = paraGemini(ESQUEMA);

  it('nunca emite additionalProperties nem $ref', () => {
    // As duas fazem o Gemini recusar a requisição inteira.
    const serializado = JSON.stringify(compilado);
    expect(serializado).not.toContain('additionalProperties');
    expect(serializado).not.toContain('$ref');
  });

  it('usa nomes de tipo em MAIÚSCULAS', () => {
    percorrer(compilado, (no) => {
      if (typeof no['type'] === 'string') {
        expect(no['type']).toBe((no['type'] as string).toUpperCase());
      }
    });
  });

  it('marca o opcional com nullable e o tira do required', () => {
    const propriedades = (compilado['properties'] as Record<string, Record<string, unknown>>)!;
    expect(propriedades['observacao']!['nullable']).toBe(true);
    expect(compilado['required']).not.toContain('observacao');
    expect(compilado['required']).toContain('titulo');
  });

  it('declara propertyOrdering com todas as chaves do objeto', () => {
    // Sem a ordem explícita, o modelo varia a sequência entre chamadas e a
    // qualidade cai quando um campo depende de outro gerado depois.
    percorrer(compilado, (no) => {
      if (no['type'] === 'OBJECT') {
        const propriedades = Object.keys(no['properties'] as Record<string, unknown>);
        expect(no['propertyOrdering']).toEqual(propriedades);
      }
    });
  });
});

describe('os dois dialetos descrevem a mesma coisa', () => {
  it('expõem o mesmo conjunto de campos, em todo nível', () => {
    // É esta asserção que pega a divergência que dois arquivos escritos à mão
    // teriam produzido.
    const chavesAnthropic = Object.keys(
      (paraAnthropic(ESQUEMA)['properties'] as Record<string, unknown>)!,
    );
    const chavesGemini = Object.keys((paraGemini(ESQUEMA)['properties'] as Record<string, unknown>)!);
    expect(chavesAnthropic.sort()).toEqual(chavesGemini.sort());
  });

  it('preservam a enumeração', () => {
    const daAnthropic = (paraAnthropic(ESQUEMA)['properties'] as Record<string, Record<string, unknown>>)!;
    const doGemini = (paraGemini(ESQUEMA)['properties'] as Record<string, Record<string, unknown>>)!;
    expect(daAnthropic['prioridade']!['enum']).toEqual(['ALTA', 'MEDIA', 'BAIXA']);
    expect(doGemini['prioridade']!['enum']).toEqual(['ALTA', 'MEDIA', 'BAIXA']);
  });
});
