/**
 * Leitura do arquivo de boletins da apuração.
 *
 * Arquivo próprio, e não método privado do conector, por dois motivos que se
 * reforçam: é lógica pura e testável, e é **a única peça que vai mudar** quando
 * o TSE publicar o layout real de 2026 — que só sai às vésperas do pleito.
 * Isolá-la é o que permite trocar o formato sem tocar em poller, idempotência
 * ou gravação.
 *
 * O formato abaixo é o esperado a partir das instruções de anos anteriores e
 * **precisa ser confrontado com o arquivo real** antes do pleito. Os testes
 * garantem o contrato de resiliência, que vale para qualquer layout.
 */

export interface Boletim {
  numeroZona: number;
  numeroSecao: number;
  codigoCargo: number;
  votos: Array<{ numeroUrna: string; votos: number }>;
}

/**
 * Converte o conteúdo em boletins, descartando o que não fizer sentido.
 *
 * **Resiliente a arquivo parcial de propósito.** Durante a apuração o arquivo é
 * reescrito enquanto a gente baixa; uma linha cortada no fim é o normal, não a
 * exceção. Estourar exceção aqui pararia a apuração inteira por causa de um
 * byte, na única noite do ano em que o módulo serve para alguma coisa.
 *
 * Três armadilhas governam o formato:
 *
 *  1. **A última linha é descartada quando o conteúdo não termina em quebra.**
 *     Esta é a que mais importa e a menos óbvia. Uma linha cortada no meio de um
 *     número — `...;13;45` onde o valor real era `450` — tem contagem de campos
 *     válida e todos os números finitos: ela passaria por qualquer validação e
 *     gravaria 45 votos onde havia 450. E, como o hash inclui o número da seção,
 *     o `on conflict do nothing` do conector faria o valor errado **persistir**,
 *     porque o ciclo seguinte não sobrescreve o que já entrou. Números errados
 *     na noite da apuração, sem erro em log nenhum.
 *  2. **Par incompleto no fim da linha é ignorado**, não vira voto zero. Zero é
 *     um resultado; ausência de dado não é.
 *  3. **Voto negativo é descartado.** Não existe, e um sinal de menos colado por
 *     um byte trocado somaria negativo na totalização.
 */
export function analisarBoletim(conteudo: string): Boletim[] {
  const boletins: Boletim[] = [];

  const linhas = conteudo.split(/\r?\n/);

  /*
   * Se o conteúdo não termina em quebra de linha, o último elemento pode estar
   * cortado no meio da escrita. Descartar é barato: o ciclo seguinte, segundos
   * depois, traz o arquivo completo. Manter é arriscar gravar número errado de
   * forma permanente.
   */
  if (linhas.length > 0 && !/[\r\n]$/.test(conteudo)) linhas.pop();

  for (const linha of linhas) {
    if (linha.trim().length === 0) continue;
    const campos = linha.split(';');
    // Menos campos que o mínimo = linha truncada pela reescrita em curso.
    if (campos.length < 5) continue;

    const numeroZona = Number(campos[0]);
    const numeroSecao = Number(campos[1]);
    const codigoCargo = Number(campos[2]);
    if (!Number.isInteger(numeroZona) || numeroZona <= 0) continue;
    if (!Number.isInteger(numeroSecao) || numeroSecao <= 0) continue;
    if (!Number.isInteger(codigoCargo) || codigoCargo <= 0) continue;

    const votos: Array<{ numeroUrna: string; votos: number }> = [];
    for (let i = 3; i + 1 < campos.length; i += 2) {
      const numeroUrna = String(campos[i]).trim();
      const quantidade = Number(campos[i + 1]);
      if (numeroUrna.length === 0) continue;
      if (!Number.isInteger(quantidade) || quantidade < 0) continue;
      votos.push({ numeroUrna, votos: quantidade });
    }

    // Boletim sem voto nenhum não é resultado: é linha que sobreviveu à
    // validação de cabeçalho e perdeu o corpo.
    if (votos.length === 0) continue;

    boletins.push({ numeroZona, numeroSecao, codigoCargo, votos });
  }

  return boletins;
}
