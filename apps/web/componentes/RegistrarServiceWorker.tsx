'use client';

import { useEffect } from 'react';

/**
 * Registra o service worker.
 *
 * Fica fora do `layout` como componente próprio porque o layout é servidor e o
 * registro precisa do navegador.
 *
 * Só registra em produção. Em desenvolvimento o service worker guardaria os
 * artefatos do `next dev`, que mudam a cada salvamento — o efeito é editar um
 * arquivo, recarregar e continuar vendo a versão antiga, um sintoma que se
 * confunde com defeito no código e custa horas até alguém lembrar do cache.
 */
export function RegistrarServiceWorker(): null {
  useEffect(() => {
    if (process.env.NODE_ENV !== 'production') return;
    if (!('serviceWorker' in navigator)) return;

    // Depois do `load`: registrar durante o carregamento inicial faz o download
    // do worker disputar banda com o que a tela precisa para aparecer, e em 3G
    // isso é a diferença entre abrir em 2 e em 5 segundos.
    const registrar = (): void => {
      navigator.serviceWorker.register('/sw.js').catch(() => {
        // Falhar aqui não pode derrubar a aplicação: sem service worker o
        // sistema funciona normalmente com rede, que é a situação da maioria
        // dos usuários. Quem perde é só o offline, e avisar no console é o
        // suficiente — não há ação do usuário que resolva.
        console.warn(
          '[jEleitoral] Service worker não registrado; o modo offline fica indisponível.',
        );
      });
    };

    if (document.readyState === 'complete') registrar();
    else window.addEventListener('load', registrar, { once: true });

    return () => window.removeEventListener('load', registrar);
  }, []);

  return null;
}
