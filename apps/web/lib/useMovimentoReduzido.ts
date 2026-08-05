'use client';

import { useEffect, useState } from 'react';

/** `prefers-reduced-motion`, para as cenas 3D pularem a animação em vez de recusar o 3D inteiro. */
export function useMovimentoReduzido(): boolean {
  const [reduzido, definirReduzido] = useState(false);

  useEffect(() => {
    const consulta = window.matchMedia('(prefers-reduced-motion: reduce)');
    definirReduzido(consulta.matches);
    const ouvir = (evento: MediaQueryListEvent): void => definirReduzido(evento.matches);
    consulta.addEventListener('change', ouvir);
    return () => consulta.removeEventListener('change', ouvir);
  }, []);

  return reduzido;
}
