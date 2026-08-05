'use client';

import { useContextoSessao, type SessaoCompleta } from '@/componentes/navegacao/ProvedorSessao';

export type Sessao = SessaoCompleta;

/**
 * Sessão do usuário autenticado.
 *
 * A leitura de verdade agora mora em `<ProvedorSessao>`, montado uma vez na
 * raiz — este hook só repassa o contexto. A ASSINATURA fica igual à de antes
 * de propósito: as telas que já chamam `useSessao()` continuam funcionando
 * sem mudar uma linha.
 *
 * A campanha ativa é a lembrada em `localStorage` (troca pela barra
 * superior); sem escolha salva, vale a primeira do token.
 */
export function useSessao(): {
  sessao: Sessao | null;
  idCampanha: string | null;
  carregando: boolean;
} {
  const { sessao, idCampanha, carregando } = useContextoSessao();
  return { sessao, idCampanha, carregando };
}
