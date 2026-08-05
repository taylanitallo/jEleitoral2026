'use client';

import { usePathname } from 'next/navigation';
import { createContext, useCallback, useContext, useEffect, useState } from 'react';
import { api } from '@/lib/api';

export interface CampanhaDisponivel {
  id: string;
  nome: string;
  uf: string | null;
  idMunicipio: number | null;
  nomeMunicipio: string | null;
  anoPleito: number;
  ativa: boolean;
}

export interface SessaoCompleta {
  idUsuario: string;
  email: string;
  perfil: string;
  /** Mantido ao lado de `campanhasDisponiveis`: telas antigas dependem dele. */
  campanhas: string[];
  campanhasDisponiveis: CampanhaDisponivel[];
  permissoes: Record<string, string>;
  mfaVerificado: boolean;
  ehProvedor: boolean;
}

interface ContextoSessao {
  sessao: SessaoCompleta | null;
  idCampanha: string | null;
  carregando: boolean;
  definirCampanhaAtiva: (id: string) => void;
}

const CHAVE_CAMPANHA_ATIVA = 'jeleitoral.campanha-ativa';

const Contexto = createContext<ContextoSessao | null>(null);

/**
 * Busca `/autenticacao/sessao` UMA VEZ para a árvore inteira.
 *
 * Antes, cada tela chamava `useSessao()` e cada uma refazia o fetch — 17
 * componentes, 17 requisições à mesma rota a cada navegação. `Estrutura.tsx`
 * ainda mantinha uma cópia própria por fora disso. Aqui vira uma leitura só,
 * na raiz.
 *
 * Também é onde mora a campanha ATIVA. `localStorage`, e não a URL: o
 * entrevistador precisa da campanha lembrada sem rede — é o mesmo motivo pelo
 * qual a fila de entrevistas vive no IndexedDB.
 */
export function ProvedorSessao({ children }: { children: React.ReactNode }): JSX.Element {
  const [sessao, definirSessao] = useState<SessaoCompleta | null>(null);
  const [carregando, definirCarregando] = useState(true);
  const [idCampanha, definirIdCampanhaEstado] = useState<string | null>(null);
  const caminho = usePathname();
  const naTelaDeEntrada = caminho.startsWith('/entrar') || caminho.startsWith('/offline');

  useEffect(() => {
    if (naTelaDeEntrada) {
      definirCarregando(false);
      return;
    }
    let ativo = true;

    api
      .obter<SessaoCompleta>('/autenticacao/sessao')
      .then((resposta) => {
        if (!ativo) return;
        definirSessao(resposta);

        let salva: string | null = null;
        try {
          salva = window.localStorage.getItem(CHAVE_CAMPANHA_ATIVA);
        } catch {
          // Sem storage, segue sem lembrar — não é motivo para travar a sessão.
        }
        const valida =
          salva && resposta.campanhas.includes(salva) ? salva : (resposta.campanhas[0] ?? null);
        definirIdCampanhaEstado(valida);
      })
      .catch(() => {
        if (ativo) definirSessao(null);
      })
      .finally(() => {
        if (ativo) definirCarregando(false);
      });

    return () => {
      ativo = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [naTelaDeEntrada]);

  const definirCampanhaAtiva = useCallback((id: string) => {
    definirIdCampanhaEstado(id);
    try {
      window.localStorage.setItem(CHAVE_CAMPANHA_ATIVA, id);
    } catch {
      // Idem: falha ao gravar não pode impedir a troca em memória.
    }
  }, []);

  return (
    <Contexto.Provider value={{ sessao, idCampanha, carregando, definirCampanhaAtiva }}>
      {children}
    </Contexto.Provider>
  );
}

export function useContextoSessao(): ContextoSessao {
  const valor = useContext(Contexto);
  if (!valor) {
    throw new Error('useContextoSessao precisa estar dentro de <ProvedorSessao>.');
  }
  return valor;
}
