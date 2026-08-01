import { normalizarTexto, similaridade } from '@jeleitoral/utilitarios';

/**
 * Mesclagem entre pré-candidato cadastrado à mão e candidatura oficial.
 *
 * Contexto: até o registro de candidaturas (15/08/2026) a campanha cadastra
 * pré-candidatos manualmente. Depois, o CSV oficial do TSE chega com os mesmos
 * nomes — e o cadastro manual não pode virar duplicata.
 *
 * O princípio que governa este arquivo: **mesclar errado é pior do que não
 * mesclar.** Duplicata é feia e corrigível em trinta segundos; fundir dois
 * candidatos diferentes corrompe toda a projeção do cargo e ninguém percebe até
 * a apuração. Por isso a automação só decide quando a evidência é redundante —
 * na dúvida, a linha vai para a fila do coordenador.
 */

export interface CandidatoManual {
  id: string;
  nomeUrna: string;
  nomeCompleto: string;
  numeroUrna: string;
  siglaPartido: string | null;
  idCargo: string;
}

export interface CandidaturaOficial {
  idTse: number;
  nomeUrna: string;
  nomeCompleto: string;
  numeroUrna: string;
  siglaPartido: string | null;
  idCargo: string;
}

export type DecisaoMesclagem = 'MESCLAR' | 'REVISAR' | 'IGNORAR';

export interface AvaliacaoMesclagem {
  decisao: DecisaoMesclagem;
  similaridadeNome: number;
  numeroConfere: boolean;
  partidoConfere: boolean;
  cargoConfere: boolean;
  /** Explicação em português, exibida na fila de revisão. */
  justificativa: string;
}

export const PARAMETROS_MESCLAGEM = {
  /**
   * Acima disso os nomes são praticamente o mesmo texto — diferença de acento,
   * abreviação ou um sobrenome a mais.
   */
  similaridadeAlta: 0.82,
  /** Abaixo disso não vale nem sugerir: são pessoas diferentes. */
  similaridadeMinima: 0.45,
} as const;

/**
 * Avalia um par (pré-candidato, candidatura oficial).
 *
 * A decisão automática de MESCLAR exige **três** evidências independentes:
 * número de urna igual, partido igual e nome muito parecido. Número sozinho não
 * basta — o mesmo número pertence a candidatos diferentes em UFs diferentes, e
 * até no mesmo estado ele é reaproveitado entre cargos.
 */
export function avaliarMesclagem(
  manual: CandidatoManual,
  oficial: CandidaturaOficial,
): AvaliacaoMesclagem {
  const similaridadeNome = Math.max(
    similaridade(manual.nomeUrna, oficial.nomeUrna),
    // O nome completo desempata quando o nome de urna foi apelidado: "Zé da
    // Padaria" na urna, "José Carlos de Almeida" no registro.
    similaridade(manual.nomeCompleto, oficial.nomeCompleto) * 0.95,
  );

  const numeroConfere = somenteDigitos(manual.numeroUrna) === somenteDigitos(oficial.numeroUrna);
  const partidoConfere =
    normalizarTexto(manual.siglaPartido) === normalizarTexto(oficial.siglaPartido) &&
    normalizarTexto(manual.siglaPartido) !== '';
  const cargoConfere = manual.idCargo === oficial.idCargo;

  const base = { similaridadeNome, numeroConfere, partidoConfere, cargoConfere };

  // Cargo diferente encerra o assunto: são candidaturas distintas, ainda que da
  // mesma pessoa (o que acontece — alguém registrado para deputado estadual
  // depois de ter sido pré-candidato a federal).
  if (!cargoConfere) {
    return {
      ...base,
      decisao: 'IGNORAR',
      justificativa: 'Cargos diferentes — são candidaturas distintas.',
    };
  }

  if (similaridadeNome < PARAMETROS_MESCLAGEM.similaridadeMinima && !numeroConfere) {
    return {
      ...base,
      decisao: 'IGNORAR',
      justificativa: 'Nome e número não se aproximam o bastante para sugerir mesclagem.',
    };
  }

  if (
    numeroConfere &&
    partidoConfere &&
    similaridadeNome >= PARAMETROS_MESCLAGEM.similaridadeAlta
  ) {
    return {
      ...base,
      decisao: 'MESCLAR',
      justificativa: 'Número, partido e nome coincidem.',
    };
  }

  // Daqui para baixo, tudo vai para revisão humana — com o motivo escrito, para
  // o coordenador decidir em segundos e não precisar reabrir o CSV do TSE.
  if (numeroConfere && !partidoConfere) {
    return {
      ...base,
      decisao: 'REVISAR',
      justificativa:
        `Mesmo número de urna, partidos diferentes ` +
        `(${manual.siglaPartido ?? 'sem partido'} × ${oficial.siglaPartido ?? 'sem partido'}). ` +
        'Pode ser troca de legenda na convenção.',
    };
  }

  if (!numeroConfere && similaridadeNome >= PARAMETROS_MESCLAGEM.similaridadeAlta) {
    return {
      ...base,
      decisao: 'REVISAR',
      justificativa:
        `Nome praticamente idêntico, números diferentes ` +
        `(${manual.numeroUrna} × ${oficial.numeroUrna}). ` +
        'O número da pré-candidatura costuma ser palpite antes do registro.',
    };
  }

  return {
    ...base,
    decisao: 'REVISAR',
    justificativa: `Coincidência parcial (${Math.round(similaridadeNome * 100)}% de semelhança no nome).`,
  };
}

/**
 * Para cada pré-candidato, escolhe a melhor candidatura oficial correspondente.
 *
 * Uma candidatura oficial nunca é atribuída a dois pré-candidatos: a disputa é
 * resolvida pela força da evidência. Sem isso, dois irmãos com nomes parecidos
 * na mesma chapa seriam ambos mesclados com o mesmo registro.
 */
export function parearCandidaturas(
  manuais: readonly CandidatoManual[],
  oficiais: readonly CandidaturaOficial[],
): Array<{ manual: CandidatoManual; oficial: CandidaturaOficial; avaliacao: AvaliacaoMesclagem }> {
  const pares: Array<{
    manual: CandidatoManual;
    oficial: CandidaturaOficial;
    avaliacao: AvaliacaoMesclagem;
  }> = [];

  for (const manual of manuais) {
    for (const oficial of oficiais) {
      const avaliacao = avaliarMesclagem(manual, oficial);
      if (avaliacao.decisao === 'IGNORAR') continue;
      pares.push({ manual, oficial, avaliacao });
    }
  }

  // Melhor evidência primeiro: mesclagem automática antes de revisão, e dentro
  // de cada grupo, maior semelhança de nome.
  pares.sort((a, b) => {
    const forca = (item: typeof a): number =>
      (item.avaliacao.decisao === 'MESCLAR' ? 100 : 0) +
      (item.avaliacao.numeroConfere ? 10 : 0) +
      (item.avaliacao.partidoConfere ? 5 : 0) +
      item.avaliacao.similaridadeNome;
    return forca(b) - forca(a);
  });

  const manuaisUsados = new Set<string>();
  const oficiaisUsados = new Set<number>();
  const resultado: typeof pares = [];

  for (const par of pares) {
    if (manuaisUsados.has(par.manual.id) || oficiaisUsados.has(par.oficial.idTse)) continue;
    manuaisUsados.add(par.manual.id);
    oficiaisUsados.add(par.oficial.idTse);
    resultado.push(par);
  }

  return resultado;
}

function somenteDigitos(valor: string | null | undefined): string {
  return (valor ?? '').replace(/\D+/g, '');
}
