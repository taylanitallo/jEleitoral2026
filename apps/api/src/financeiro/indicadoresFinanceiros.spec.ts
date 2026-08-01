import { describe, expect, it } from 'vitest';
import {
  calcularCustoPorTerritorio,
  compararOrcamento,
  resumirFinanceiro,
} from './indicadoresFinanceiros.js';

describe('calcularCustoPorTerritorio', () => {
  const desempenho = [
    { idTerritorio: 'centro', eleitoresMapeados: 500, votosProjetados: 300 },
    { idTerritorio: 'periferia', eleitoresMapeados: 200, votosProjetados: 150 },
    { idTerritorio: 'rural', eleitoresMapeados: 0, votosProjetados: 0 },
  ];

  const lancamentos = [
    { idTerritorio: 'centro', totalDespesa: 6000, totalReceita: 0 },
    { idTerritorio: 'periferia', totalDespesa: 1500, totalReceita: 0 },
  ];

  it('calcula custo por eleitor mapeado e por voto projetado', () => {
    const linhas = calcularCustoPorTerritorio(lancamentos, desempenho);
    const centro = linhas.find((l) => l.idTerritorio === 'centro')!;
    expect(centro.custoPorEleitorMapeado).toBe(12);
    expect(centro.custoPorVotoProjetado).toBe(20);
  });

  it('mantém território sem investimento em vez de escondê-lo', () => {
    // Bairro que rende voto sem custo é exatamente o que o coordenador precisa ver.
    const linhas = calcularCustoPorTerritorio(
      [{ idTerritorio: 'centro', totalDespesa: 6000, totalReceita: 0 }],
      desempenho,
    );
    const periferia = linhas.find((l) => l.idTerritorio === 'periferia')!;
    expect(periferia.investido).toBe(0);
    expect(periferia.custoPorVotoProjetado).toBe(0);
  });

  it('devolve null em vez de infinito quando não há mapeamento', () => {
    const linhas = calcularCustoPorTerritorio(lancamentos, desempenho);
    const rural = linhas.find((l) => l.idTerritorio === 'rural')!;
    expect(rural.custoPorEleitorMapeado).toBeNull();
    expect(rural.custoPorVotoProjetado).toBeNull();
  });

  it('ordena por eficiência, com os sem projeção no fim', () => {
    const linhas = calcularCustoPorTerritorio(lancamentos, desempenho);
    const porId = Object.fromEntries(linhas.map((l) => [l.idTerritorio, l.posicaoEficiencia]));
    // periferia: R$ 10/voto; centro: R$ 20/voto; rural: sem dado.
    expect(porId['periferia']).toBe(1);
    expect(porId['centro']).toBe(2);
    expect(porId['rural']).toBe(3);
  });

  it('ignora lançamento sem território atribuído', () => {
    const linhas = calcularCustoPorTerritorio(
      [{ idTerritorio: null, totalDespesa: 90000, totalReceita: 0 }],
      desempenho,
    );
    expect(linhas.every((l) => l.investido === 0)).toBe(true);
  });
});

describe('resumirFinanceiro', () => {
  const PLEITO = new Date('2026-10-04T00:00:00Z');
  const HOJE = new Date('2026-09-04T00:00:00Z'); // 30 dias antes

  it('calcula saldo e queima diária', () => {
    const resumo = resumirFinanceiro({
      totalReceita: 100_000,
      totalDespesa: 30_000,
      diasDecorridos: 30,
      dataPleito: PLEITO,
      hoje: HOJE,
    });
    expect(resumo.saldo).toBe(70_000);
    expect(resumo.queimaDiaria).toBe(1000);
    expect(resumo.diasDeCaixa).toBe(70);
    expect(resumo.alerta).toBeNull();
  });

  it('alerta quando o caixa não chega ao dia da eleição', () => {
    const resumo = resumirFinanceiro({
      totalReceita: 40_000,
      totalDespesa: 30_000,
      diasDecorridos: 30,
      dataPleito: PLEITO,
      hoje: HOJE,
    });
    // Saldo de 10 mil, queimando mil por dia: 10 dias de fôlego para 30 de campanha.
    expect(resumo.diasDeCaixa).toBe(10);
    expect(resumo.diasFaltandoParaOPleito).toBe(30);
    expect(resumo.alerta).toMatch(/dura 10 dia/);
  });

  it('alerta quando as despesas já superam as receitas', () => {
    const resumo = resumirFinanceiro({
      totalReceita: 10_000,
      totalDespesa: 15_000,
      diasDecorridos: 30,
      dataPleito: PLEITO,
      hoje: HOJE,
    });
    expect(resumo.saldo).toBe(-5000);
    expect(resumo.alerta).toMatch(/superam as receitas/i);
  });

  it('não divide por zero sem despesa nem sem dias decorridos', () => {
    const resumo = resumirFinanceiro({
      totalReceita: 5000,
      totalDespesa: 0,
      diasDecorridos: 0,
      dataPleito: PLEITO,
      hoje: HOJE,
    });
    expect(resumo.queimaDiaria).toBe(0);
    expect(resumo.diasDeCaixa).toBeNull();
    expect(resumo.alerta).toBeNull();
  });

  it('não devolve dias negativos depois do pleito', () => {
    const resumo = resumirFinanceiro({
      totalReceita: 1000,
      totalDespesa: 500,
      diasDecorridos: 90,
      dataPleito: PLEITO,
      hoje: new Date('2026-11-01T00:00:00Z'),
    });
    expect(resumo.diasFaltandoParaOPleito).toBe(0);
  });
});

describe('compararOrcamento', () => {
  it('aponta estouro em valor e em fração', () => {
    const linhas = compararOrcamento(
      [{ idCentroCusto: 'grafica', valor: 30_000 }],
      [{ idCentroCusto: 'grafica', valor: 42_000 }],
    );
    expect(linhas[0]).toMatchObject({ desvio: 12_000, estourou: true });
    expect(linhas[0]?.desvioFracao).toBeCloseTo(0.4, 5);
  });

  it('inclui centro de custo com gasto e sem orçamento previsto', () => {
    const linhas = compararOrcamento([], [{ idCentroCusto: 'combustivel', valor: 5000 }]);
    expect(linhas).toHaveLength(1);
    expect(linhas[0]?.previsto).toBe(0);
    // Sem previsão não há percentual de desvio — "infinito por cento" não
    // ajuda ninguém a decidir.
    expect(linhas[0]?.desvioFracao).toBeNull();
    expect(linhas[0]?.estourou).toBe(true);
  });

  it('inclui centro de custo orçado e ainda não gasto', () => {
    const linhas = compararOrcamento([{ idCentroCusto: 'eventos', valor: 8000 }], []);
    expect(linhas[0]?.realizado).toBe(0);
    expect(linhas[0]?.desvio).toBe(-8000);
    expect(linhas[0]?.estourou).toBe(false);
  });
});
