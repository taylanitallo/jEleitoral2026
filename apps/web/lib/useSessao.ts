'use client';

import { useEffect, useState } from 'react';
import { api } from './api';

export interface Sessao {
  idUsuario: string;
  email: string;
  perfil: string;
  campanhas: string[];
  permissoes: Record<string, string>;
  mfaVerificado: boolean;
}

/**
 * Sessão do usuário autenticado.
 *
 * As telas dependem disto para saber **em qual campanha** operam. Antes elas
 * carregavam um identificador fixo no código — o painel consultava uma campanha
 * que o usuário não tinha, e o resultado era uma tela vazia que parecia falha de
 * login.
 *
 * Quando houver troca de campanha na barra superior, ela grava a escolha aqui;
 * por enquanto vale a primeira do token.
 */
export function useSessao(): {
  sessao: Sessao | null;
  idCampanha: string | null;
  carregando: boolean;
} {
  const [sessao, definirSessao] = useState<Sessao | null>(null);
  const [carregando, definirCarregando] = useState(true);

  useEffect(() => {
    api
      .obter<Sessao>('/autenticacao/sessao')
      .then(definirSessao)
      .catch(() => definirSessao(null))
      .finally(() => definirCarregando(false));
  }, []);

  return {
    sessao,
    idCampanha: sessao?.campanhas[0] ?? null,
    carregando,
  };
}
