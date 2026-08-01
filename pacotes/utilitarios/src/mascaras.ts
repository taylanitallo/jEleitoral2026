/**
 * Máscaras de digitação.
 *
 * Regra do projeto: a máscara é aplicada na tela, mas o valor **normalizado**
 * (somente dígitos) é o que vai para o banco. Nunca gravamos "123.456.789-09".
 */

/** Remove tudo que não for dígito. Base de toda normalização. */
export function somenteDigitos(valor: string | null | undefined): string {
  if (!valor) return '';
  return valor.replace(/\D+/g, '');
}

/** 000.000.000-00 */
export function mascararCpf(valor: string): string {
  const d = somenteDigitos(valor).slice(0, 11);
  return d
    .replace(/^(\d{3})(\d)/, '$1.$2')
    .replace(/^(\d{3})\.(\d{3})(\d)/, '$1.$2.$3')
    .replace(/\.(\d{3})(\d)/, '.$1-$2');
}

/** 00.000.000/0000-00 */
export function mascararCnpj(valor: string): string {
  const d = somenteDigitos(valor).slice(0, 14);
  return d
    .replace(/^(\d{2})(\d)/, '$1.$2')
    .replace(/^(\d{2})\.(\d{3})(\d)/, '$1.$2.$3')
    .replace(/\.(\d{3})(\d)/, '.$1/$2')
    .replace(/(\d{4})(\d)/, '$1-$2');
}

/** Aplica CPF ou CNPJ conforme a quantidade de dígitos digitada. */
export function mascararCpfCnpj(valor: string): string {
  return somenteDigitos(valor).length > 11 ? mascararCnpj(valor) : mascararCpf(valor);
}

/** 0000 0000 0000 — título de eleitor tem 12 dígitos. */
export function mascararTituloEleitor(valor: string): string {
  const d = somenteDigitos(valor).slice(0, 12);
  return d.replace(/^(\d{4})(\d)/, '$1 $2').replace(/^(\d{4}) (\d{4})(\d)/, '$1 $2 $3');
}

/** (00) 0000-0000 para fixo, (00) 00000-0000 para celular. */
export function mascararTelefone(valor: string): string {
  const d = somenteDigitos(valor).slice(0, 11);
  if (d.length <= 10) {
    return d.replace(/^(\d{2})(\d)/, '($1) $2').replace(/(\d{4})(\d)/, '$1-$2');
  }
  return d.replace(/^(\d{2})(\d)/, '($1) $2').replace(/(\d{5})(\d)/, '$1-$2');
}

/** 00000-000 */
export function mascararCep(valor: string): string {
  const d = somenteDigitos(valor).slice(0, 8);
  return d.replace(/^(\d{5})(\d)/, '$1-$2');
}

/** dd/mm/aaaa */
export function mascararData(valor: string): string {
  const d = somenteDigitos(valor).slice(0, 8);
  return d.replace(/^(\d{2})(\d)/, '$1/$2').replace(/^(\d{2})\/(\d{2})(\d)/, '$1/$2/$3');
}

/**
 * Máscara de número de urna. A quantidade de dígitos depende do cargo:
 * Presidente/Governador = 2, Senador = 3, Deputado Federal = 4,
 * Deputado Estadual = 5.
 */
export function mascararNumeroUrna(valor: string, digitos = 5): string {
  return somenteDigitos(valor).slice(0, digitos);
}

/**
 * Máscara monetária de digitação: o usuário digita centavos da direita para a
 * esquerda. Devolve o texto formatado; use `desformatarMoeda` antes de gravar.
 */
export function mascararMoeda(valor: string): string {
  const d = somenteDigitos(valor);
  if (!d) return '';
  const numero = Number(d) / 100;
  return numero.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

/** Converte "1.234,56" (ou "R$ 1.234,56") no número 1234.56. */
export function desformatarMoeda(valor: string): number {
  if (!valor) return 0;
  const limpo = valor.replace(/[^\d,-]/g, '').replace(',', '.');
  const numero = Number.parseFloat(limpo);
  return Number.isNaN(numero) ? 0 : numero;
}

/** Converte "12,5%" no número 12.5. */
export function desformatarPercentual(valor: string): number {
  return desformatarMoeda(valor.replace('%', ''));
}
