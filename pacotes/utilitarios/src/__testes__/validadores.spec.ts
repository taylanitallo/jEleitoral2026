import { describe, expect, it } from 'vitest';
import {
  validarCep,
  validarCnpj,
  validarCpf,
  validarDataBr,
  validarEmail,
  validarTelefone,
  validarTituloEleitor,
  terIdadeDeVoto,
} from '../validadores';

describe('validarCpf', () => {
  it('aceita CPF com dígitos verificadores corretos', () => {
    expect(validarCpf('111.444.777-35')).toBe(true);
    expect(validarCpf('11144477735')).toBe(true);
  });

  it('rejeita CPF com dígito verificador errado', () => {
    expect(validarCpf('111.444.777-36')).toBe(false);
  });

  it('rejeita sequências repetidas, que passam no módulo 11 mas são inválidas', () => {
    expect(validarCpf('111.111.111-11')).toBe(false);
    expect(validarCpf('000.000.000-00')).toBe(false);
  });

  it('rejeita comprimento incorreto e valores vazios', () => {
    expect(validarCpf('1114447773')).toBe(false);
    expect(validarCpf('')).toBe(false);
    expect(validarCpf(null)).toBe(false);
  });
});

describe('validarCnpj', () => {
  it('aceita CNPJ válido com e sem máscara', () => {
    expect(validarCnpj('11.222.333/0001-81')).toBe(true);
    expect(validarCnpj('11222333000181')).toBe(true);
  });

  it('rejeita CNPJ com dígito verificador errado', () => {
    expect(validarCnpj('11.222.333/0001-82')).toBe(false);
  });

  it('rejeita sequência repetida', () => {
    expect(validarCnpj('11111111111111')).toBe(false);
  });
});

describe('validarTituloEleitor', () => {
  it('aceita título de UF com regra especial (SP)', () => {
    expect(validarTituloEleitor('123456780191')).toBe(true);
  });

  it('aceita título de UF sem regra especial (RJ)', () => {
    expect(validarTituloEleitor('876543210329')).toBe(true);
  });

  it('aceita com máscara de exibição', () => {
    expect(validarTituloEleitor('1234 5678 0191')).toBe(true);
  });

  it('rejeita dígito verificador incorreto', () => {
    expect(validarTituloEleitor('123456780192')).toBe(false);
  });

  it('rejeita código de UF fora da faixa 01–28', () => {
    expect(validarTituloEleitor('123456789991')).toBe(false);
  });

  it('rejeita comprimento diferente de 12 dígitos', () => {
    expect(validarTituloEleitor('12345678019')).toBe(false);
  });
});

describe('validarTelefone', () => {
  it('aceita fixo de 10 dígitos e celular de 11 iniciando por 9', () => {
    expect(validarTelefone('(11) 3123-4567')).toBe(true);
    expect(validarTelefone('(11) 91234-5678')).toBe(true);
  });

  it('rejeita celular de 11 dígitos que não começa com 9', () => {
    expect(validarTelefone('11812345678')).toBe(false);
  });

  it('rejeita DDD inválido', () => {
    expect(validarTelefone('(01) 91234-5678')).toBe(false);
  });
});

describe('validarCep e validarEmail', () => {
  it('valida CEP por comprimento', () => {
    expect(validarCep('01001-000')).toBe(true);
    expect(validarCep('0100100')).toBe(false);
  });

  it('valida e-mail em formato mínimo aceitável', () => {
    expect(validarEmail('taylan@jeos.com.br')).toBe(true);
    expect(validarEmail('taylan@jeos')).toBe(false);
    expect(validarEmail('sem-arroba.com')).toBe(false);
  });
});

describe('validarDataBr', () => {
  it('aceita data existente', () => {
    expect(validarDataBr('04/10/2026')).toBe(true);
    expect(validarDataBr('29/02/2024')).toBe(true);
  });

  it('rejeita data inexistente que o construtor Date aceitaria em silêncio', () => {
    expect(validarDataBr('31/02/2026')).toBe(false);
    expect(validarDataBr('29/02/2026')).toBe(false);
  });

  it('rejeita formato incorreto', () => {
    expect(validarDataBr('2026-10-04')).toBe(false);
  });
});

describe('terIdadeDeVoto', () => {
  const pleito = new Date('2026-10-04T00:00:00Z');

  it('aceita quem completa 16 anos até a data do pleito', () => {
    expect(terIdadeDeVoto(new Date('2010-10-04T00:00:00Z'), pleito)).toBe(true);
    expect(terIdadeDeVoto(new Date('2010-10-03T00:00:00Z'), pleito)).toBe(true);
  });

  it('rejeita quem completa 16 anos depois do pleito', () => {
    expect(terIdadeDeVoto(new Date('2010-10-05T00:00:00Z'), pleito)).toBe(false);
  });
});
