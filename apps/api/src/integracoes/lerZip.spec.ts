import { deflateRawSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import { escolherCsvDaUf, lerZip, pareceZip, type EntradaZip } from './lerZip.js';

/**
 * Monta um ZIP de verdade, com diretório central, para exercitar o leitor sem
 * depender de arquivo binário versionado — que ninguém saberia regenerar.
 */
function montarZip(arquivos: Array<{ nome: string; conteudo: string; comprimir?: boolean }>): Buffer {
  const locais: Buffer[] = [];
  const centrais: Buffer[] = [];
  let deslocamento = 0;

  for (const arquivo of arquivos) {
    const nome = Buffer.from(arquivo.nome, 'utf8');
    const cru = Buffer.from(arquivo.conteudo, 'latin1');
    const comprimir = arquivo.comprimir ?? true;
    const dados = comprimir ? deflateRawSync(cru) : cru;
    const metodo = comprimir ? 8 : 0;

    const cabecalhoLocal = Buffer.alloc(30);
    cabecalhoLocal.writeUInt32LE(0x04034b50, 0);
    cabecalhoLocal.writeUInt16LE(metodo, 8);
    cabecalhoLocal.writeUInt32LE(dados.length, 18);
    cabecalhoLocal.writeUInt32LE(cru.length, 22);
    cabecalhoLocal.writeUInt16LE(nome.length, 26);
    locais.push(cabecalhoLocal, nome, dados);

    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(metodo, 10);
    central.writeUInt32LE(dados.length, 20);
    central.writeUInt32LE(cru.length, 24);
    central.writeUInt16LE(nome.length, 28);
    central.writeUInt32LE(deslocamento, 42);
    centrais.push(central, nome);

    deslocamento += cabecalhoLocal.length + nome.length + dados.length;
  }

  const corpoLocal = Buffer.concat(locais);
  const corpoCentral = Buffer.concat(centrais);

  const fim = Buffer.alloc(22);
  fim.writeUInt32LE(0x06054b50, 0);
  fim.writeUInt16LE(arquivos.length, 8);
  fim.writeUInt16LE(arquivos.length, 10);
  fim.writeUInt32LE(corpoCentral.length, 12);
  fim.writeUInt32LE(corpoLocal.length, 16);

  return Buffer.concat([corpoLocal, corpoCentral, fim]);
}

describe('pareceZip', () => {
  it('reconhece a assinatura PK', () => {
    expect(pareceZip(montarZip([{ nome: 'a.csv', conteudo: 'x' }]))).toBe(true);
  });

  it('não confunde CSV cru com ZIP', () => {
    // É esta distinção que impede o conector de voltar a decodificar bytes
    // comprimidos como texto.
    expect(pareceZip(Buffer.from('NR_ZONA;NR_SECAO\n1;2\n', 'latin1'))).toBe(false);
  });
});

describe('lerZip', () => {
  it('descomprime entradas em deflate', () => {
    const zip = montarZip([{ nome: 'dados.csv', conteudo: 'NR_ZONA;NR_SECAO\r\n12;0034\r\n' }]);
    const entradas = lerZip(zip);
    expect(entradas).toHaveLength(1);
    expect(entradas[0]!.conteudo.toString('latin1')).toContain('12;0034');
  });

  it('lê entradas armazenadas sem compressão', () => {
    const zip = montarZip([{ nome: 'cru.csv', conteudo: 'a;b', comprimir: false }]);
    expect(lerZip(zip)[0]!.conteudo.toString('latin1')).toBe('a;b');
  });

  it('preserva ISO-8859-1 para o acento não se perder', () => {
    // "JOSÉ" lido como UTF-8 vira "JOS?" e quebra a deduplicação por nome.
    const zip = montarZip([{ nome: 'n.csv', conteudo: 'NM;\r\nJOSÉ;\r\n' }]);
    const texto = new TextDecoder('iso-8859-1').decode(lerZip(zip)[0]!.conteudo);
    expect(texto).toContain('JOSÉ');
  });

  it('recusa arquivo que não é ZIP', () => {
    expect(() => lerZip(Buffer.from('não sou um zip'))).toThrow(/ZIP inválido/);
  });
});

describe('escolherCsvDaUf', () => {
  const nacional: EntradaZip[] = [
    { nome: 'eleitorado_local_votacao_2026_BA.csv', conteudo: Buffer.from('bahia') },
    { nome: 'eleitorado_local_votacao_2026_CE.csv', conteudo: Buffer.from('ceara') },
    { nome: 'eleitorado_local_votacao_2026_SP.csv', conteudo: Buffer.from('sao paulo') },
  ];

  it('escolhe o CSV da UF pedida, e não o primeiro do pacote', () => {
    // O defeito real: sem escolher, a carga do Ceará trazia a Bahia, que vem
    // antes em ordem alfabética.
    expect(escolherCsvDaUf(nacional, 'CE').conteudo.toString()).toBe('ceara');
  });

  it('não deixa a sigla casar no meio do nome do arquivo', () => {
    const armadilha: EntradaZip[] = [
      { nome: 'perfil_secao_2026_AC.csv', conteudo: Buffer.from('acre') },
      { nome: 'perfil_secao_2026_CE.csv', conteudo: Buffer.from('ceara') },
    ];
    expect(escolherCsvDaUf(armadilha, 'CE').conteudo.toString()).toBe('ceara');
  });

  it('aceita o único CSV quando o pacote não separa por UF', () => {
    const unico: EntradaZip[] = [{ nome: 'consolidado.csv', conteudo: Buffer.from('tudo') }];
    expect(escolherCsvDaUf(unico, 'CE').conteudo.toString()).toBe('tudo');
  });

  it('falha em vez de adivinhar quando há vários e nenhum é da UF', () => {
    // Adivinhar aqui contaminaria projeção e meta com dados de outro estado,
    // sem nada indicando a origem.
    expect(() => escolherCsvDaUf(nacional, 'RJ')).toThrow(/Nenhum CSV de RJ/);
  });

  it('avisa quando o ZIP não tem CSV nenhum', () => {
    expect(() => escolherCsvDaUf([{ nome: 'leiame.txt', conteudo: Buffer.alloc(0) }], 'CE')).toThrow(
      /não contém CSV/,
    );
  });
});
