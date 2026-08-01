import { describe, expect, it } from 'vitest';
import {
  avaliarMesclagem,
  parearCandidaturas,
  type CandidatoManual,
  type CandidaturaOficial,
} from './mesclagem.js';

const CARGO_DF = 'cargo-deputado-federal';
const CARGO_DE = 'cargo-deputado-estadual';

function manual(alteracoes: Partial<CandidatoManual> = {}): CandidatoManual {
  return {
    id: 'manual-1',
    nomeUrna: 'Maria da Silva',
    nomeCompleto: 'Maria da Silva Souza',
    numeroUrna: '1234',
    siglaPartido: 'PXY',
    idCargo: CARGO_DF,
    ...alteracoes,
  };
}

function oficial(alteracoes: Partial<CandidaturaOficial> = {}): CandidaturaOficial {
  return {
    idTse: 900001,
    nomeUrna: 'MARIA DA SILVA',
    nomeCompleto: 'MARIA DA SILVA SOUZA',
    numeroUrna: '1234',
    siglaPartido: 'PXY',
    idCargo: CARGO_DF,
    ...alteracoes,
  };
}

describe('avaliarMesclagem — decisão automática', () => {
  it('mescla quando número, partido e nome coincidem', () => {
    const avaliacao = avaliarMesclagem(manual(), oficial());
    expect(avaliacao.decisao).toBe('MESCLAR');
    expect(avaliacao.numeroConfere).toBe(true);
    expect(avaliacao.partidoConfere).toBe(true);
  });

  it('ignora acentuação e caixa na comparação de nome', () => {
    const avaliacao = avaliarMesclagem(
      manual({ nomeUrna: 'José Antônio' , nomeCompleto: 'José Antônio Pereira' }),
      oficial({ nomeUrna: 'JOSE ANTONIO', nomeCompleto: 'JOSE ANTONIO PEREIRA' }),
    );
    expect(avaliacao.decisao).toBe('MESCLAR');
  });

  it('aceita máscara diferente no número de urna', () => {
    const avaliacao = avaliarMesclagem(manual({ numeroUrna: '12 34' }), oficial());
    expect(avaliacao.numeroConfere).toBe(true);
  });
});

describe('avaliarMesclagem — nunca decide sozinha com evidência parcial', () => {
  it('manda para revisão quando só o número coincide', () => {
    // Mesmo número, partido diferente: pode ser troca de legenda na convenção,
    // pode ser outra pessoa. A automação não tem como saber.
    const avaliacao = avaliarMesclagem(manual(), oficial({ siglaPartido: 'PZZ' }));
    expect(avaliacao.decisao).toBe('REVISAR');
    expect(avaliacao.justificativa).toMatch(/legenda/i);
  });

  it('manda para revisão quando o nome bate mas o número não', () => {
    // Número de pré-candidatura costuma ser palpite antes do registro.
    const avaliacao = avaliarMesclagem(manual({ numeroUrna: '9999' }), oficial());
    expect(avaliacao.decisao).toBe('REVISAR');
    expect(avaliacao.justificativa).toMatch(/palpite|números diferentes/i);
  });

  it('manda para revisão em coincidência parcial de nome', () => {
    const avaliacao = avaliarMesclagem(
      manual({ nomeUrna: 'Maria Silva', nomeCompleto: 'Maria Silva', numeroUrna: '5555' }),
      oficial({ nomeUrna: 'MARIA SILVEIRA', nomeCompleto: 'MARIA SILVEIRA' }),
    );
    expect(avaliacao.decisao).toBe('REVISAR');
  });

  it('não mescla partido vazio dos dois lados como se fosse coincidência', () => {
    const avaliacao = avaliarMesclagem(
      manual({ siglaPartido: null }),
      oficial({ siglaPartido: null }),
    );
    expect(avaliacao.partidoConfere).toBe(false);
    expect(avaliacao.decisao).toBe('REVISAR');
  });
});

describe('avaliarMesclagem — descarte', () => {
  it('ignora cargos diferentes, mesmo com nome e partido iguais', () => {
    const avaliacao = avaliarMesclagem(manual(), oficial({ idCargo: CARGO_DE }));
    expect(avaliacao.decisao).toBe('IGNORAR');
    expect(avaliacao.justificativa).toMatch(/cargos diferentes/i);
  });

  it('ignora pessoas sem relação', () => {
    const avaliacao = avaliarMesclagem(
      manual({ nomeUrna: 'Maria da Silva', nomeCompleto: 'Maria da Silva', numeroUrna: '1111' }),
      oficial({ nomeUrna: 'PEDRO ALCANTARA', nomeCompleto: 'PEDRO ALCANTARA', numeroUrna: '2222' }),
    );
    expect(avaliacao.decisao).toBe('IGNORAR');
  });
});

describe('parearCandidaturas', () => {
  it('não atribui a mesma candidatura oficial a dois pré-candidatos', () => {
    // Dois irmãos na mesma chapa, nomes muito parecidos.
    const manuais = [
      manual({ id: 'a', nomeUrna: 'Carlos Andrade', nomeCompleto: 'Carlos Andrade', numeroUrna: '1010' }),
      manual({ id: 'b', nomeUrna: 'Carlos Andrade', nomeCompleto: 'Carlos Andrade', numeroUrna: '2020' }),
    ];
    const oficiais = [
      oficial({ idTse: 1, nomeUrna: 'CARLOS ANDRADE', nomeCompleto: 'CARLOS ANDRADE', numeroUrna: '1010' }),
    ];

    const pares = parearCandidaturas(manuais, oficiais);
    expect(pares).toHaveLength(1);
    // Vence quem tem a evidência mais forte: o número que confere.
    expect(pares[0]?.manual.id).toBe('a');
    expect(pares[0]?.avaliacao.decisao).toBe('MESCLAR');
  });

  it('não atribui duas candidaturas oficiais ao mesmo pré-candidato', () => {
    const manuais = [manual({ id: 'a' })];
    const oficiais = [
      oficial({ idTse: 1 }),
      oficial({ idTse: 2, nomeUrna: 'MARIA DA SILVA', nomeCompleto: 'MARIA DA SILVA', numeroUrna: '4321' }),
    ];
    const pares = parearCandidaturas(manuais, oficiais);
    expect(pares).toHaveLength(1);
    expect(pares[0]?.oficial.idTse).toBe(1);
  });

  it('prefere mesclagem automática a revisão ao resolver disputas', () => {
    const manuais = [
      manual({ id: 'certo' }),
      manual({ id: 'parcial', numeroUrna: '7777', siglaPartido: 'POU' }),
    ];
    const pares = parearCandidaturas(manuais, [oficial({ idTse: 1 })]);
    expect(pares[0]?.manual.id).toBe('certo');
  });

  it('devolve lista vazia quando não há nada comparável', () => {
    expect(parearCandidaturas([manual()], [oficial({ idCargo: CARGO_DE })])).toEqual([]);
  });
});
