import { describe, expect, it } from 'vitest';
import {
  buscarSimilares,
  normalizarLogradouro,
  normalizarNomePessoa,
  normalizarNumeroImovel,
  normalizarTexto,
  removerAcentos,
  similaridade,
} from '../texto';

describe('normalização', () => {
  it('remove acentos preservando as letras', () => {
    expect(removerAcentos('SÃO JOSÉ DA CONCEIÇÃO')).toBe('SAO JOSE DA CONCEICAO');
  });

  it('padroniza caixa, pontuação e espaços', () => {
    expect(normalizarTexto('  Rua   São  José, 42 ')).toBe('RUA SAO JOSE 42');
  });
});

describe('normalizarLogradouro', () => {
  it('faz colidir as variações de escrita que aparecem em campo', () => {
    const canonico = 'RUA SAO JOSE';
    expect(normalizarLogradouro('Rua São José')).toBe(canonico);
    expect(normalizarLogradouro('R. Sao Jose')).toBe(canonico);
    expect(normalizarLogradouro('r sao jose')).toBe(canonico);
  });

  it('expande títulos abreviados', () => {
    expect(normalizarLogradouro('Av. Pres. Dr. Getúlio Vargas')).toBe(
      'AVENIDA PRESIDENTE DOUTOR GETULIO VARGAS',
    );
  });

  it('descarta partículas que não distinguem logradouros', () => {
    expect(normalizarLogradouro('Rua dos Andradas')).toBe('RUA ANDRADAS');
    expect(normalizarLogradouro('Rua Andradas')).toBe('RUA ANDRADAS');
  });
});

describe('normalizarNomePessoa', () => {
  it('faz colidir nome com e sem partícula', () => {
    expect(normalizarNomePessoa('Maria de Souza')).toBe('MARIA SOUZA');
    expect(normalizarNomePessoa('Maria Souza')).toBe('MARIA SOUZA');
  });
});

describe('similaridade', () => {
  it('devolve 1 para textos idênticos após normalização', () => {
    expect(similaridade('Rua São José', 'RUA SAO JOSE')).toBe(1);
  });

  it('devolve 0 para textos sem trigramas em comum', () => {
    expect(similaridade('ABC', 'XYZ')).toBe(0);
  });

  it('devolve 0 quando um dos lados é vazio', () => {
    expect(similaridade('', 'Rua São José')).toBe(0);
  });

  it('pontua alto para erro de digitação e baixo para ruas diferentes', () => {
    const comErro = similaridade('RUA SAO JOSE', 'RUA SAO JOSSE');
    const outraRua = similaridade('RUA SAO JOSE', 'AVENIDA BRASIL');
    expect(comErro).toBeGreaterThan(0.6);
    expect(outraRua).toBeLessThan(0.2);
    expect(comErro).toBeGreaterThan(outraRua);
  });

  it('é simétrica', () => {
    expect(similaridade('RUA SAO JOSE', 'RUA SAO JOAO')).toBeCloseTo(
      similaridade('RUA SAO JOAO', 'RUA SAO JOSE'),
      10,
    );
  });
});

describe('buscarSimilares', () => {
  const logradouros = [
    { id: 1, nome: 'Rua São José' },
    { id: 2, nome: 'R. Sao Jose' },
    { id: 3, nome: 'Rua São João' },
    { id: 4, nome: 'Avenida Brasil' },
    { id: 5, nome: 'Travessa das Flores' },
  ];

  it('sugere os mais parecidos em ordem decrescente', () => {
    const sugestoes = buscarSimilares('Rua Sao Jose', logradouros, (l) => l.nome);
    expect(sugestoes.length).toBeGreaterThan(0);
    expect([1, 2]).toContain(sugestoes[0]?.item.id);
    for (let i = 1; i < sugestoes.length; i += 1) {
      expect(sugestoes[i - 1]!.similaridade).toBeGreaterThanOrEqual(sugestoes[i]!.similaridade);
    }
  });

  it('não sugere logradouro sem relação', () => {
    const sugestoes = buscarSimilares('Rua Sao Jose', logradouros, (l) => l.nome);
    expect(sugestoes.map((s) => s.item.id)).not.toContain(4);
  });

  it('respeita o limite de sugestões', () => {
    const sugestoes = buscarSimilares('Rua Sao Jose', logradouros, (l) => l.nome, {
      limiar: 0,
      limite: 2,
    });
    expect(sugestoes).toHaveLength(2);
  });
});

describe('normalizarNumeroImovel', () => {
  it('remove zeros à esquerda', () => {
    expect(normalizarNumeroImovel('0042')).toBe('42');
  });

  it('padroniza ausência de número', () => {
    expect(normalizarNumeroImovel('s/n')).toBe('SN');
    expect(normalizarNumeroImovel('Sem Número')).toBe('SN');
    expect(normalizarNumeroImovel('')).toBe('SN');
  });
});
