'use client';

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';

export type PreferenciaTema = 'claro' | 'escuro' | 'sistema';

interface ContextoTema {
  preferencia: PreferenciaTema;
  /** Tema efetivamente aplicado depois de resolver 'sistema'. */
  temaAplicado: 'claro' | 'escuro';
  definirPreferencia: (preferencia: PreferenciaTema) => void;
  alternar: () => void;
}

const Contexto = createContext<ContextoTema | null>(null);

const CHAVE_ARMAZENAMENTO = 'jeleitoral:tema';

function lerPreferenciaSalva(): PreferenciaTema {
  if (typeof window === 'undefined') return 'sistema';
  const salvo = window.localStorage.getItem(CHAVE_ARMAZENAMENTO);
  return salvo === 'claro' || salvo === 'escuro' || salvo === 'sistema' ? salvo : 'sistema';
}

function resolverTema(preferencia: PreferenciaTema): 'claro' | 'escuro' {
  if (preferencia !== 'sistema') return preferencia;
  if (typeof window === 'undefined') return 'claro';
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'escuro' : 'claro';
}

/**
 * Provedor de tema.
 *
 * A preferência é persistida por usuário no `localStorage` e sincronizada com o
 * perfil no backend quando ele salva as configurações. O padrão é `sistema`,
 * respeitando `prefers-color-scheme` — só sobrescrevemos quando o usuário
 * escolheu explicitamente.
 *
 * O `corAcento` recebe a cor da campanha (em HSL, ex.: "142 71% 32%") e
 * sobrescreve o token `--acento` em tempo de execução.
 */
export function ProvedorTema({
  children,
  corAcento,
}: {
  children: React.ReactNode;
  corAcento?: string | null;
}): JSX.Element {
  const [preferencia, definirEstado] = useState<PreferenciaTema>('sistema');
  const [temaAplicado, definirTemaAplicado] = useState<'claro' | 'escuro'>('claro');

  // Lê a preferência salva só depois da montagem, para não divergir do HTML
  // renderizado no servidor.
  useEffect(() => {
    const salva = lerPreferenciaSalva();
    definirEstado(salva);
  }, []);

  useEffect(() => {
    const raiz = document.documentElement;
    const aplicar = (): void => {
      const resolvido = resolverTema(preferencia);
      definirTemaAplicado(resolvido);
      if (preferencia === 'sistema') {
        raiz.removeAttribute('data-tema');
      } else {
        raiz.setAttribute('data-tema', preferencia);
      }
    };

    aplicar();

    if (preferencia !== 'sistema') return undefined;
    // Acompanha a troca de tema do sistema operacional enquanto a preferência
    // for 'sistema'.
    const consulta = window.matchMedia('(prefers-color-scheme: dark)');
    consulta.addEventListener('change', aplicar);
    return () => consulta.removeEventListener('change', aplicar);
  }, [preferencia]);

  useEffect(() => {
    if (!corAcento) return;
    document.documentElement.style.setProperty('--acento', corAcento);
  }, [corAcento]);

  const definirPreferencia = useCallback((nova: PreferenciaTema) => {
    definirEstado(nova);
    window.localStorage.setItem(CHAVE_ARMAZENAMENTO, nova);
  }, []);

  const alternar = useCallback(() => {
    definirPreferencia(resolverTema(lerPreferenciaSalva()) === 'escuro' ? 'claro' : 'escuro');
  }, [definirPreferencia]);

  const valor = useMemo<ContextoTema>(
    () => ({ preferencia, temaAplicado, definirPreferencia, alternar }),
    [preferencia, temaAplicado, definirPreferencia, alternar],
  );

  return <Contexto.Provider value={valor}>{children}</Contexto.Provider>;
}

export function useTema(): ContextoTema {
  const contexto = useContext(Contexto);
  if (!contexto) {
    throw new Error('useTema precisa estar dentro de <ProvedorTema>.');
  }
  return contexto;
}

/**
 * Script inline que aplica o tema antes da primeira pintura, evitando o
 * "flash" branco em quem usa tema escuro. Deve ir no <head> do documento.
 */
export const SCRIPT_TEMA_INICIAL = `(function(){try{var p=localStorage.getItem('${CHAVE_ARMAZENAMENTO}');if(p==='claro'||p==='escuro'){document.documentElement.setAttribute('data-tema',p);}}catch(e){}})();`;
