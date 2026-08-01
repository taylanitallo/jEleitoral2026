import { describe, expect, it } from 'vitest';
import { avaliarMeta, distribuirMeta, type EntradaAvaliacaoMeta } from './calculoMetas.js';

const INICIO = new Date('2026-08-01T00:00:00Z');
const PRAZO = new Date('2026-10-04T00:00:00Z');
const HOJE = new Date('2026-09-01T00:00:00Z'); // 31 dias depois do início

function entrada(alteracoes: Partial<EntradaAvaliacaoMeta> = {}): EntradaAvaliacaoMeta {
  return {
    tipo: 'VOTOS_ABSOLUTOS',
    valor: 1000,
    eleitoradoBase: 5000,
    realizado: 400,
    projetado: 1000,
    inicioEm: INICIO,
    prazo: PRAZO,
    hoje: HOJE,
    ...alteracoes,
  };
}

describe('conversão do tipo de meta', () => {
  it('usa o valor direto em meta de votos absolutos', () => {
    expect(avaliarMeta(entrada()).valorAlvo).toBe(1000);
  });

  it('converte meta percentual sobre o eleitorado do recorte', () => {
    const avaliacao = avaliarMeta(entrada({ tipo: 'PERCENTUAL', valor: 30 }));
    expect(avaliacao.valorAlvo).toBe(1500);
  });
});

describe('situação decidida pela projeção, não pelo realizado', () => {
  it('marca NO_RUMO quando a projeção fecha, mesmo com pouco realizado', () => {
    // 40% realizado no meio do prazo, mas projetado bate a meta.
    const avaliacao = avaliarMeta(entrada({ realizado: 400, projetado: 1050 }));
    expect(avaliacao.situacao).toBe('NO_RUMO');
    expect(avaliacao.percentualRealizado).toBeCloseTo(0.4, 5);
  });

  it('marca EM_RISCO com o mesmo realizado quando a projeção não fecha', () => {
    const avaliacao = avaliarMeta(entrada({ realizado: 400, projetado: 600 }));
    expect(avaliacao.situacao).toBe('EM_RISCO');
    expect(avaliacao.mensagem).toMatch(/ritmo atual/i);
  });

  it('marca ATENCAO quando a projeção fica pouco abaixo', () => {
    const avaliacao = avaliarMeta(entrada({ projetado: 900 }));
    expect(avaliacao.situacao).toBe('ATENCAO');
  });

  it('marca ATINGIDA quando o realizado alcança o alvo', () => {
    const avaliacao = avaliarMeta(entrada({ realizado: 1000, projetado: 1000 }));
    expect(avaliacao.situacao).toBe('ATINGIDA');
    expect(avaliacao.mensagem).toBe('Meta atingida.');
  });

  it('prazo vencido sem atingir é risco consumado, não atenção', () => {
    const avaliacao = avaliarMeta(
      entrada({
        prazo: new Date('2026-08-20T00:00:00Z'),
        hoje: new Date('2026-09-01T00:00:00Z'),
        projetado: 990,
      }),
    );
    expect(avaliacao.situacao).toBe('EM_RISCO');
  });

  it('meta sem prazo não é avaliada por ritmo', () => {
    const avaliacao = avaliarMeta(entrada({ prazo: null }));
    expect(avaliacao.situacao).toBe('SEM_PRAZO');
    expect(avaliacao.ritmoNecessarioPorDia).toBeNull();
    expect(avaliacao.diasRestantes).toBeNull();
  });
});

describe('ritmo', () => {
  it('calcula o ritmo atual sobre os dias decorridos', () => {
    const avaliacao = avaliarMeta(entrada({ realizado: 310 }));
    expect(avaliacao.diasDecorridos).toBe(31);
    expect(avaliacao.ritmoAtualPorDia).toBeCloseTo(10, 5);
  });

  it('calcula quanto por dia falta para fechar no prazo', () => {
    const avaliacao = avaliarMeta(entrada({ realizado: 400 }));
    expect(avaliacao.diasRestantes).toBe(33);
    expect(avaliacao.ritmoNecessarioPorDia).toBeCloseTo(600 / 33, 5);
  });

  it('não divide por zero no primeiro dia', () => {
    const avaliacao = avaliarMeta(entrada({ hoje: INICIO, realizado: 5 }));
    expect(avaliacao.diasDecorridos).toBe(0);
    expect(Number.isFinite(avaliacao.ritmoAtualPorDia)).toBe(true);
    expect(avaliacao.ritmoAtualPorDia).toBe(5);
  });

  it('não pede ritmo negativo quando o realizado já passou do alvo', () => {
    const avaliacao = avaliarMeta(entrada({ realizado: 1200 }));
    expect(avaliacao.ritmoNecessarioPorDia).toBe(0);
  });
});

describe('distribuirMeta', () => {
  it('distribui proporcionalmente ao eleitorado', () => {
    const partes = distribuirMeta(1000, [
      { id: 'a', eleitorado: 6000 },
      { id: 'b', eleitorado: 4000 },
    ]);
    expect(partes).toEqual([
      { id: 'a', valor: 600 },
      { id: 'b', valor: 400 },
    ]);
  });

  it('a soma das partes é exatamente a meta, sem perda de arredondamento', () => {
    const recortes = Array.from({ length: 7 }, (_, i) => ({ id: `b${i}`, eleitorado: 143 }));
    const partes = distribuirMeta(1000, recortes);
    expect(partes.reduce((soma, p) => soma + p.valor, 0)).toBe(1000);
  });

  it('devolve zeros quando não há eleitorado conhecido', () => {
    const partes = distribuirMeta(1000, [{ id: 'a', eleitorado: 0 }]);
    expect(partes).toEqual([{ id: 'a', valor: 0 }]);
  });

  it('tolera lista vazia', () => {
    expect(distribuirMeta(1000, [])).toEqual([]);
  });
});
