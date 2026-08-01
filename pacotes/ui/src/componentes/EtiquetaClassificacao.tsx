'use client';

import {
  CircleHelp,
  CircleMinus,
  ThumbsDown,
  ThumbsUp,
  TrendingUp,
  type LucideIcon,
} from 'lucide-react';
import type { ClassificacaoEleitor } from '@jeleitoral/tipos';
import { cn } from '../utilitarios/cn';

/**
 * Etiqueta de classificação do eleitor.
 *
 * A cor sozinha nunca carrega o significado: cada etiqueta traz ícone e
 * rótulo textual (WCAG 1.4.1). Isso não é só acessibilidade formal — o
 * relatório impresso em preto e branco, que é como a coordenação lê na
 * reunião, ficaria ilegível se a cor fosse o único sinal.
 */

interface Aparencia {
  rotulo: string;
  icone: LucideIcon;
  classes: string;
}

const APARENCIAS: Record<ClassificacaoEleitor, Aparencia> = {
  APOIADOR: {
    rotulo: 'Apoiador',
    icone: ThumbsUp,
    classes: 'bg-[hsl(var(--apoiador-sutil))] text-[hsl(var(--apoiador))] border-[hsl(var(--apoiador)/0.3)]',
  },
  PROVAVEL: {
    rotulo: 'Provável',
    icone: TrendingUp,
    classes: 'bg-[hsl(var(--provavel-sutil))] text-[hsl(var(--provavel))] border-[hsl(var(--provavel)/0.3)]',
  },
  INDECISO: {
    rotulo: 'Indeciso',
    icone: CircleHelp,
    classes: 'bg-[hsl(var(--indeciso-sutil))] text-[hsl(var(--indeciso))] border-[hsl(var(--indeciso)/0.3)]',
  },
  OPOSICAO: {
    rotulo: 'Oposição',
    icone: ThumbsDown,
    classes: 'bg-[hsl(var(--oposicao-sutil))] text-[hsl(var(--oposicao))] border-[hsl(var(--oposicao)/0.3)]',
  },
  NAO_INFORMOU: {
    rotulo: 'Não informou',
    icone: CircleMinus,
    classes:
      'bg-[hsl(var(--nao-informou-sutil))] text-[hsl(var(--nao-informou))] border-[hsl(var(--nao-informou)/0.3)]',
  },
};

export function EtiquetaClassificacao({
  classificacao,
  compacta = false,
  className,
}: {
  classificacao: ClassificacaoEleitor;
  compacta?: boolean;
  className?: string;
}): JSX.Element {
  const aparencia = APARENCIAS[classificacao];
  const Icone = aparencia.icone;
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-xs font-medium',
        aparencia.classes,
        className,
      )}
    >
      <Icone className="size-3.5 shrink-0" aria-hidden="true" />
      {/* Em modo compacto o rótulo sai da tela mas permanece para o leitor de tela. */}
      <span className={compacta ? 'sr-only' : undefined}>{aparencia.rotulo}</span>
    </span>
  );
}

/** Cor CSS da classificação, para uso em gráficos do Recharts. */
export function corDaClassificacao(classificacao: ClassificacaoEleitor): string {
  const variaveis: Record<ClassificacaoEleitor, string> = {
    APOIADOR: 'var(--apoiador)',
    PROVAVEL: 'var(--provavel)',
    INDECISO: 'var(--indeciso)',
    OPOSICAO: 'var(--oposicao)',
    NAO_INFORMOU: 'var(--nao-informou)',
  };
  return `hsl(${variaveis[classificacao]})`;
}
