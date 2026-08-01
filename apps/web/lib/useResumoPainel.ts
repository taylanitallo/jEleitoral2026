'use client';

import { useEffect, useRef, useState } from 'react';
import type { ClassificacaoEleitor, FiltroGlobal } from '@jeleitoral/tipos';
import { api, ErroDaApi } from './api';
import { paraParametrosUrl } from './filtroGlobal';

export interface ResumoPainel {
  eleitoresMapeados: number;
  domiciliosVisitados: number;
  entrevistasConcluidas: number;
  eleitoradoDoRecorte: number;
  coberturaAmostral: number;
  porClassificacao: Array<{ classificacao: ClassificacaoEleitor; total: number }>;
  entrevistasPorDia: Array<{ dia: string; total: number }>;
}

/**
 * Busca o resumo do painel para o recorte atual.
 *
 * Dois cuidados que a rede de campanha impõe:
 *
 *  • **Debounce.** Mudar cargo, depois UF, depois seção dispara três requisições
 *    se não houver espera. Numa rede fraca, as três competem e a última a chegar
 *    pode não ser a mais recente.
 *  • **Descarte de resposta obsoleta.** Cada busca carrega um número de série;
 *    respostas de filtros antigos são jogadas fora. Sem isso o painel exibiria,
 *    de vez em quando, o número da seção anterior — um erro silencioso e
 *    difícil de reproduzir.
 */
export function useResumoPainel(filtro: Partial<FiltroGlobal>): {
  resumo: ResumoPainel | null;
  carregando: boolean;
  erro: ErroDaApi | null;
  recarregar: () => void;
} {
  const [resumo, definirResumo] = useState<ResumoPainel | null>(null);
  const [carregando, definirCarregando] = useState(true);
  const [erro, definirErro] = useState<ErroDaApi | null>(null);
  const [gatilho, definirGatilho] = useState(0);

  const serie = useRef(0);
  const consulta = paraParametrosUrl(filtro).toString();

  useEffect(() => {
    if (!filtro.idCampanha) return undefined;

    const minhaSerie = ++serie.current;
    definirCarregando(true);

    const temporizador = window.setTimeout(() => {
      api
        .obter<ResumoPainel>(`/painel/resumo?${consulta}`)
        .then((dados) => {
          if (minhaSerie !== serie.current) return;
          definirResumo(dados);
          definirErro(null);
        })
        .catch((problema: unknown) => {
          if (minhaSerie !== serie.current) return;
          definirErro(
            problema instanceof ErroDaApi
              ? problema
              : new ErroDaApi(0, {
                  codigo: 'ERRO',
                  mensagem: 'Não foi possível carregar o painel.',
                }),
          );
        })
        .finally(() => {
          if (minhaSerie === serie.current) definirCarregando(false);
        });
    }, 250);

    return () => window.clearTimeout(temporizador);
  }, [consulta, filtro.idCampanha, gatilho]);

  return { resumo, carregando, erro, recarregar: () => definirGatilho((n) => n + 1) };
}
