import { describe, expect, it } from 'vitest';
import {
  agregar,
  pesoPorCerteza,
  projetar,
  PARAMETROS_PROJECAO,
  type IntencaoAmostrada,
  type InsumosProjecao,
} from './motorProjecao.js';

/** Seção típica: 400 eleitores. */
const ELEITORADO = 400;

function intencoes(
  quantidade: number,
  opcoes: Partial<IntencaoAmostrada> = {},
): IntencaoAmostrada[] {
  return Array.from({ length: quantidade }, () => ({
    grauCerteza: 5,
    porDomicilio: false,
    quantidade: 1,
    ...opcoes,
  }));
}

function insumos(alteracoes: Partial<InsumosProjecao> = {}): InsumosProjecao {
  return {
    eleitoradoBase: ELEITORADO,
    amostraTamanho: 80,
    intencoesDoCandidato: intencoes(40),
    declaracoesValidas: 80,
    fracaoHistorica: null,
    ...alteracoes,
  };
}

describe('pesoPorCerteza', () => {
  it('pesa menos quem está menos certo', () => {
    expect(pesoPorCerteza(5)).toBe(1);
    expect(pesoPorCerteza(3)).toBe(0.6);
    expect(pesoPorCerteza(1)).toBe(0.2);
  });

  it('trata valores fora da faixa sem quebrar', () => {
    expect(pesoPorCerteza(0)).toBe(0.2);
    expect(pesoPorCerteza(9)).toBe(1);
  });
});

describe('projetar — sem base', () => {
  it('recusa projetar sem eleitorado do TSE', () => {
    const resultado = projetar(insumos({ eleitoradoBase: 0 }));
    expect(resultado.metodo).toBe('SEM_BASE');
    expect(resultado.votosProjetados).toBe(0);
    expect(resultado.advertencia).toMatch(/eleitorado/i);
  });

  it('recusa projetar sem entrevistas e sem histórico', () => {
    const resultado = projetar(
      insumos({ amostraTamanho: 0, intencoesDoCandidato: [], declaracoesValidas: 0 }),
    );
    expect(resultado.metodo).toBe('SEM_BASE');
    expect(resultado.indiceConfianca).toBe(0);
  });

  it('recusa projetar com amostra minúscula e sem histórico', () => {
    // 5 entrevistas em 400 eleitores. Extrapolar isso daria um número que
    // parece preciso e não é — o pior tipo de erro neste sistema.
    const resultado = projetar(
      insumos({ amostraTamanho: 5, intencoesDoCandidato: intencoes(4), declaracoesValidas: 5 }),
    );
    expect(resultado.metodo).toBe('SEM_BASE');
    expect(resultado.advertencia).toMatch(/não seria informativo/i);
  });
});

describe('projetar — amostra direta', () => {
  it('extrapola a proporção quando a cobertura é boa', () => {
    // 80 de 400 = 20% de cobertura, metade declarou o candidato.
    const resultado = projetar(insumos());
    expect(resultado.metodo).toBe('AMOSTRA_DIRETA');
    expect(resultado.coberturaAmostral).toBeCloseTo(0.2, 5);
    expect(resultado.votosProjetados).toBeCloseTo(200, 0);
  });

  it('não emite advertência quando a cobertura sustenta o número', () => {
    expect(projetar(insumos()).advertencia).toBeNull();
  });

  it('produz intervalo que contém a projeção e respeita o eleitorado', () => {
    const resultado = projetar(insumos());
    expect(resultado.intervaloMin).toBeLessThanOrEqual(resultado.votosProjetados);
    expect(resultado.intervaloMax).toBeGreaterThanOrEqual(resultado.votosProjetados);
    expect(resultado.intervaloMax).toBeLessThanOrEqual(ELEITORADO);
    expect(resultado.intervaloMin).toBeGreaterThanOrEqual(0);
  });

  it('estreita o intervalo conforme a amostra cresce', () => {
    const pequena = projetar(
      insumos({ amostraTamanho: 20, intencoesDoCandidato: intencoes(10), declaracoesValidas: 20 }),
    );
    const grande = projetar(
      insumos({
        amostraTamanho: 200,
        intencoesDoCandidato: intencoes(100),
        declaracoesValidas: 200,
      }),
    );
    const larguraPequena = pequena.intervaloMax - pequena.intervaloMin;
    const larguraGrande = grande.intervaloMax - grande.intervaloMin;
    expect(larguraGrande).toBeLessThan(larguraPequena);
  });
});

describe('ponderação por certeza e por domicílio', () => {
  it('projeta menos quando os eleitores estão inseguros', () => {
    const certos = projetar(insumos({ intencoesDoCandidato: intencoes(40, { grauCerteza: 5 }) }));
    const inseguros = projetar(
      insumos({ intencoesDoCandidato: intencoes(40, { grauCerteza: 2 }) }),
    );
    expect(inseguros.votosProjetados).toBeLessThan(certos.votosProjetados);
  });

  it('desconta o voto declarado pelo domicílio', () => {
    const individual = projetar(
      insumos({ intencoesDoCandidato: intencoes(40, { porDomicilio: false }) }),
    );
    const porDomicilio = projetar(
      insumos({ intencoesDoCandidato: intencoes(40, { porDomicilio: true }) }),
    );
    expect(porDomicilio.votosProjetados).toBeCloseTo(
      individual.votosProjetados * PARAMETROS_PROJECAO.pesoVotoDomicilio,
      5,
    );
  });
});

describe('projetar — histórico e híbrido', () => {
  it('usa o histórico quando a amostra é pequena demais', () => {
    const resultado = projetar(
      insumos({
        amostraTamanho: 8,
        intencoesDoCandidato: intencoes(8),
        declaracoesValidas: 8,
        fracaoHistorica: 0.3,
      }),
    );
    expect(resultado.metodo).toBe('HISTORICO_PONDERADO');
    expect(resultado.votosProjetados).toBeCloseTo(0.3 * ELEITORADO, 0);
    expect(resultado.advertencia).toMatch(/2022/);
  });

  it('mistura amostra e histórico na faixa intermediária', () => {
    // 24 de 400 = 6% de cobertura: acima do mínimo, abaixo do confiável.
    const resultado = projetar(
      insumos({
        amostraTamanho: 24,
        intencoesDoCandidato: intencoes(24),
        declaracoesValidas: 24,
        fracaoHistorica: 0.2,
      }),
    );
    expect(resultado.metodo).toBe('HIBRIDO');
    // A amostra diz 100%, o histórico diz 20%. O resultado fica entre os dois.
    const fracao = resultado.votosProjetados / ELEITORADO;
    expect(fracao).toBeGreaterThan(0.2);
    expect(fracao).toBeLessThan(1);
  });

  it('desloca o peso para a amostra conforme a cobertura sobe', () => {
    const construir = (amostra: number) =>
      projetar(
        insumos({
          amostraTamanho: amostra,
          intencoesDoCandidato: intencoes(amostra),
          declaracoesValidas: amostra,
          fracaoHistorica: 0.2,
        }),
      );
    const menor = construir(20);
    const maior = construir(50);
    // Amostra diz 100%; quanto mais cobertura, mais perto de 100% o resultado.
    expect(maior.votosProjetados).toBeGreaterThan(menor.votosProjetados);
  });
});

describe('índice de confiança', () => {
  it('cresce com a cobertura', () => {
    const rala = projetar(
      insumos({ amostraTamanho: 20, intencoesDoCandidato: intencoes(10), declaracoesValidas: 20 }),
    );
    const densa = projetar(
      insumos({
        amostraTamanho: 200,
        intencoesDoCandidato: intencoes(100),
        declaracoesValidas: 200,
      }),
    );
    expect(densa.indiceConfianca).toBeGreaterThan(rala.indiceConfianca);
  });

  it('cai quando a amostra contradiz fortemente o histórico', () => {
    const coerente = projetar(insumos({ fracaoHistorica: 0.5 }));
    const discrepante = projetar(insumos({ fracaoHistorica: 0.05 }));
    expect(discrepante.indiceConfianca).toBeLessThan(coerente.indiceConfianca);
  });

  it('permanece entre 0 e 1 em qualquer cenário', () => {
    for (const amostra of [0, 1, 15, 100, 400]) {
      const resultado = projetar(
        insumos({
          amostraTamanho: amostra,
          intencoesDoCandidato: intencoes(amostra),
          declaracoesValidas: Math.max(1, amostra),
          fracaoHistorica: 0.25,
        }),
      );
      expect(resultado.indiceConfianca).toBeGreaterThanOrEqual(0);
      expect(resultado.indiceConfianca).toBeLessThanOrEqual(1);
    }
  });
});

describe('advertência', () => {
  it('avisa quando a cobertura é baixa, mesmo com projeção calculada', () => {
    const resultado = projetar(
      insumos({
        amostraTamanho: 24,
        intencoesDoCandidato: intencoes(12),
        declaracoesValidas: 24,
        fracaoHistorica: 0.3,
      }),
    );
    expect(resultado.advertencia).toMatch(/indicação, não como previsão/i);
  });
});

describe('agregar', () => {
  it('soma votos das seções e pondera a confiança pelo eleitorado', () => {
    const secaoPequenaEBoa = projetar(
      insumos({
        eleitoradoBase: 50,
        amostraTamanho: 40,
        intencoesDoCandidato: intencoes(30),
        declaracoesValidas: 40,
      }),
    );
    const secaoGrandeERala = projetar(
      insumos({
        eleitoradoBase: 1000,
        amostraTamanho: 40,
        intencoesDoCandidato: intencoes(20),
        declaracoesValidas: 40,
        fracaoHistorica: 0.3,
      }),
    );

    const agregado = agregar([secaoPequenaEBoa, secaoGrandeERala]);
    expect(agregado.votosProjetados).toBeCloseTo(
      secaoPequenaEBoa.votosProjetados + secaoGrandeERala.votosProjetados,
      5,
    );
    // A seção grande e mal mapeada domina o agregado, como deve.
    expect(agregado.indiceConfianca).toBeLessThan(secaoPequenaEBoa.indiceConfianca);
    expect(agregado.coberturaAmostral).toBeCloseTo(80 / 1050, 5);
  });

  it('devolve SEM_BASE para lista vazia', () => {
    expect(agregar([]).metodo).toBe('SEM_BASE');
  });
});
