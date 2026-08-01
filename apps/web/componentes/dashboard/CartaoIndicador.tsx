import { TriangleAlert } from 'lucide-react';
import { cn } from '@jeleitoral/ui';
import { formatarNumero, formatarPercentual } from '@jeleitoral/utilitarios';

/**
 * Cartão de indicador.
 *
 * O número é o herói: grande, tabular, em tinta de texto — nunca na cor da
 * série. Quando há identidade a comunicar (um candidato, uma classificação),
 * ela vem de uma marca colorida ao lado, não do número pintado. Número colorido
 * some para quem tem daltonismo e não sobrevive à impressão em preto e branco,
 * que é como a coordenação lê na reunião.
 *
 * Sem gráfico embutido, não há camada de hover: o valor já está escrito.
 */
export function CartaoIndicador({
  rotulo,
  valor,
  unidade,
  detalhe,
  corMarca,
  advertencia,
  className,
}: {
  rotulo: string;
  valor: number | string;
  unidade?: string;
  detalhe?: React.ReactNode;
  /** Cor da marca de identidade, em CSS. Nunca aplicada ao número. */
  corMarca?: string;
  advertencia?: string | null;
  className?: string;
}): JSX.Element {
  return (
    <div
      className={cn(
        'cartao-indicador evitar-quebra rounded-[var(--raio)] border border-[hsl(var(--borda))] bg-[hsl(var(--superficie))] p-4',
        className,
      )}
    >
      <div className="flex items-center gap-2">
        {corMarca ? (
          <span
            className="size-2.5 shrink-0 rounded-full"
            style={{ backgroundColor: corMarca }}
            aria-hidden="true"
          />
        ) : null}
        <p className="truncate text-sm text-[hsl(var(--texto-secundario))]">{rotulo}</p>
      </div>

      <p className="mt-1.5 flex items-baseline gap-1" data-numerico>
        <span className="text-3xl font-semibold text-[hsl(var(--texto))]">
          {typeof valor === 'number' ? formatarNumero(valor) : valor}
        </span>
        {unidade ? (
          <span className="text-sm text-[hsl(var(--texto-secundario))]">{unidade}</span>
        ) : null}
      </p>

      {detalhe ? (
        <p className="mt-1 text-sm text-[hsl(var(--texto-secundario))]">{detalhe}</p>
      ) : null}

      {advertencia ? (
        <p className="mt-2 flex items-start gap-1.5 text-xs text-[hsl(var(--atencao))]">
          <TriangleAlert className="mt-0.5 size-3.5 shrink-0" aria-hidden="true" />
          {advertencia}
        </p>
      ) : null}
    </div>
  );
}

/**
 * Cartão de projeção.
 *
 * Componente próprio porque a regra do produto é inegociável: a projeção nunca
 * aparece sem a cobertura amostral ao lado. Não existe caminho na interface que
 * exiba "1.240 votos" sem dizer que isso vem de 4% da seção mapeada — a
 * assinatura deste componente torna a omissão impossível.
 */
export function CartaoProjecao({
  rotulo,
  votosProjetados,
  intervaloMin,
  intervaloMax,
  coberturaAmostral,
  advertencia,
  corMarca,
}: {
  rotulo: string;
  votosProjetados: number;
  intervaloMin: number;
  intervaloMax: number;
  coberturaAmostral: number;
  advertencia: string | null;
  corMarca?: string;
}): JSX.Element {
  return (
    <CartaoIndicador
      rotulo={rotulo}
      valor={Math.round(votosProjetados)}
      unidade="votos"
      corMarca={corMarca}
      advertencia={advertencia}
      detalhe={
        <>
          entre {formatarNumero(Math.round(intervaloMin))} e{' '}
          {formatarNumero(Math.round(intervaloMax))} · cobertura de{' '}
          {formatarPercentual(coberturaAmostral)}
        </>
      }
    />
  );
}
