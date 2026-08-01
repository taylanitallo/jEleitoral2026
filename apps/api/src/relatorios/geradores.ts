import ExcelJS from 'exceljs';
import PDFDocument from 'pdfkit';
import type { CabecalhoRelatorio } from './cabecalhoRelatorio.js';

/**
 * Geradores de arquivo. Recebem dados já consultados e o cabeçalho já montado —
 * não sabem nada de banco nem de RLS, o que os torna diretos de exercitar.
 */

export interface ColunaRelatorio {
  chave: string;
  rotulo: string;
  /** Controla a formatação da célula no Excel. */
  tipo?: 'texto' | 'numero' | 'moeda' | 'percentual' | 'data';
  largura?: number;
}

/**
 * Excel com duas abas: os dados e os metadados.
 *
 * A aba de metadados não é enfeite. Uma planilha de mapeamento circula por
 * e-mail durante semanas; sem os filtros, a data e o responsável registrados
 * dentro do próprio arquivo, ninguém consegue dizer depois a que recorte
 * aqueles números se referiam.
 */
export async function gerarExcel(
  cabecalho: CabecalhoRelatorio,
  colunas: readonly ColunaRelatorio[],
  linhas: ReadonlyArray<Record<string, unknown>>,
): Promise<Buffer> {
  const pasta = new ExcelJS.Workbook();
  pasta.creator = 'jEleitoral';
  pasta.created = new Date();

  const aba = pasta.addWorksheet('Dados', {
    views: [{ state: 'frozen', ySplit: 1 }], // cabeçalho congelado
  });

  aba.columns = colunas.map((coluna) => ({
    header: coluna.rotulo,
    key: coluna.chave,
    width: coluna.largura ?? Math.max(12, coluna.rotulo.length + 4),
    style: { numFmt: formatoNumerico(coluna.tipo) },
  }));

  aba.getRow(1).font = { bold: true };
  aba.getRow(1).alignment = { vertical: 'middle' };
  for (const linha of linhas) aba.addRow(linha);
  aba.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: colunas.length } };

  // --- Aba de metadados ------------------------------------------------------
  const metadados = pasta.addWorksheet('Metadados');
  metadados.columns = [
    { header: 'Campo', key: 'campo', width: 28 },
    { header: 'Valor', key: 'valor', width: 70 },
  ];
  metadados.getRow(1).font = { bold: true };

  metadados.addRow({ campo: 'Relatório', valor: cabecalho.titulo });
  metadados.addRow({ campo: 'Campanha', valor: cabecalho.subtitulo });
  for (const filtro of cabecalho.linhasDeFiltro) {
    metadados.addRow({ campo: 'Filtro', valor: filtro });
  }
  for (const linha of cabecalho.rodape) {
    metadados.addRow({ campo: 'Contexto', valor: linha });
  }

  if (cabecalho.tarja) {
    // A tarja vai nas duas abas: quem abre direto em "Dados" precisa vê-la.
    const aviso = metadados.addRow({ campo: 'ATENÇÃO', valor: cabecalho.tarja });
    aviso.font = { bold: true, color: { argb: 'FFB00020' } };
    const avisoNosDados = aba.addRow({});
    avisoNosDados.getCell(1).value = cabecalho.tarja;
    avisoNosDados.font = { bold: true, color: { argb: 'FFB00020' } };
  }

  return Buffer.from(await pasta.xlsx.writeBuffer());
}

function formatoNumerico(tipo: ColunaRelatorio['tipo']): string | undefined {
  switch (tipo) {
    case 'moeda':
      return 'R$ #,##0.00';
    case 'percentual':
      return '0.0%';
    case 'numero':
      return '#,##0';
    case 'data':
      return 'dd/mm/yyyy';
    default:
      return undefined;
  }
}

/**
 * PDF com cabeçalho, tarja, marca d'água e paginação.
 *
 * A marca d'água é desenhada **em cada página**, em diagonal e por baixo do
 * conteúdo. Não impede o vazamento de um PDF — torna rastreável quem o gerou,
 * que é o que se consegue fazer de útil aqui.
 */
export function gerarPdf(
  cabecalho: CabecalhoRelatorio,
  colunas: readonly ColunaRelatorio[],
  linhas: ReadonlyArray<Record<string, unknown>>,
): Promise<Buffer> {
  return new Promise((resolver, rejeitar) => {
    const documento = new PDFDocument({ size: 'A4', margin: 40, bufferPages: true });
    const pedacos: Buffer[] = [];
    documento.on('data', (pedaco: Buffer) => pedacos.push(pedaco));
    documento.on('error', rejeitar);
    documento.on('end', () => resolver(Buffer.concat(pedacos)));

    // --- Cabeçalho -----------------------------------------------------------
    documento.fontSize(16).font('Helvetica-Bold').text(cabecalho.titulo);
    documento.fontSize(10).font('Helvetica').fillColor('#444').text(cabecalho.subtitulo);
    documento.moveDown(0.4);

    if (cabecalho.tarja) {
      documento
        .fontSize(9)
        .font('Helvetica-Bold')
        .fillColor('#B00020')
        .text(cabecalho.tarja, { align: 'center' });
      documento.moveDown(0.4);
    }

    documento.fontSize(8).font('Helvetica').fillColor('#333');
    for (const filtro of cabecalho.linhasDeFiltro) documento.text(filtro);
    documento.moveDown(0.6);

    // --- Tabela --------------------------------------------------------------
    const larguraUtil = documento.page.width - 80;
    const larguraColuna = larguraUtil / colunas.length;

    const escreverLinha = (valores: string[], negrito: boolean): void => {
      const y = documento.y;
      documento
        .font(negrito ? 'Helvetica-Bold' : 'Helvetica')
        .fontSize(8)
        .fillColor('#000');
      valores.forEach((valor, indice) => {
        documento.text(valor, 40 + indice * larguraColuna, y, {
          width: larguraColuna - 4,
          ellipsis: true,
        });
      });
      documento.y = y + 14;
    };

    escreverLinha(
      colunas.map((coluna) => coluna.rotulo),
      true,
    );

    for (const linha of linhas) {
      // Quebra de página com repetição do cabeçalho da tabela.
      if (documento.y > documento.page.height - 70) {
        documento.addPage();
        escreverLinha(
          colunas.map((coluna) => coluna.rotulo),
          true,
        );
      }
      escreverLinha(
        colunas.map((coluna) => formatarCelula(linha[coluna.chave])),
        false,
      );
    }

    // --- Marca d'água e rodapé, em todas as páginas ---------------------------
    const faixa = documento.bufferedPageRange();
    for (let indice = 0; indice < faixa.count; indice += 1) {
      documento.switchToPage(faixa.start + indice);

      documento.save();
      documento
        .rotate(-30, { origin: [documento.page.width / 2, documento.page.height / 2] })
        .fontSize(26)
        .fillColor('#000')
        .opacity(0.07)
        .text(cabecalho.marcaDagua, 0, documento.page.height / 2, {
          width: documento.page.width,
          align: 'center',
        });
      documento.restore();

      documento
        .fontSize(7)
        .fillColor('#666')
        .opacity(1)
        .text(
          `${cabecalho.rodape.join(' · ')} — página ${indice + 1} de ${faixa.count}`,
          40,
          documento.page.height - 40,
          { width: larguraUtil, align: 'center' },
        );
    }

    documento.end();
  });
}

function formatarCelula(valor: unknown): string {
  if (valor === null || valor === undefined) return '—';
  if (valor instanceof Date) return valor.toLocaleDateString('pt-BR');
  if (typeof valor === 'number') return valor.toLocaleString('pt-BR');
  return String(valor);
}
