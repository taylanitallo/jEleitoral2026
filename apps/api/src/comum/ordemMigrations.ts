/**
 * Comparação de migrations por NÚMERO, não por texto.
 *
 * Vive em `src` e não junto do script porque `pnpm test` só varre `src` — e
 * esta função precisa de teste. Ela já falhou em produção uma vez, e a falha
 * foi silenciosa no pior sentido: não deu erro, só adotou menos do que devia.
 *
 * `--adotar-ate=0018` comparado com `localeCompare` exclui a própria 0018:
 * `'0018_bairros_unicidade.sql'.localeCompare('0018')` é `1`, porque o nome do
 * arquivo é mais longo que o limite. O resultado é adotar até a 0017 e tentar
 * EXECUTAR a 0018 num banco que já a tem — que foi exatamente o que aconteceu
 * ao adotar o banco de produção.
 */

/** Extrai o número de `0018_bairros_unicidade.sql` ou de `0018`. */
export function numeroDaMigration(texto: string): number {
  const casado = /^(\d+)/.exec(texto.trim());
  return casado ? Number(casado[1]) : Number.NaN;
}

/**
 * A migration deve ser adotada (marcada como aplicada sem executar)?
 *
 * Inclusiva no limite, como a documentação da opção sempre prometeu.
 */
export function deveAdotar(arquivo: string, limite: string): boolean {
  const numeroLimite = numeroDaMigration(limite);
  const numeroArquivo = numeroDaMigration(arquivo);
  // Limite ilegível não adota nada: pular migration por engano de digitação
  // deixaria o banco sem uma alteração que ninguém saberia que faltou.
  if (!Number.isFinite(numeroLimite) || !Number.isFinite(numeroArquivo)) return false;
  return numeroArquivo <= numeroLimite;
}
