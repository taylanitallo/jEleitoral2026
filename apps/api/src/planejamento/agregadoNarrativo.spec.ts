import { describe, expect, it } from 'vitest';
import { montarAgregadoNarrativo, type EntradaAgregado } from './agregadoNarrativo.js';
import { garantirSemDadoPessoal } from '../ia/redacaoSegura.js';

const ENTRADA: EntradaAgregado = {
  problemasPorTema: [
    { tema: 'SANEAMENTO', quantidadeProblemas: 6, somaRelatos: 61, gravidadeMedia: 4.166666 },
    { tema: 'SAUDE', quantidadeProblemas: 2, somaRelatos: 88, gravidadeMedia: 4.5 },
    { tema: 'MOBILIDADE', quantidadeProblemas: 9, somaRelatos: 12, gravidadeMedia: 2.1 },
  ],
  problemasPorTerritorio: [
    {
      nivel: 'BAIRRO',
      idReferencia: '11111111-1111-4111-8111-111111111111',
      rotuloTerritorio: 'Centro',
      temaPrincipal: 'SANEAMENTO',
      quantidadeProblemas: 4,
    },
  ],
  classificacaoPorTerritorio: [
    {
      nivel: 'BAIRRO',
      idReferencia: '11111111-1111-4111-8111-111111111111',
      rotuloTerritorio: 'Centro',
      apoiador: 120,
      provavel: 80,
      indeciso: 210,
      oposicao: 45,
      naoInformou: 30,
      eleitoradoBase: 4300,
    },
  ],
  coberturaAmostral: 0.1046,
};

describe('montarAgregadoNarrativo', () => {
  it('ordena os temas por RELATOS, não por quantidade de problemas', () => {
    /*
     * SAUDE tem 2 problemas e 88 relatos; MOBILIDADE tem 9 problemas e 12
     * relatos. Contar problemas colocaria mobilidade em primeiro — e a campanha
     * gastaria discurso no que menos gente reclamou.
     */
    const agregado = montarAgregadoNarrativo(ENTRADA);
    expect(agregado.temasMaisCitados.map((t) => t.tema)).toEqual([
      'SAUDE',
      'SANEAMENTO',
      'MOBILIDADE',
    ]);
  });

  it('arredonda a gravidade média para não mandar ruído de ponto flutuante', () => {
    const agregado = montarAgregadoNarrativo(ENTRADA);
    expect(agregado.temasMaisCitados.find((t) => t.tema === 'SANEAMENTO')?.gravidadeMedia).toBe(
      4.17,
    );
  });

  it('soma os totais a partir de todos os temas, não só dos que foram ao modelo', () => {
    const agregado = montarAgregadoNarrativo(ENTRADA);
    expect(agregado.totalProblemas).toBe(17);
    expect(agregado.totalRelatos).toBe(161);
  });
});

describe('barreira de dado pessoal — o teste que sustenta o módulo', () => {
  it('o agregado atravessa garantirSemDadoPessoal sem ser recusado', () => {
    /*
     * ESTE é o teste que impede a regressão mais provável deste arquivo:
     * alguém acrescenta um campo ao agregado — o nome do entrevistado, a
     * coordenada do problema, o texto da queixa — e a chamada de IA passa a
     * falhar em produção com uma mensagem que não aponta para cá.
     *
     * `garantirSemDadoPessoal` recusa o payload inteiro em vez de sanitizar,
     * então a falha é total, não parcial.
     */
    const agregado = montarAgregadoNarrativo(ENTRADA);
    expect(() => garantirSemDadoPessoal(agregado, 'agregadoNarrativo')).not.toThrow();
  });

  it('não expõe a chave `nome` em nível nenhum', () => {
    // A barreira bloqueia `nome` puro. Um `select b.nome` aliasado assim mataria
    // a requisição — daí `rotuloTerritorio`.
    const serializado = JSON.stringify(montarAgregadoNarrativo(ENTRADA));
    expect(serializado).not.toContain('"nome"');
    expect(serializado).toContain('rotuloTerritorio');
  });

  it('não expõe coordenadas', () => {
    const serializado = JSON.stringify(montarAgregadoNarrativo(ENTRADA));
    expect(serializado).not.toContain('latitude');
    expect(serializado).not.toContain('longitude');
  });

  it('não expõe UUID — ele casa com o padrão de título de eleitor', () => {
    /*
     * Descoberto por este arquivo: um UUID perde os hífens na normalização e
     * vira sequência de dígitos que o padrão de título casa. Mandá-lo faria a
     * barreira recusar TODA sugestão de narrativa em produção. E não há perda:
     * o modelo não faz nada com um UUID.
     */
    const serializado = JSON.stringify(montarAgregadoNarrativo(ENTRADA));
    expect(serializado).not.toContain('11111111-1111-4111-8111-111111111111');
    expect(serializado).not.toContain('idReferencia');
  });

  it('não leva texto livre de problema, onde um telefone anotado derrubaria tudo', () => {
    /*
     * `titulo` e `descricao` de problema são digitados por coordenador. Um
     * "ligar para 85 98888-7777" ali dispara o padrão de documento e a
     * requisição inteira é recusada. Só tema, contagem, gravidade e território
     * atravessam.
     */
    const agregado = montarAgregadoNarrativo(ENTRADA);
    for (const tema of agregado.temasMaisCitados) {
      expect(Object.keys(tema).sort()).toEqual([
        'gravidadeMedia',
        'quantidadeProblemas',
        'somaRelatos',
        'tema',
      ]);
    }
  });

  it('campo novo e sensível na ENTRADA não vaza para a saída', () => {
    /*
     * Prova que a montagem usa lista branca e não espalhamento. Se alguém
     * acrescentar uma coluna à consulta, ela não atravessa por acidente.
     */
    const contaminada = {
      ...ENTRADA,
      problemasPorTerritorio: [
        {
          ...ENTRADA.problemasPorTerritorio[0]!,
          nome: 'Maria da Silva',
          telefone: '85988887777',
          latitude: -3.71,
        } as never,
      ],
    };

    const agregado = montarAgregadoNarrativo(contaminada);
    const serializado = JSON.stringify(agregado);
    expect(serializado).not.toContain('Maria da Silva');
    expect(serializado).not.toContain('85988887777');
    expect(serializado).not.toContain('-3.71');
    expect(() => garantirSemDadoPessoal(agregado, 'contaminado')).not.toThrow();
  });
});
