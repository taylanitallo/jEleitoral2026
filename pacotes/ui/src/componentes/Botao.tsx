'use client';

import { cva, type VariantProps } from 'class-variance-authority';
import { forwardRef } from 'react';
import { cn } from '../utilitarios/cn';

const variantesBotao = cva(
  'inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-[var(--raio)] text-sm font-medium transition-colors disabled:pointer-events-none disabled:opacity-50 [&_svg]:size-4 [&_svg]:shrink-0',
  {
    variants: {
      variante: {
        primario:
          'bg-[hsl(var(--acento))] text-[hsl(var(--acento-contraste))] hover:bg-[hsl(var(--acento)/0.9)]',
        secundario:
          'border border-[hsl(var(--borda))] bg-[hsl(var(--superficie))] text-[hsl(var(--texto))] hover:bg-[hsl(var(--fundo-sutil))]',
        sutil: 'text-[hsl(var(--texto-secundario))] hover:bg-[hsl(var(--fundo-sutil))] hover:text-[hsl(var(--texto))]',
        perigo: 'bg-[hsl(var(--perigo))] text-white hover:bg-[hsl(var(--perigo)/0.9)]',
        contorno_perigo:
          'border border-[hsl(var(--perigo)/0.4)] text-[hsl(var(--perigo))] hover:bg-[hsl(var(--perigo-sutil))]',
      },
      tamanho: {
        pequeno: 'h-8 px-2.5 text-xs',
        medio: 'h-9 px-3',
        grande: 'h-10 px-4',
        icone: 'h-9 w-9',
      },
    },
    defaultVariants: { variante: 'secundario', tamanho: 'medio' },
  },
);

export interface PropriedadesBotao
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof variantesBotao> {
  carregando?: boolean;
}

export const Botao = forwardRef<HTMLButtonElement, PropriedadesBotao>(function Botao(
  { className, variante, tamanho, carregando, disabled, children, ...resto },
  ref,
) {
  return (
    <button
      ref={ref}
      type="button"
      className={cn(variantesBotao({ variante, tamanho }), className)}
      disabled={disabled || carregando}
      aria-busy={carregando || undefined}
      {...resto}
    >
      {carregando ? (
        <span
          className="size-3.5 animate-spin rounded-full border-2 border-current border-t-transparent"
          aria-hidden="true"
        />
      ) : null}
      {children}
    </button>
  );
});
