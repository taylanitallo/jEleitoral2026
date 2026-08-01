'use client';

import type { ReactNode } from 'react';

/**
 * Rótulo + controle + erro, com a associação de acessibilidade já feita.
 *
 * O erro é ligado por `aria-describedby` e o campo marcado com `aria-invalid`:
 * um leitor de tela precisa anunciar *qual* campo recusou e *por quê*, e isso
 * some se cada tela inventar seu próprio arranjo.
 */
export function Campo({
  id,
  rotulo,
  erro,
  dica,
  obrigatorio,
  children,
}: {
  id: string;
  rotulo: string;
  erro?: string | null;
  dica?: string;
  obrigatorio?: boolean;
  children: ReactNode;
}): JSX.Element {
  return (
    <div className="flex flex-col gap-1">
      <label htmlFor={id} className="text-sm font-medium text-[hsl(var(--texto))]">
        {rotulo}
        {obrigatorio ? (
          <span className="ml-0.5 text-[hsl(var(--perigo))]" aria-hidden="true">
            *
          </span>
        ) : null}
      </label>
      {children}
      {dica && !erro ? (
        <p id={`${id}-dica`} className="text-xs text-[hsl(var(--texto-fraco))]">
          {dica}
        </p>
      ) : null}
      {erro ? (
        <p id={`${id}-erro`} role="alert" className="text-xs text-[hsl(var(--perigo))]">
          {erro}
        </p>
      ) : null}
    </div>
  );
}

export const classeControle =
  'w-full rounded-[var(--raio)] border border-[hsl(var(--borda))] bg-[hsl(var(--superficie))] px-2.5 py-1.5 text-sm text-[hsl(var(--texto))] outline-none focus-visible:ring-2 focus-visible:ring-[hsl(var(--acento))]';
