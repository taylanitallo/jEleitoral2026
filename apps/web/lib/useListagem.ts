'use client';

import { useCallback, useEffect, useState } from 'react';
import { ErroDaApi, api } from './api';

/**
 * Listagem de um cadastro: carrega, expõe erro tipado e recarrega sob demanda.
 *
 * O erro é guardado como `ErroDaApi` inteiro, não como texto: a tela precisa do
 * identificador de correlação para exibir junto da mensagem. Sem ele, "não foi
 * possível concluir" vira um chamado de suporte impossível de rastrear.
 *
 * `caminho` nulo adia a busca — serve para telas que dependem da campanha da
 * sessão, que só chega depois.
 */
export function useListagem<T>(caminho: string | null): {
  dados: T | null;
  carregando: boolean;
  erro: ErroDaApi | null;
  recarregar: () => void;
} {
  const [dados, definirDados] = useState<T | null>(null);
  const [carregando, definirCarregando] = useState(true);
  const [erro, definirErro] = useState<ErroDaApi | null>(null);
  const [gatilho, definirGatilho] = useState(0);

  useEffect(() => {
    if (!caminho) {
      definirCarregando(false);
      return;
    }

    let ativo = true;
    definirCarregando(true);
    definirErro(null);

    api
      .obter<T>(caminho)
      .then((resposta) => {
        if (ativo) definirDados(resposta);
      })
      .catch((falha: unknown) => {
        if (!ativo) return;
        definirErro(
          falha instanceof ErroDaApi
            ? falha
            : new ErroDaApi(0, {
                codigo: 'ERRO',
                mensagem: 'Não foi possível carregar a lista.',
                idCorrelacao: undefined,
              }),
        );
      })
      .finally(() => {
        if (ativo) definirCarregando(false);
      });

    return () => {
      ativo = false;
    };
  }, [caminho, gatilho]);

  const recarregar = useCallback(() => definirGatilho((valor) => valor + 1), []);

  return { dados, carregando, erro, recarregar };
}
