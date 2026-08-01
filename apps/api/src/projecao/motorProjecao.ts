import type { MetodoProjecao } from '@jeleitoral/tipos';

/**
 * Motor de projeção.
 *
 * Lógica pura, sem banco: dá para testar de verdade e dá para explicar. As duas
 * coisas importam, porque este número vai orientar onde a campanha gasta tempo
 * e dinheiro, e alguém vai perguntar de onde ele saiu.
 *
 * O princípio que governa o arquivo inteiro: **a projeção nunca viaja sozinha**.
 * Ela sai acompanhada de método, cobertura amostral, tamanho da amostra e
 * intervalo. Dizer "78% nesta seção" com 3% dela mapeada não é otimismo, é
 * desinformação — e a estrutura de retorno torna impossível exibir o número sem
 * exibir o quanto ele vale.
 */

export interface IntencaoAmostrada {
  /** 1 a 5. Quanto o eleitor se disse certo do voto. */
  grauCerteza: number;
  /** Declaração de terceiro sobre o domicílio, não do próprio eleitor. */
  porDomicilio: boolean;
  /** Quantos votos essa declaração representa (1 para intenção individual). */
  quantidade: number;
}

export interface InsumosProjecao {
  /** Total de eleitores do recorte, segundo o TSE. É o denominador. */
  eleitoradoBase: number;
  /** Entrevistados distintos alcançados no recorte. */
  amostraTamanho: number;
  /** Declarações a favor do candidato em avaliação. */
  intencoesDoCandidato: readonly IntencaoAmostrada[];
  /** Declarações válidas totais (todos os candidatos + brancos/nulos declarados). */
  declaracoesValidas: number;
  /**
   * Desempenho do candidato ou do seu partido no mesmo recorte em 2022, como
   * fração dos votos válidos. Ausente quando não há histórico comparável.
   */
  fracaoHistorica?: number | null;
}

export interface ResultadoProjecao {
  votosProjetados: number;
  intervaloMin: number;
  intervaloMax: number;
  indiceConfianca: number;
  coberturaAmostral: number;
  metodo: MetodoProjecao;
  /** Tudo que produziu o número, para reconstituir o cálculo depois. */
  insumos: Record<string, number | string | null>;
  /** Advertência a exibir junto do número. `null` quando não há ressalva. */
  advertencia: string | null;
}

export const PARAMETROS_PROJECAO = {
  /**
   * A partir daqui a amostra sustenta a projeção sozinha. 15% de uma seção de
   * 400 eleitores são 60 entrevistas — o suficiente para uma margem de erro
   * defensável.
   */
  coberturaConfiavel: 0.15,
  /** Abaixo disso a amostra praticamente não informa: o histórico manda. */
  coberturaMinima: 0.03,
  /** Menos de 15 entrevistas não sustentam inferência, qualquer que seja a cobertura. */
  amostraMinimaAbsoluta: 15,
  /**
   * Peso da declaração por domicílio.
   *
   * "Aqui em casa somos quatro e todos votam em você" é informação de segunda
   * mão, dada por quem tem interesse em agradar o entrevistador. Vale menos que
   * a intenção declarada pelo próprio eleitor — mas vale, porque em campo é
   * frequentemente a única coisa que se consegue. 0,6 é uma escolha de projeto,
   * não uma constante da natureza: está aqui, isolada e documentada, para poder
   * ser calibrada quando houver resultado real para comparar.
   */
  pesoVotoDomicilio: 0.6,
  /** z de 95% de confiança. */
  zNoventaECinco: 1.96,
} as const;

/**
 * Peso de uma declaração conforme o grau de certeza (1 a 5).
 *
 * Quem diz "com certeza" pesa 1; quem diz "acho que sim" pesa 0,6. Tratar os
 * dois igualmente infla sistematicamente a projeção, porque o indeciso simpático
 * responde para agradar.
 */
export function pesoPorCerteza(grauCerteza: number): number {
  const tabela: Record<number, number> = { 1: 0.2, 2: 0.4, 3: 0.6, 4: 0.8, 5: 1 };
  return tabela[Math.min(5, Math.max(1, Math.round(grauCerteza)))] ?? 0.6;
}

function somarPonderado(intencoes: readonly IntencaoAmostrada[]): number {
  return intencoes.reduce((total, intencao) => {
    const peso =
      pesoPorCerteza(intencao.grauCerteza) *
      (intencao.porDomicilio ? PARAMETROS_PROJECAO.pesoVotoDomicilio : 1);
    return total + peso * intencao.quantidade;
  }, 0);
}

/**
 * Erro padrão de uma proporção com correção para população finita.
 *
 * A correção importa muito aqui: uma seção tem 300 a 500 eleitores, não uma
 * população infinita. Ignorá-la produziria intervalos absurdamente largos em
 * seções bem mapeadas — exatamente onde a projeção deveria ser mais firme.
 */
function erroPadrao(proporcao: number, amostra: number, populacao: number): number {
  if (amostra <= 1 || populacao <= 1) return 0.5;
  const variancia = (proporcao * (1 - proporcao)) / amostra;
  const correcaoFinita = Math.max(0, (populacao - amostra) / (populacao - 1));
  return Math.sqrt(variancia * correcaoFinita);
}

export function projetar(insumos: InsumosProjecao): ResultadoProjecao {
  const { eleitoradoBase, amostraTamanho, declaracoesValidas, fracaoHistorica } = insumos;

  const cobertura =
    eleitoradoBase > 0 ? Math.min(1, amostraTamanho / eleitoradoBase) : 0;

  const base = {
    coberturaAmostral: cobertura,
    insumos: {
      eleitoradoBase,
      amostraTamanho,
      declaracoesValidas,
      fracaoHistorica: fracaoHistorica ?? null,
      pesoVotoDomicilio: PARAMETROS_PROJECAO.pesoVotoDomicilio,
    } as Record<string, number | string | null>,
  };

  // --- Sem denominador: não há o que projetar --------------------------------
  if (eleitoradoBase <= 0) {
    return {
      ...base,
      votosProjetados: 0,
      intervaloMin: 0,
      intervaloMax: 0,
      indiceConfianca: 0,
      metodo: 'SEM_BASE',
      advertencia:
        'Sem o eleitorado da seção não é possível projetar. Carregue os dados do TSE para esta UF.',
    };
  }

  const votosPonderados = somarPonderado(insumos.intencoesDoCandidato);
  const fracaoAmostra = declaracoesValidas > 0 ? votosPonderados / declaracoesValidas : 0;

  const amostraUtil =
    amostraTamanho >= PARAMETROS_PROJECAO.amostraMinimaAbsoluta &&
    cobertura >= PARAMETROS_PROJECAO.coberturaMinima;
  const temHistorico = typeof fracaoHistorica === 'number' && fracaoHistorica >= 0;

  // --- Sem amostra útil e sem histórico --------------------------------------
  if (!amostraUtil && !temHistorico) {
    return {
      ...base,
      votosProjetados: 0,
      intervaloMin: 0,
      intervaloMax: eleitoradoBase,
      indiceConfianca: 0,
      metodo: 'SEM_BASE',
      advertencia:
        amostraTamanho === 0
          ? 'Nenhuma entrevista neste recorte. Não há projeção possível.'
          : `Apenas ${amostraTamanho} entrevista(s) e nenhum histórico comparável. ` +
            'O número não seria informativo.',
    };
  }

  // --- Escolha do método ------------------------------------------------------
  let metodo: MetodoProjecao;
  let fracaoFinal: number;
  /** Quanto a amostra pesa contra o histórico, de 0 a 1. */
  let pesoAmostra: number;

  if (!amostraUtil) {
    metodo = 'HISTORICO_PONDERADO';
    pesoAmostra = 0;
    fracaoFinal = fracaoHistorica as number;
  } else if (cobertura >= PARAMETROS_PROJECAO.coberturaConfiavel || !temHistorico) {
    metodo = 'AMOSTRA_DIRETA';
    pesoAmostra = 1;
    fracaoFinal = fracaoAmostra;
  } else {
    // Entre o mínimo e o confiável, a amostra ganha peso proporcionalmente à
    // cobertura. A transição é contínua de propósito: um degrau faria a
    // projeção saltar de um dia para o outro só porque entrou uma entrevista.
    metodo = 'HIBRIDO';
    pesoAmostra = Math.min(1, cobertura / PARAMETROS_PROJECAO.coberturaConfiavel);
    fracaoFinal = pesoAmostra * fracaoAmostra + (1 - pesoAmostra) * (fracaoHistorica as number);
  }

  fracaoFinal = Math.min(1, Math.max(0, fracaoFinal));

  // --- Intervalo --------------------------------------------------------------
  const erro = amostraUtil
    ? erroPadrao(fracaoAmostra, amostraTamanho, eleitoradoBase)
    : // Projeção puramente histórica: a incerteza não é amostral. Adotamos uma
      // margem fixa de 10 pontos, que reflete a volatilidade típica entre
      // pleitos e é honesta quanto a não ser um cálculo estatístico.
      0.1 / PARAMETROS_PROJECAO.zNoventaECinco;

  const margem = PARAMETROS_PROJECAO.zNoventaECinco * erro * pesoAmostra +
    PARAMETROS_PROJECAO.zNoventaECinco * (0.1 / PARAMETROS_PROJECAO.zNoventaECinco) * (1 - pesoAmostra);

  const votosProjetados = fracaoFinal * eleitoradoBase;
  const intervaloMin = Math.max(0, (fracaoFinal - margem) * eleitoradoBase);
  const intervaloMax = Math.min(eleitoradoBase, (fracaoFinal + margem) * eleitoradoBase);

  // --- Índice de confiança ----------------------------------------------------
  const fatorCobertura = Math.min(1, cobertura / PARAMETROS_PROJECAO.coberturaConfiavel);
  const fatorAmostra = Math.min(1, amostraTamanho / 30);
  const certezaMedia =
    insumos.intencoesDoCandidato.length > 0
      ? insumos.intencoesDoCandidato.reduce((s, i) => s + pesoPorCerteza(i.grauCerteza), 0) /
        insumos.intencoesDoCandidato.length
      : 0.6;
  // Amostra que destoa muito do histórico merece desconfiança dos dois lados.
  const fatorConsistencia = temHistorico
    ? 1 - Math.min(1, Math.abs(fracaoAmostra - (fracaoHistorica as number)) / 0.5)
    : 0.7;

  const indiceConfianca = Math.min(
    1,
    Math.max(
      0,
      0.4 * fatorCobertura + 0.25 * fatorAmostra + 0.2 * certezaMedia + 0.15 * fatorConsistencia,
    ),
  );

  return {
    ...base,
    votosProjetados,
    intervaloMin,
    intervaloMax,
    indiceConfianca,
    metodo,
    insumos: {
      ...base.insumos,
      votosPonderados,
      fracaoAmostra,
      fracaoFinal,
      pesoAmostra,
      margem,
      metodo,
    },
    advertencia: montarAdvertencia(cobertura, amostraTamanho, metodo),
  };
}

function montarAdvertencia(
  cobertura: number,
  amostraTamanho: number,
  metodo: MetodoProjecao,
): string | null {
  const percentual = (cobertura * 100).toFixed(1).replace('.', ',');

  if (metodo === 'HISTORICO_PONDERADO') {
    return (
      `Projeção baseada no resultado de 2022, não no mapeamento — ` +
      `apenas ${amostraTamanho} entrevista(s) neste recorte.`
    );
  }
  if (cobertura < PARAMETROS_PROJECAO.coberturaConfiavel) {
    return `Cobertura de ${percentual}% do eleitorado. Trate como indicação, não como previsão.`;
  }
  return null;
}

/**
 * Agrega projeções de nível inferior (seções) em um nível superior (bairro,
 * zona, município). Soma os votos e recalcula a cobertura sobre o eleitorado
 * somado.
 *
 * O índice de confiança agregado é a média **ponderada pelo eleitorado**, e não
 * a média simples: uma seção de 50 eleitores muito bem mapeada não deve mascarar
 * dez seções grandes sem cobertura nenhuma.
 */
export function agregar(
  projecoes: readonly ResultadoProjecao[],
): Omit<ResultadoProjecao, 'metodo' | 'insumos'> & { metodo: MetodoProjecao } {
  if (projecoes.length === 0) {
    return {
      votosProjetados: 0,
      intervaloMin: 0,
      intervaloMax: 0,
      indiceConfianca: 0,
      coberturaAmostral: 0,
      metodo: 'SEM_BASE',
      advertencia: 'Nenhum recorte com dados suficientes.',
    };
  }

  const eleitoradoTotal = projecoes.reduce(
    (soma, p) => soma + Number(p.insumos['eleitoradoBase'] ?? 0),
    0,
  );
  const amostraTotal = projecoes.reduce(
    (soma, p) => soma + Number(p.insumos['amostraTamanho'] ?? 0),
    0,
  );

  const votosProjetados = projecoes.reduce((soma, p) => soma + p.votosProjetados, 0);
  const confiancaPonderada =
    eleitoradoTotal > 0
      ? projecoes.reduce(
          (soma, p) => soma + p.indiceConfianca * Number(p.insumos['eleitoradoBase'] ?? 0),
          0,
        ) / eleitoradoTotal
      : 0;

  const metodos = new Set(projecoes.map((p) => p.metodo));
  const metodo: MetodoProjecao =
    metodos.size === 1 ? [...metodos][0]! : metodos.has('AMOSTRA_DIRETA') ? 'HIBRIDO' : 'SEM_BASE';

  const cobertura = eleitoradoTotal > 0 ? Math.min(1, amostraTotal / eleitoradoTotal) : 0;

  return {
    votosProjetados,
    // Os intervalos das seções são independentes; somá-los diretamente
    // exageraria a incerteza do agregado, mas subestimá-la seria pior. Somamos,
    // assumindo o cenário conservador.
    intervaloMin: projecoes.reduce((soma, p) => soma + p.intervaloMin, 0),
    intervaloMax: projecoes.reduce((soma, p) => soma + p.intervaloMax, 0),
    indiceConfianca: confiancaPonderada,
    coberturaAmostral: cobertura,
    metodo,
    advertencia: montarAdvertencia(cobertura, amostraTotal, metodo),
  };
}
