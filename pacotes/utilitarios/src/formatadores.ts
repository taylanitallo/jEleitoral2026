import { mascararCep, mascararCpf, mascararTelefone, mascararTituloEleitor } from './mascaras';

/** Formatadores de exibição. Sempre pt-BR. */

const LOCALE = 'pt-BR';

export function formatarMoeda(valor: number | null | undefined): string {
  if (valor === null || valor === undefined || Number.isNaN(valor)) return '—';
  return valor.toLocaleString(LOCALE, { style: 'currency', currency: 'BRL' });
}

/** Moeda compacta para cartões de indicador: R$ 1,2 mi. */
export function formatarMoedaCompacta(valor: number | null | undefined): string {
  if (valor === null || valor === undefined || Number.isNaN(valor)) return '—';
  return valor.toLocaleString(LOCALE, {
    style: 'currency',
    currency: 'BRL',
    notation: 'compact',
    maximumFractionDigits: 1,
  });
}

export function formatarNumero(valor: number | null | undefined, casas = 0): string {
  if (valor === null || valor === undefined || Number.isNaN(valor)) return '—';
  return valor.toLocaleString(LOCALE, { minimumFractionDigits: casas, maximumFractionDigits: casas });
}

/** Recebe a fração (0.125) e devolve "12,5%". */
export function formatarPercentual(fracao: number | null | undefined, casas = 1): string {
  if (fracao === null || fracao === undefined || Number.isNaN(fracao)) return '—';
  return fracao.toLocaleString(LOCALE, {
    style: 'percent',
    minimumFractionDigits: casas,
    maximumFractionDigits: casas,
  });
}

export function formatarData(valor: Date | string | null | undefined): string {
  if (!valor) return '—';
  const data = typeof valor === 'string' ? new Date(valor) : valor;
  if (Number.isNaN(data.getTime())) return '—';
  return data.toLocaleDateString(LOCALE, { timeZone: 'America/Sao_Paulo' });
}

export function formatarDataHora(valor: Date | string | null | undefined): string {
  if (!valor) return '—';
  const data = typeof valor === 'string' ? new Date(valor) : valor;
  if (Number.isNaN(data.getTime())) return '—';
  return data.toLocaleString(LOCALE, { timeZone: 'America/Sao_Paulo' });
}

/** "há 3 dias", "em 2 meses" — para trilhas de auditoria e listagens. */
export function formatarTempoRelativo(valor: Date | string, referencia = new Date()): string {
  const data = typeof valor === 'string' ? new Date(valor) : valor;
  const segundos = Math.round((data.getTime() - referencia.getTime()) / 1000);
  const formatador = new Intl.RelativeTimeFormat(LOCALE, { numeric: 'auto' });
  const faixas: Array<[Intl.RelativeTimeFormatUnit, number]> = [
    ['year', 31_536_000],
    ['month', 2_592_000],
    ['day', 86_400],
    ['hour', 3_600],
    ['minute', 60],
  ];
  for (const [unidade, tamanho] of faixas) {
    if (Math.abs(segundos) >= tamanho) {
      return formatador.format(Math.round(segundos / tamanho), unidade);
    }
  }
  return formatador.format(segundos, 'second');
}

export function formatarDuracao(segundos: number | null | undefined): string {
  if (segundos === null || segundos === undefined || segundos < 0) return '—';
  const minutos = Math.floor(segundos / 60);
  const resto = Math.round(segundos % 60);
  if (minutos === 0) return `${resto}s`;
  return `${minutos}min ${String(resto).padStart(2, '0')}s`;
}

export const formatarCpf = mascararCpf;
export const formatarCep = mascararCep;
export const formatarTelefone = mascararTelefone;
export const formatarTituloEleitor = mascararTituloEleitor;

/**
 * Mascaramento parcial para exibição em tela e marca d'água de PDF.
 * "12345678909" → "123.***.***-09". Nunca exiba o documento inteiro em
 * listagem: o operador não precisa dele para trabalhar.
 */
export function ocultarCpf(valor: string | null | undefined): string {
  const d = (valor ?? '').replace(/\D+/g, '');
  if (d.length !== 11) return '—';
  return `${d.slice(0, 3)}.***.***-${d.slice(9)}`;
}

/**
 * Nome do candidato como aparece na urna: nome de urna + número.
 * Ex.: "MARIA DA SILVA (13123)".
 */
export function formatarIdentificacaoUrna(nomeUrna: string, numeroUrna: string | number): string {
  return `${nomeUrna.toUpperCase()} (${numeroUrna})`;
}
