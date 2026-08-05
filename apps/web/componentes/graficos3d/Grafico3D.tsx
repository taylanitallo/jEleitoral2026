'use client';

import { Box, ChartColumnBig } from 'lucide-react';
import { useEffect, useState, type ReactNode } from 'react';
import { Botao } from '@jeleitoral/ui';

function suportaWebgl(): boolean {
  try {
    const tela = document.createElement('canvas');
    return Boolean(tela.getContext('webgl2') ?? tela.getContext('webgl'));
  } catch {
    return false;
  }
}

/** Heurística grosseira de aparelho fraco: só muda o PADRÃO, nunca bloqueia a alternância. */
function pareceAparelhoFraco(): boolean {
  const nucleos = (navigator as Navigator & { hardwareConcurrency?: number }).hardwareConcurrency;
  return typeof nucleos === 'number' && nucleos > 0 && nucleos <= 2;
}

export interface Grafico3DProps {
  /** Identifica o gráfico para lembrar a preferência 2D/3D entre visitas. */
  chave: string;
  altura?: string;
  /** Já deve vir de um componente carregado via `next/dynamic({ ssr: false })`. */
  render3D: ReactNode;
  render2D: ReactNode;
}

/**
 * Par 3D/2D com degradação em quatro graus, nenhum deles decorativo:
 *
 *  1. **Sem WebGL** — a alternância nem aparece. Não é escolha do usuário; é o
 *     aparelho que não tem a capacidade.
 *  2. **`prefers-reduced-motion`** — o 3D continua a opção, mas a cena não
 *     anima (isso é responsabilidade de cada cena, via `useMovimentoReduzido`);
 *     aqui influencia só o PADRÃO inicial em aparelho que parece fraco.
 *  3. **Impressão** — o canvas WebGL nunca imprime de forma confiável;
 *     `data-imprimir="ocultar"` tira o 3D do papel, e a classe `print:block`
 *     força o par 2D a aparecer mesmo quando a tela está mostrando o 3D.
 *  4. **Interruptor manual** — persistido por gráfico em `localStorage`, para
 *     quem prefere 2D por gosto, não por limitação.
 *
 * O 3D nunca é o único caminho para ler um valor: o 2D existe sempre no DOM,
 * só escondido quando o 3D está ativo — não removido.
 */
export function Grafico3D({
  chave,
  altura = '24rem',
  render3D,
  render2D,
}: Grafico3DProps): JSX.Element {
  const [podeWebgl, definirPodeWebgl] = useState(true);
  const [preferencia, definirPreferenciaEstado] = useState<'3D' | '2D' | null>(null);

  useEffect(() => {
    const suportado = suportaWebgl();
    definirPodeWebgl(suportado);

    const chaveArmazenamento = `jeleitoral:grafico3d:${chave}`;
    const salvo = window.localStorage.getItem(chaveArmazenamento);
    if (salvo === '2D' || salvo === '3D') {
      definirPreferenciaEstado(salvo);
    } else {
      definirPreferenciaEstado(suportado && !pareceAparelhoFraco() ? '3D' : '2D');
    }
  }, [chave]);

  function definirPreferencia(novo: '3D' | '2D'): void {
    definirPreferenciaEstado(novo);
    window.localStorage.setItem(`jeleitoral:grafico3d:${chave}`, novo);
  }

  // Primeira pintura (preferencia ainda null) ou sem WebGL: 2D, sem hesitar.
  const modo: '3D' | '2D' = podeWebgl && preferencia === '3D' ? '3D' : '2D';

  return (
    <div className="flex flex-col gap-2">
      {podeWebgl ? (
        <div data-imprimir="ocultar" className="flex justify-end">
          <Botao
            variante="sutil"
            tamanho="pequeno"
            onClick={() => definirPreferencia(modo === '3D' ? '2D' : '3D')}
          >
            {modo === '3D' ? (
              <>
                <ChartColumnBig className="size-4" aria-hidden="true" /> Ver em 2D
              </>
            ) : (
              <>
                <Box className="size-4" aria-hidden="true" /> Ver em 3D
              </>
            )}
          </Botao>
        </div>
      ) : null}

      <div
        data-imprimir="ocultar"
        style={{ height: altura }}
        className={modo === '3D' ? 'block' : 'hidden'}
      >
        {modo === '3D' ? render3D : null}
      </div>

      <div className={modo === '2D' ? 'block' : 'hidden print:block'}>{render2D}</div>
    </div>
  );
}
