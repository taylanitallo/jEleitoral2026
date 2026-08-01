import { describe, expect, it } from 'vitest';
import {
  DadoPessoalNaIaError,
  garantirSemDadoPessoal,
  mascararDocumentosEmTexto,
  montarAdvertenciaDeCobertura,
} from './redacaoSegura.js';

describe('garantirSemDadoPessoal — campos proibidos', () => {
  it('deixa passar payload só com agregados', () => {
    const agregado = {
      idSecao: 'abc',
      totalMapeados: 412,
      porClassificacao: { APOIADOR: 200, OPOSICAO: 90 },
      coberturaAmostral: 0.184,
    };
    expect(garantirSemDadoPessoal(agregado)).toBe(agregado);
  });

  it('recusa campo de nome', () => {
    expect(() => garantirSemDadoPessoal({ nome: 'Maria' })).toThrow(DadoPessoalNaIaError);
  });

  it('reconhece a mesma proibição em snake_case e camelCase', () => {
    // O banco escreve `nome_completo`, a API escreve `nomeCompleto`. As duas
    // grafias precisam cair na mesma regra.
    expect(() => garantirSemDadoPessoal({ nome_completo: 'x' })).toThrow(DadoPessoalNaIaError);
    expect(() => garantirSemDadoPessoal({ nomeCompleto: 'x' })).toThrow(DadoPessoalNaIaError);
  });

  it('recusa mesmo o campo criptografado', () => {
    // Cifrado ou não, não há razão para o modelo receber isso.
    expect(() => garantirSemDadoPessoal({ cpf_criptografado: 'AAA:BBB:CCC' })).toThrow(
      DadoPessoalNaIaError,
    );
  });

  it('recusa geolocalização', () => {
    expect(() => garantirSemDadoPessoal({ latitude: -23.5 })).toThrow(DadoPessoalNaIaError);
  });

  it('encontra o campo proibido em profundidade e informa o caminho', () => {
    const payload = { secoes: [{ resumo: { telefone: '11999998888' } }] };
    try {
      garantirSemDadoPessoal(payload);
      expect.unreachable('deveria ter lançado');
    } catch (erro) {
      expect(erro).toBeInstanceOf(DadoPessoalNaIaError);
      expect((erro as DadoPessoalNaIaError).caminho).toBe('raiz.secoes[0].resumo.telefone');
    }
  });
});

describe('garantirSemDadoPessoal — documento em texto livre', () => {
  it('recusa CPF escrito na observação, com ou sem máscara', () => {
    expect(() => garantirSemDadoPessoal({ observacao: 'anotar 111.444.777-35' })).toThrow(/CPF/i);
    expect(() => garantirSemDadoPessoal({ observacao: 'anotar 11144477735' })).toThrow(/CPF/i);
  });

  it('recusa título de eleitor', () => {
    expect(() => garantirSemDadoPessoal({ observacao: 'titulo 1234 5678 0191' })).toThrow(
      /título/i,
    );
  });

  it('recusa telefone e e-mail', () => {
    expect(() => garantirSemDadoPessoal({ nota: 'ligar (11) 91234-5678' })).toThrow(/telefone/i);
    expect(() => garantirSemDadoPessoal({ nota: 'contato joao@exemplo.com' })).toThrow(/e-mail/i);
  });

  it('não confunde número de votos com documento', () => {
    const payload = { votosProjetados: 1240, eleitorado: 6000, ano: 2026 };
    expect(() => garantirSemDadoPessoal(payload)).not.toThrow();
  });

  it('tolera null e undefined sem quebrar', () => {
    expect(() => garantirSemDadoPessoal({ a: null, b: undefined })).not.toThrow();
  });
});

describe('mascararDocumentosEmTexto', () => {
  it('remove documentos preservando o restante do texto', () => {
    const original = 'Morador simpático, pediu contato pelo (11) 91234-5678 depois da visita.';
    const mascarado = mascararDocumentosEmTexto(original);
    expect(mascarado).not.toMatch(/91234/);
    expect(mascarado).toContain('Morador simpático');
    expect(mascarado).toContain('[removido]');
  });

  it('remove todas as ocorrências, não só a primeira', () => {
    const mascarado = mascararDocumentosEmTexto('a@b.com e c@d.com');
    expect(mascarado).toBe('[removido] e [removido]');
  });

  it('o resultado passa na barreira de recusa', () => {
    const mascarado = mascararDocumentosEmTexto('CPF 111.444.777-35 e fone (11) 91234-5678');
    expect(() => garantirSemDadoPessoal({ observacao: mascarado })).not.toThrow();
  });
});

describe('montarAdvertenciaDeCobertura', () => {
  it('não adverte quando a cobertura sustenta o diagnóstico', () => {
    expect(montarAdvertenciaDeCobertura(0.2)).toBeNull();
  });

  it('adverte com o percentual quando a cobertura é baixa', () => {
    const advertencia = montarAdvertenciaDeCobertura(0.041);
    expect(advertencia).toContain('4,1%');
    expect(advertencia).toMatch(/hipótese/i);
  });

  it('usa o mesmo limiar do motor de projeção', () => {
    expect(montarAdvertenciaDeCobertura(0.15)).toBeNull();
    expect(montarAdvertenciaDeCobertura(0.1499)).not.toBeNull();
  });
});
