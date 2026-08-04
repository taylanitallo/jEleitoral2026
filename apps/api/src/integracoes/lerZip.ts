import { inflateRawSync } from 'node:zlib';

/**
 * Leitor mínimo de ZIP.
 *
 * Existe porque **os recursos do TSE são `.zip`, não `.csv`** — apesar de o
 * catálogo CKAN os anunciar como CSV. Sem descompactar, o conector decodificava
 * os bytes comprimidos como ISO-8859-1 e "encontrava" centenas de milhares de
 * linhas de lixo, que atravessavam o mapeamento sem casar com nada. O resultado
 * era uma carga que reportava sucesso e não gravava um registro sequer.
 *
 * Por que não uma biblioteca: o formato usado pelo TSE é o subconjunto mais
 * simples do ZIP — entradas sem senha, sem partição em volumes, comprimidas em
 * deflate ou armazenadas cruas. O `zlib` do próprio Node resolve as duas, e o
 * que sobra é ler o diretório central. Acrescentar dependência para isso traria
 * mais superfície de manutenção do que estas linhas.
 *
 * Lê pelo **diretório central**, no fim do arquivo, e não pelos cabeçalhos
 * locais: quando o ZIP é gerado por streaming, o cabeçalho local traz tamanho
 * zero e os valores reais só existem no diretório central. Ler pelo começo
 * funciona com alguns arquivos e falha com outros, de um jeito que parece
 * corrupção intermitente.
 */

export interface EntradaZip {
  nome: string;
  conteudo: Buffer;
}

const ASSINATURA_LOCAL = 0x04034b50;
const ASSINATURA_DIRETORIO = 0x02014b50;
const ASSINATURA_FIM = 0x06054b50;

/** `PK\x03\x04` no começo do arquivo. */
export function pareceZip(bytes: Buffer): boolean {
  return bytes.length >= 4 && bytes.readUInt32LE(0) === ASSINATURA_LOCAL;
}

function acharFimDoDiretorio(bytes: Buffer): number {
  // O registro final tem tamanho variável por causa do comentário, então se
  // procura de trás para frente. 64 KiB é o máximo que o comentário pode ter.
  const limite = Math.max(0, bytes.length - 0xffff - 22);
  for (let i = bytes.length - 22; i >= limite; i -= 1) {
    if (bytes.readUInt32LE(i) === ASSINATURA_FIM) return i;
  }
  return -1;
}

export function lerZip(bytes: Buffer): EntradaZip[] {
  const fim = acharFimDoDiretorio(bytes);
  if (fim < 0) {
    throw new Error('Arquivo ZIP inválido: registro final do diretório não encontrado.');
  }

  const quantidade = bytes.readUInt16LE(fim + 10);
  let posicao = bytes.readUInt32LE(fim + 16);
  const entradas: EntradaZip[] = [];

  for (let indice = 0; indice < quantidade; indice += 1) {
    if (bytes.readUInt32LE(posicao) !== ASSINATURA_DIRETORIO) {
      throw new Error(`Arquivo ZIP inválido: entrada ${indice} fora de posição.`);
    }

    const metodo = bytes.readUInt16LE(posicao + 10);
    const tamanhoComprimido = bytes.readUInt32LE(posicao + 20);
    const tamanhoNome = bytes.readUInt16LE(posicao + 28);
    const tamanhoExtra = bytes.readUInt16LE(posicao + 30);
    const tamanhoComentario = bytes.readUInt16LE(posicao + 32);
    const deslocamentoLocal = bytes.readUInt32LE(posicao + 42);
    const nome = bytes.toString('utf8', posicao + 46, posicao + 46 + tamanhoNome);

    // O cabeçalho local tem os próprios campos de nome e extra, com tamanhos
    // que podem diferir dos do diretório central — daí reler aqui em vez de
    // reaproveitar os de cima.
    const tamanhoNomeLocal = bytes.readUInt16LE(deslocamentoLocal + 26);
    const tamanhoExtraLocal = bytes.readUInt16LE(deslocamentoLocal + 28);
    const inicioDados = deslocamentoLocal + 30 + tamanhoNomeLocal + tamanhoExtraLocal;
    const dados = bytes.subarray(inicioDados, inicioDados + tamanhoComprimido);

    if (!nome.endsWith('/')) {
      if (metodo === 0) {
        entradas.push({ nome, conteudo: dados });
      } else if (metodo === 8) {
        entradas.push({ nome, conteudo: inflateRawSync(dados) });
      } else {
        throw new Error(`Compressão não suportada (método ${metodo}) na entrada "${nome}".`);
      }
    }

    posicao += 46 + tamanhoNome + tamanhoExtra + tamanhoComentario;
  }

  return entradas;
}

/**
 * Escolhe, dentro do ZIP, o CSV da UF pedida.
 *
 * O TSE distribui arquivos nacionais contendo um CSV por estado — e foi
 * exatamente aqui que a carga do Ceará trouxe dados da Bahia: sem escolher, o
 * que vale é a primeira entrada, e ela é a de `BA` por ordem alfabética. Um erro
 * silencioso desses contamina projeção, meta e relatório sem nada indicar a
 * origem.
 */
export function escolherCsvDaUf(entradas: EntradaZip[], uf: string): EntradaZip {
  const csvs = entradas.filter((entrada) => entrada.nome.toLowerCase().endsWith('.csv'));
  if (csvs.length === 0) {
    throw new Error(
      `O ZIP não contém CSV. Entradas: ${entradas.map((e) => e.nome).join(', ') || '(nenhuma)'}`,
    );
  }

  const sigla = uf.toUpperCase();
  // `_CE.csv` e não apenas `CE`: sem a âncora, "CE" casa com o "CE" de
  // "eleitorado_local_votacao" e com nomes de outros estados que o contenham.
  const daUf = csvs.find((entrada) => new RegExp(`[_-]${sigla}\\.csv$`, 'i').test(entrada.nome));
  if (daUf) return daUf;

  if (csvs.length === 1) return csvs[0]!;

  throw new Error(
    `Nenhum CSV de ${sigla} no ZIP, e há ${csvs.length} candidatos. ` +
      `Entradas: ${csvs.map((e) => e.nome).join(', ')}`,
  );
}
