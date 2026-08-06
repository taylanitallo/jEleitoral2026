import { randomBytes } from 'node:crypto';

/**
 * Senha de primeiro acesso.
 *
 * Sem `I`, `l`, `O`, `0` e `1`: ela vai ser lida em voz alta pelo coordenador e
 * digitada por outra pessoa num teclado de celular. Confundir zero com ó custa
 * uma ligação e a suspeita de que "o sistema não funciona".
 *
 * Comprimento e composição atendem à política do projeto (mínimo 10, com
 * maiúscula, minúscula e dígito) — ver `config.toml`, `[auth]`.
 */
export function gerarSenhaInicial(): string {
  const maiusculas = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
  const minusculas = 'abcdefghijkmnopqrstuvwxyz';
  const digitos = '23456789';
  const alfabeto = maiusculas + minusculas + digitos;
  const bytes = randomBytes(24);

  // Garante ao menos um de cada classe, e sorteia o resto.
  const senha = [
    maiusculas[bytes[0]! % maiusculas.length],
    minusculas[bytes[1]! % minusculas.length],
    digitos[bytes[2]! % digitos.length],
    ...Array.from(bytes.subarray(3, 17), (b) => alfabeto[b % alfabeto.length]),
  ];

  // Embaralha para as três primeiras posições não serem previsíveis por classe.
  for (let i = senha.length - 1; i > 0; i -= 1) {
    const j = bytes[i]! % (i + 1);
    [senha[i], senha[j]] = [senha[j]!, senha[i]!];
  }
  return senha.join('');
}
