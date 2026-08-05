import { describe, expect, it } from 'vitest';
import { diferencaEntreVersoes, type EntrevistaComparavel } from './diferencaEntrevista.js';

function base(alteracoes: Partial<EntrevistaComparavel> = {}): EntrevistaComparavel {
  return {
    nomeEntrevistado: 'Maria da Silva',
    classificacao: 'PROVAVEL',
    recusouResponder: false,
    observacoes: null,
    intencoes: [
      { idCargo: 'cargo-presidente', nomeCargo: 'Presidente', posicao: 1, rotulo: 'Lula (13)' },
    ],
    ...alteracoes,
  };
}

describe('diferencaEntreVersoes', () => {
  it('duas versões idênticas não produzem diferença nenhuma', () => {
    expect(diferencaEntreVersoes(base(), base())).toEqual([]);
  });

  it('detecta correção de nome', () => {
    const diff = diferencaEntreVersoes(
      base({ nomeEntrevistado: 'Maria da Silvaa' }),
      base({ nomeEntrevistado: 'Maria da Silva' }),
    );
    expect(diff).toEqual([
      {
        campo: 'nomeEntrevistado',
        rotulo: 'Nome',
        antes: 'Maria da Silvaa',
        depois: 'Maria da Silva',
        natureza: 'IDENTIFICACAO',
      },
    ]);
  });

  it('detecta troca de candidato no mesmo cargo', () => {
    const diff = diferencaEntreVersoes(
      base(),
      base({
        intencoes: [
          {
            idCargo: 'cargo-presidente',
            nomeCargo: 'Presidente',
            posicao: 1,
            rotulo: 'Bolsonaro (22)',
          },
        ],
      }),
    );
    expect(diff).toEqual([
      {
        campo: 'intencao:cargo-presidente:1',
        rotulo: 'Presidente',
        antes: 'Lula (13)',
        depois: 'Bolsonaro (22)',
        natureza: 'INTENCAO',
      },
    ]);
  });

  it('rotula o segundo voto do Senado como "(2º voto)"', () => {
    // É a razão de existir do campo `posicao`: sem ele, os dois votos do
    // Senado teriam a mesma chave e um apagaria o outro no Map.
    const anterior = base({
      intencoes: [
        { idCargo: 'cargo-senador', nomeCargo: 'Senador', posicao: 1, rotulo: 'João (123)' },
        { idCargo: 'cargo-senador', nomeCargo: 'Senador', posicao: 2, rotulo: 'Ana (456)' },
      ],
    });
    const atual = base({
      intencoes: [
        { idCargo: 'cargo-senador', nomeCargo: 'Senador', posicao: 1, rotulo: 'João (123)' },
        { idCargo: 'cargo-senador', nomeCargo: 'Senador', posicao: 2, rotulo: 'Pedro (789)' },
      ],
    });
    const diff = diferencaEntreVersoes(anterior, atual);
    expect(diff).toEqual([
      {
        campo: 'intencao:cargo-senador:2',
        rotulo: 'Senador (2º voto)',
        antes: 'Ana (456)',
        depois: 'Pedro (789)',
        natureza: 'INTENCAO',
      },
    ]);
  });

  it('slot que deixou de existir aparece com depois=null', () => {
    const diff = diferencaEntreVersoes(base(), base({ intencoes: [] }));
    expect(diff).toEqual([
      {
        campo: 'intencao:cargo-presidente:1',
        rotulo: 'Presidente',
        antes: 'Lula (13)',
        depois: null,
        natureza: 'INTENCAO',
      },
    ]);
  });

  it('slot novo aparece com antes=null', () => {
    const anterior = base({ intencoes: [] });
    const diff = diferencaEntreVersoes(anterior, base());
    expect(diff).toEqual([
      {
        campo: 'intencao:cargo-presidente:1',
        rotulo: 'Presidente',
        antes: null,
        depois: 'Lula (13)',
        natureza: 'INTENCAO',
      },
    ]);
  });

  it('observações em branco e nulo contam como iguais', () => {
    // O formulário manda string vazia; o banco guarda null. Sem normalizar,
    // toda entrevista sem observação apareceria com uma mudança fantasma.
    expect(diferencaEntreVersoes(base({ observacoes: '' }), base({ observacoes: null }))).toEqual(
      [],
    );
    expect(
      diferencaEntreVersoes(base({ observacoes: '   ' }), base({ observacoes: null })),
    ).toEqual([]);
  });

  it('recusar responder é comparado e rotulado em português', () => {
    const diff = diferencaEntreVersoes(
      base({ recusouResponder: false }),
      base({ recusouResponder: true }),
    );
    expect(diff).toEqual([
      {
        campo: 'recusouResponder',
        rotulo: 'Recusou responder',
        antes: 'Não',
        depois: 'Sim',
        natureza: 'CONTEXTO',
      },
    ]);
  });

  it('várias mudanças na mesma retificação aparecem todas, em ordem', () => {
    const diff = diferencaEntreVersoes(
      base({ nomeEntrevistado: 'Erro De Digitacao' }),
      base({ nomeEntrevistado: 'Maria da Silva', observacoes: 'confirmado por telefone' }),
    );
    expect(diff.map((d) => d.campo)).toEqual(['nomeEntrevistado', 'observacoes']);
  });
});
