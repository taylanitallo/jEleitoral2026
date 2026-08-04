import { describe, expect, it } from 'vitest';
import { PRECOS_POR_MODELO, calcularCusto } from './precos.js';
import type { UsoTokens } from './provedores/provedorIa.js';

const SEM_CACHE: UsoTokens = {
  entrada: 1_000_000,
  saida: 1_000_000,
  cacheLeitura: 0,
  cacheEscrita: 0,
  raciocinio: 0,
};

describe('calcularCusto', () => {
  it('cobra entrada e saída pelo preço do modelo', () => {
    // Sonnet 5: US$ 3 de entrada + US$ 15 de saída por milhão.
    expect(calcularCusto('claude-sonnet-5', SEM_CACHE).custo).toBe(18);
  });

  it('é o teste que teria pego o defeito de custo do sistema', () => {
    /*
     * O código antigo tinha PRECO_ENTRADA=5 e PRECO_SAIDA=25 fixos — os preços
     * do Opus 5 — enquanto o modelo padrão configurado era o Sonnet 5. Um
     * milhão de tokens de cada lado era gravado como US$ 30 quando o custo real
     * é US$ 18: 67% a mais, em silêncio.
     */
    const opus = calcularCusto('claude-opus-5', SEM_CACHE).custo;
    const sonnet = calcularCusto('claude-sonnet-5', SEM_CACHE).custo;

    expect(opus).toBe(30);
    expect(sonnet).toBe(18);
    expect(opus).not.toBe(sonnet);
  });

  it('cobra os tokens de cache, que a conta antiga ignorava', () => {
    const comCache = calcularCusto('claude-sonnet-5', {
      entrada: 0,
      saida: 0,
      cacheLeitura: 1_000_000,
      cacheEscrita: 1_000_000,
      raciocinio: 0,
    });
    // Leitura 0,3 + escrita 3,75 por milhão.
    expect(comCache.custo).toBeCloseTo(4.05, 6);
  });

  it('reconhece variante datada pelo prefixo', () => {
    // Os provedores republicam com sufixo de data; exigir igualdade exata faria
    // o custo cair a zero em silêncio a cada republicação.
    const datado = calcularCusto('claude-sonnet-5-20260114', SEM_CACHE);
    expect(datado.precoConhecido).toBe(true);
    expect(datado.modeloUsadoNaTabela).toBe('claude-sonnet-5');
    expect(datado.custo).toBe(18);
  });

  it('não falha com modelo desconhecido, mas AVISA', () => {
    // Devolver zero calado é como o defeito anterior sobreviveu tanto tempo.
    const desconhecido = calcularCusto('modelo-que-nao-existe', SEM_CACHE);
    expect(desconhecido.custo).toBe(0);
    expect(desconhecido.precoConhecido).toBe(false);
    expect(desconhecido.modeloUsadoNaTabela).toBeNull();
  });

  it('arredonda para 6 casas, que é o que a coluna aceita', () => {
    // `usos_ia.custo_estimado` é numeric(10,6); mais casas fariam o banco
    // recusar a gravação de uma chamada barata.
    const minusculo = calcularCusto('claude-haiku-4-5', {
      entrada: 7,
      saida: 3,
      cacheLeitura: 0,
      cacheEscrita: 0,
      raciocinio: 0,
    });
    const casas = String(minusculo.custo).split('.')[1] ?? '';
    expect(casas.length).toBeLessThanOrEqual(6);
  });

  it('o modelo padrão da configuração tem preço na tabela', () => {
    /*
     * A guarda que faltava. Se alguém trocar `IA_MODELO_PADRAO` por um modelo
     * ausente da tabela, o custo passa a ser zero e ninguém percebe até a
     * fatura. Aqui o build quebra.
     */
    const padrao = process.env['IA_MODELO_PADRAO'] ?? 'claude-sonnet-5';
    expect(
      calcularCusto(padrao, SEM_CACHE).precoConhecido,
      `O modelo padrão "${padrao}" não está em PRECOS_POR_MODELO.`,
    ).toBe(true);
  });
});

describe('PRECOS_POR_MODELO', () => {
  it('nenhum modelo tem saída mais barata que entrada', () => {
    // Nenhum provedor precifica assim; inverter as duas colunas ao acrescentar
    // um modelo é o erro de digitação mais provável nesta tabela.
    for (const [modelo, preco] of Object.entries(PRECOS_POR_MODELO)) {
      expect(preco.saida, `${modelo} com saída <= entrada`).toBeGreaterThan(preco.entrada);
    }
  });

  it('leitura de cache é sempre mais barata que a entrada', () => {
    for (const [modelo, preco] of Object.entries(PRECOS_POR_MODELO)) {
      expect(preco.cacheLeitura, `${modelo}`).toBeLessThan(preco.entrada);
    }
  });

  it('escrita de cache é sempre mais cara que a entrada', () => {
    // Escrever no cache custa mais que processar sem cache; é o que torna o
    // cache um investimento e não um desconto.
    for (const [modelo, preco] of Object.entries(PRECOS_POR_MODELO)) {
      expect(preco.cacheEscrita, `${modelo}`).toBeGreaterThan(preco.entrada);
    }
  });
});
