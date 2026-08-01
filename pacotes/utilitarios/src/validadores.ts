import { somenteDigitos } from './mascaras';

/**
 * Validadores com dígito verificador real. Máscara sem validação não serve de
 * nada: "111.111.111-11" passa em qualquer regex e é um CPF inválido.
 */

/** Valida CPF pelo algoritmo de módulo 11. */
export function validarCpf(valor: string | null | undefined): boolean {
  const d = somenteDigitos(valor);
  if (d.length !== 11) return false;
  // Sequências repetidas (00000000000, 11111111111...) passam no módulo 11 mas
  // são inválidas por definição da Receita Federal.
  if (/^(\d)\1{10}$/.test(d)) return false;

  const digitos = d.split('').map(Number) as number[];

  for (const posicao of [9, 10]) {
    let soma = 0;
    for (let i = 0; i < posicao; i += 1) {
      soma += (digitos[i] as number) * (posicao + 1 - i);
    }
    const resto = (soma * 10) % 11;
    const verificador = resto === 10 || resto === 11 ? 0 : resto;
    if (verificador !== digitos[posicao]) return false;
  }
  return true;
}

/** Valida CNPJ pelo algoritmo de módulo 11. */
export function validarCnpj(valor: string | null | undefined): boolean {
  const d = somenteDigitos(valor);
  if (d.length !== 14) return false;
  if (/^(\d)\1{13}$/.test(d)) return false;

  const digitos = d.split('').map(Number) as number[];
  const pesosPrimeiro = [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2];
  const pesosSegundo = [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2];

  const calcular = (pesos: number[]): number => {
    const soma = pesos.reduce((acc, peso, i) => acc + peso * (digitos[i] as number), 0);
    const resto = soma % 11;
    return resto < 2 ? 0 : 11 - resto;
  };

  return calcular(pesosPrimeiro) === digitos[12] && calcular(pesosSegundo) === digitos[13];
}

/**
 * Códigos de UF usados nos dois dígitos de estado do título de eleitor.
 * 01 a 27 correspondem às unidades da federação; 28 identifica título emitido
 * para eleitor no exterior (ZZ).
 */
const CODIGO_UF_TITULO_MINIMO = 1;
const CODIGO_UF_TITULO_MAXIMO = 28;

/**
 * Valida título de eleitor (12 dígitos: 8 sequenciais + 2 de UF + 2 de DV).
 *
 * Regra particular: para São Paulo (01) e Minas Gerais (02) o resto zero produz
 * dígito 1, e não 0 — herança do cadastro antigo desses estados.
 */
export function validarTituloEleitor(valor: string | null | undefined): boolean {
  const d = somenteDigitos(valor);
  if (d.length !== 12) return false;
  if (/^(\d)\1{11}$/.test(d)) return false;

  const digitos = d.split('').map(Number) as number[];
  const codigoUf = Number(d.slice(8, 10));
  if (codigoUf < CODIGO_UF_TITULO_MINIMO || codigoUf > CODIGO_UF_TITULO_MAXIMO) return false;

  const ufEspecial = codigoUf === 1 || codigoUf === 2;

  // Primeiro dígito verificador: 8 primeiros dígitos com pesos 2..9.
  let soma = 0;
  for (let i = 0; i < 8; i += 1) {
    soma += (digitos[i] as number) * (i + 2);
  }
  let resto = soma % 11;
  let primeiroVerificador = resto;
  if (resto === 10) primeiroVerificador = 0;
  if (resto === 0 && ufEspecial) primeiroVerificador = 1;
  if (primeiroVerificador !== digitos[10]) return false;

  // Segundo dígito verificador: dois dígitos de UF (pesos 7 e 8) + DV1 (peso 9).
  soma = (digitos[8] as number) * 7 + (digitos[9] as number) * 8 + primeiroVerificador * 9;
  resto = soma % 11;
  let segundoVerificador = resto;
  if (resto === 10) segundoVerificador = 0;
  if (resto === 0 && ufEspecial) segundoVerificador = 1;

  return segundoVerificador === digitos[11];
}

/** Aceita fixo (10 dígitos) e celular (11 dígitos, começando com 9 após o DDD). */
export function validarTelefone(valor: string | null | undefined): boolean {
  const d = somenteDigitos(valor);
  if (d.length !== 10 && d.length !== 11) return false;
  const ddd = Number(d.slice(0, 2));
  if (ddd < 11 || ddd > 99) return false;
  if (d.length === 11 && d[2] !== '9') return false;
  if (d.length === 10 && Number(d[2]) < 2) return false;
  return true;
}

/** CEP tem exatamente 8 dígitos. Não validamos a faixa — isso é papel do conector. */
export function validarCep(valor: string | null | undefined): boolean {
  return somenteDigitos(valor).length === 8;
}

export function validarEmail(valor: string | null | undefined): boolean {
  if (!valor) return false;
  return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(valor.trim());
}

/**
 * Valida data no formato dd/mm/aaaa, rejeitando datas inexistentes como
 * 31/02/2026 (que um `new Date` aceitaria silenciosamente virando 03/03).
 */
export function validarDataBr(valor: string | null | undefined): boolean {
  if (!valor) return false;
  const partes = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(valor.trim());
  if (!partes) return false;
  const dia = Number(partes[1]);
  const mes = Number(partes[2]);
  const ano = Number(partes[3]);
  if (mes < 1 || mes > 12 || dia < 1) return false;
  const data = new Date(Date.UTC(ano, mes - 1, dia));
  return (
    data.getUTCFullYear() === ano && data.getUTCMonth() === mes - 1 && data.getUTCDate() === dia
  );
}

/**
 * Idade mínima para votar é 16 anos. Usado para alertar (não bloquear) quando
 * um entrevistado cadastrado não terá idade de voto na data do pleito.
 */
export function terIdadeDeVoto(dataNascimento: Date, dataPleito: Date): boolean {
  const limite = new Date(dataPleito);
  limite.setFullYear(limite.getFullYear() - 16);
  return dataNascimento <= limite;
}
