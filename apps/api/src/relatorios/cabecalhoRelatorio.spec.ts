import { describe, expect, it } from 'vitest';
import {
  exigeProcessamentoAssincrono,
  montarCabecalho,
  montarMarcaDagua,
  TARJA_USO_INTERNO,
  type ContextoExportacao,
} from './cabecalhoRelatorio.js';

const GERADO_EM = new Date('2026-09-15T14:30:00-03:00');

function contexto(alteracoes: Partial<ContextoExportacao> = {}): ContextoExportacao {
  return {
    nomeCampanha: 'Deputado Federal 2026',
    natureza: 'LEVANTAMENTO_INTERNO',
    operador: { nome: 'Ana Coordenadora', cpfParcial: '123.***.***-09' },
    filtros: [{ rotulo: 'Seção', valor: '0042' }],
    quantidadeRegistros: 1243,
    geradoEm: GERADO_EM,
    ...alteracoes,
  };
}

describe('tarja de uso interno', () => {
  it('aparece em levantamento interno', () => {
    expect(montarCabecalho('Mapeamento por bairro', contexto()).tarja).toBe(TARJA_USO_INTERNO);
  });

  it('some quando há registro no PesqEle', () => {
    const cabecalho = montarCabecalho(
      'Pesquisa',
      contexto({
        natureza: 'PESQUISA_REGISTRADA',
        registroPesqEle: {
          numero: 'SP-01234/2026',
          contratante: 'Comitê X',
          metodologia: 'Amostragem estratificada',
          margemErro: 3.2,
          intervaloConfianca: 95,
        },
      }),
    );
    expect(cabecalho.tarja).toBeNull();
    expect(cabecalho.rodape.join(' ')).toContain('SP-01234/2026');
    expect(cabecalho.rodape.join(' ')).toContain('Margem de erro 3,2');
  });

  it('permanece se marcar como registrada sem informar o registro', () => {
    // Seria exatamente a brecha que a tarja existe para fechar: declarar-se
    // registrada sem número e sair divulgando.
    const cabecalho = montarCabecalho(
      'Pesquisa',
      contexto({ natureza: 'PESQUISA_REGISTRADA', registroPesqEle: null }),
    );
    expect(cabecalho.tarja).toBe(TARJA_USO_INTERNO);
  });

  it('levantamento interno avisa que não substitui assessoria jurídica', () => {
    const cabecalho = montarCabecalho('Mapeamento', contexto());
    expect(cabecalho.rodape.join(' ')).toMatch(/não substitui assessoria jurídica/i);
  });
});

describe('marca d\'água', () => {
  it('traz nome, CPF parcial e momento', () => {
    const marca = montarMarcaDagua(
      { nome: 'Ana Coordenadora', cpfParcial: '123.***.***-09' },
      GERADO_EM,
    );
    expect(marca).toContain('Ana Coordenadora');
    expect(marca).toContain('123.***.***-09');
    expect(marca).toMatch(/15\/09\/2026/);
  });

  it('funciona sem CPF, que é opcional por minimização', () => {
    const marca = montarMarcaDagua({ nome: 'Ana Coordenadora', cpfParcial: null }, GERADO_EM);
    expect(marca).toContain('Ana Coordenadora');
    expect(marca).not.toContain('***');
  });

  it('usa o fuso de Brasília, não o do servidor', () => {
    // O Railway roda em UTC; sem o fuso fixo o relatório mostraria 17:30.
    expect(montarMarcaDagua({ nome: 'X', cpfParcial: null }, GERADO_EM)).toContain('14:30');
  });
});

describe('filtros por extenso', () => {
  it('lista cada filtro aplicado', () => {
    const cabecalho = montarCabecalho(
      'Mapeamento',
      contexto({
        filtros: [
          { rotulo: 'UF', valor: 'SP' },
          { rotulo: 'Seção', valor: '0042' },
        ],
      }),
    );
    expect(cabecalho.linhasDeFiltro).toEqual(['UF: SP', 'Seção: 0042']);
  });

  it('deixa explícito quando não há recorte', () => {
    const cabecalho = montarCabecalho('Mapeamento', contexto({ filtros: [] }));
    expect(cabecalho.linhasDeFiltro).toEqual(['Sem filtros — toda a campanha']);
  });

  it('registra quantidade de linhas e operador no rodapé', () => {
    const rodape = montarCabecalho('Mapeamento', contexto()).rodape.join(' ');
    expect(rodape).toContain('1.243 registro(s)');
    expect(rodape).toContain('Ana Coordenadora');
  });
});

describe('exigeProcessamentoAssincrono', () => {
  it('processa na hora o que cabe na requisição', () => {
    expect(exigeProcessamentoAssincrono(5000)).toBe(false);
  });

  it('manda para a fila o que estouraria o tempo limite', () => {
    expect(exigeProcessamentoAssincrono(5001)).toBe(true);
  });
});
