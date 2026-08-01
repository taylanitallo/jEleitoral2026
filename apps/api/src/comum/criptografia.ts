import { createCipheriv, createDecipheriv, createHmac, randomBytes } from 'node:crypto';

/**
 * Criptografia de identificadores em repouso (LGPD, seção 2.1 do escopo).
 *
 * CPF e título de eleitor são cifrados em AES-256-GCM. Ao lado do valor cifrado
 * gravamos um HMAC-SHA256 determinístico, que serve de índice de busca — nunca
 * se indexa o texto claro, e nunca se decifra a base inteira para achar alguém.
 *
 * O GCM foi escolhido em vez do CBC porque autentica: adulterar o texto cifrado
 * no banco produz erro na decifragem em vez de devolver lixo silenciosamente.
 */

const ALGORITMO = 'aes-256-gcm';
const TAMANHO_IV = 12; // 96 bits, recomendado para GCM
const SEPARADOR = ':';

export class Criptografia {
  private readonly chave: Buffer;
  private readonly segredoHmac: string;

  constructor(chaveHexadecimal: string, segredoHmac: string) {
    if (!/^[0-9a-fA-F]{64}$/.test(chaveHexadecimal)) {
      throw new Error('A chave AES precisa ter 64 caracteres hexadecimais (32 bytes).');
    }
    this.chave = Buffer.from(chaveHexadecimal, 'hex');
    this.segredoHmac = segredoHmac;
  }

  /**
   * Cifra um valor. O IV é sorteado a cada chamada, então cifrar o mesmo CPF
   * duas vezes produz textos diferentes — que é o comportamento correto e a
   * razão de o índice de busca precisar ser o HMAC, e não o texto cifrado.
   */
  cifrar(valorClaro: string | null | undefined): string | null {
    if (!valorClaro) return null;
    const iv = randomBytes(TAMANHO_IV);
    const cifrador = createCipheriv(ALGORITMO, this.chave, iv);
    const cifrado = Buffer.concat([cifrador.update(valorClaro, 'utf8'), cifrador.final()]);
    const etiqueta = cifrador.getAuthTag();
    return [iv.toString('base64'), etiqueta.toString('base64'), cifrado.toString('base64')].join(
      SEPARADOR,
    );
  }

  decifrar(valorCifrado: string | null | undefined): string | null {
    if (!valorCifrado) return null;
    const partes = valorCifrado.split(SEPARADOR);
    if (partes.length !== 3) {
      throw new Error('Formato de valor criptografado inválido.');
    }
    const [ivBase64, etiquetaBase64, dadosBase64] = partes as [string, string, string];
    const decifrador = createDecipheriv(ALGORITMO, this.chave, Buffer.from(ivBase64, 'base64'));
    decifrador.setAuthTag(Buffer.from(etiquetaBase64, 'base64'));
    return Buffer.concat([
      decifrador.update(Buffer.from(dadosBase64, 'base64')),
      decifrador.final(),
    ]).toString('utf8');
  }

  /**
   * Índice de busca determinístico. Normaliza para somente dígitos antes de
   * calcular, para que "123.456.789-09" e "12345678909" produzam o mesmo HMAC.
   * Espelha `public.hmac_indice` no banco — divergir aqui faria a busca não
   * encontrar registros que existem.
   */
  indiceDeBusca(valorClaro: string | null | undefined): string | null {
    if (!valorClaro) return null;
    const somenteDigitos = valorClaro.replace(/\D+/g, '');
    if (!somenteDigitos) return null;
    return createHmac('sha256', this.segredoHmac).update(somenteDigitos).digest('hex');
  }

  /**
   * Prepara o par (cifrado, índice) para gravação. Devolver os dois juntos
   * evita o erro clássico de gravar um e esquecer o outro, deixando um registro
   * impossível de encontrar.
   */
  paraGravacao(valorClaro: string | null | undefined): {
    criptografado: string | null;
    hmac: string | null;
  } {
    return {
      criptografado: this.cifrar(valorClaro),
      hmac: this.indiceDeBusca(valorClaro),
    };
  }
}
