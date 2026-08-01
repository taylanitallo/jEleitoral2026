import { distanciaEmMetros, type TipoAlertaColeta } from '@jeleitoral/tipos';

/**
 * Antifraude de campo.
 *
 * Lógica pura, sem banco, para poder ser testada de verdade e reaproveitada no
 * aparelho (avisando o entrevistador antes de enviar) e no servidor (que é onde
 * a avaliação vale).
 *
 * Uma observação sobre o propósito: isto NÃO acusa ninguém de fraude. Aponta
 * padrões que merecem conferência do coordenador — entrevista de 40 segundos
 * pode ser um vizinho conhecido que respondeu rápido, e GPS a 800 metros pode
 * ser um celular ruim numa área sem cobertura. Por isso `alertas_coleta` tem
 * `procedente` e `revisado_por`: a decisão é humana. Tratar o alerta como
 * veredito destruiria a confiança da equipe de campo, que é o ativo mais frágil
 * de uma campanha.
 */

export interface AlertaColeta {
  tipo: TipoAlertaColeta;
  gravidade: 1 | 2 | 3;
  detalhe: Record<string, unknown>;
  mensagem: string;
}

export interface EntrevistaParaAvaliacao {
  duracaoSegundos?: number | null;
  latitude?: number | null;
  longitude?: number | null;
  precisaoGpsMetros?: number | null;
  quantidadeIntencoes: number;
  dataHora: Date;
}

export interface ContextoAvaliacao {
  /** Coordenada do logradouro declarado, quando conhecida. */
  coordenadaEndereco?: { latitude: number; longitude: number } | null;
  /** Territórios designados ao entrevistador, para checar desvio de rota. */
  idBairroDeclarado?: string | null;
  territoriosDesignados?: readonly string[];
  /** Horários das demais entrevistas do mesmo entrevistador na última hora. */
  entrevistasNaUltimaHora: readonly Date[];
}

export const PARAMETROS_ANTIFRAUDE = {
  /**
   * 90 segundos. Abaixo disso não dá tempo de ler o termo de consentimento,
   * colher o aceite e perguntar a intenção para mais de um cargo.
   */
  duracaoMinimaSegundos: 90,
  duracaoMuitoCurtaSegundos: 40,
  /** 500 m já é longe demais para um erro honesto de GPS urbano. */
  distanciaMaximaMetros: 500,
  distanciaGraveMetros: 2000,
  /** Precisão pior que isso torna a comparação de distância pouco confiável. */
  precisaoGpsAceitavelMetros: 100,
  /** 20 entrevistas/hora = uma a cada 3 minutos, ininterruptas. Improvável. */
  maximoEntrevistasPorHora: 20,
} as const;

export function avaliarEntrevista(
  entrevista: EntrevistaParaAvaliacao,
  contexto: ContextoAvaliacao,
): AlertaColeta[] {
  const alertas: AlertaColeta[] = [];

  // --- Duração ---------------------------------------------------------------
  const duracao = entrevista.duracaoSegundos;
  if (typeof duracao === 'number' && duracao > 0) {
    if (duracao < PARAMETROS_ANTIFRAUDE.duracaoMuitoCurtaSegundos) {
      alertas.push({
        tipo: 'DURACAO_CURTA',
        gravidade: 3,
        detalhe: { duracaoSegundos: duracao, minimo: PARAMETROS_ANTIFRAUDE.duracaoMinimaSegundos },
        mensagem: `Entrevista de ${duracao}s — tempo insuficiente para colher consentimento e intenção.`,
      });
    } else if (duracao < PARAMETROS_ANTIFRAUDE.duracaoMinimaSegundos) {
      alertas.push({
        tipo: 'DURACAO_CURTA',
        gravidade: 1,
        detalhe: { duracaoSegundos: duracao },
        mensagem: `Entrevista de ${duracao}s, abaixo do tempo típico.`,
      });
    }
  }

  // --- Geolocalização --------------------------------------------------------
  const temCoordenada =
    typeof entrevista.latitude === 'number' && typeof entrevista.longitude === 'number';

  if (!temCoordenada) {
    alertas.push({
      tipo: 'SEM_GEOLOCALIZACAO',
      gravidade: 1,
      detalhe: {},
      mensagem: 'Entrevista sem GPS. Comum em área rural sem sinal; confira com o entrevistador.',
    });
  } else if (contexto.coordenadaEndereco) {
    const distancia = Math.round(
      distanciaEmMetros(
        { latitude: entrevista.latitude!, longitude: entrevista.longitude! },
        contexto.coordenadaEndereco,
      ),
    );
    const precisao = entrevista.precisaoGpsMetros ?? 0;
    // Um GPS com precisão de 300 m explica sozinho um desvio de 300 m. Só
    // acusamos o que a imprecisão declarada não justifica.
    const desvioNaoExplicado = distancia - precisao;

    if (desvioNaoExplicado > PARAMETROS_ANTIFRAUDE.distanciaGraveMetros) {
      alertas.push({
        tipo: 'GPS_DISTANTE',
        gravidade: 3,
        detalhe: { distanciaMetros: distancia, precisaoMetros: precisao },
        mensagem: `GPS a ${distancia} m do endereço declarado.`,
      });
    } else if (desvioNaoExplicado > PARAMETROS_ANTIFRAUDE.distanciaMaximaMetros) {
      alertas.push({
        tipo: 'GPS_DISTANTE',
        gravidade: 2,
        detalhe: { distanciaMetros: distancia, precisaoMetros: precisao },
        mensagem: `GPS a ${distancia} m do endereço declarado.`,
      });
    }

    if (precisao > PARAMETROS_ANTIFRAUDE.precisaoGpsAceitavelMetros) {
      alertas.push({
        tipo: 'SEM_GEOLOCALIZACAO',
        gravidade: 1,
        detalhe: { precisaoMetros: precisao },
        mensagem: `Precisão de GPS de ${Math.round(precisao)} m — localização pouco confiável.`,
      });
    }
  }

  // --- Território designado --------------------------------------------------
  const territorios = contexto.territoriosDesignados ?? [];
  if (
    territorios.length > 0 &&
    contexto.idBairroDeclarado &&
    !territorios.includes(contexto.idBairroDeclarado)
  ) {
    alertas.push({
      tipo: 'FORA_DO_TERRITORIO',
      gravidade: 2,
      detalhe: { idBairro: contexto.idBairroDeclarado },
      mensagem: 'Entrevista registrada fora do território designado ao entrevistador.',
    });
  }

  // --- Volume por hora -------------------------------------------------------
  const umaHoraAntes = entrevista.dataHora.getTime() - 60 * 60 * 1000;
  const naJanela = contexto.entrevistasNaUltimaHora.filter(
    (momento) => momento.getTime() >= umaHoraAntes && momento <= entrevista.dataHora,
  ).length;

  if (naJanela + 1 > PARAMETROS_ANTIFRAUDE.maximoEntrevistasPorHora) {
    alertas.push({
      tipo: 'VOLUME_IMPROVAVEL',
      gravidade: 3,
      detalhe: {
        entrevistasNaHora: naJanela + 1,
        maximo: PARAMETROS_ANTIFRAUDE.maximoEntrevistasPorHora,
      },
      mensagem: `${naJanela + 1} entrevistas em uma hora para o mesmo entrevistador.`,
    });
  }

  return alertas;
}

/**
 * Índice de qualidade da coleta de um entrevistador, de 0 a 1.
 *
 * Pondera pela gravidade em vez de contar alertas: dez avisos de "sem GPS" numa
 * região rural não são o mesmo problema que um único caso de volume impossível.
 */
export function calcularIndiceQualidade(
  totalEntrevistas: number,
  alertas: readonly Pick<AlertaColeta, 'gravidade'>[],
): number {
  if (totalEntrevistas === 0) return 1;
  const peso = { 1: 0.25, 2: 1, 3: 3 } as const;
  const penalidade = alertas.reduce((soma, alerta) => soma + peso[alerta.gravidade], 0);
  return Math.max(0, Math.min(1, 1 - penalidade / (totalEntrevistas * 3)));
}
