import Link from 'next/link';
import { IndicadorFilaOffline } from '@/componentes/IndicadorFilaOffline';

/**
 * Página inicial provisória.
 *
 * Existe para dar um ponto de entrada verificável enquanto as telas de campo e
 * os dashboards não chegam. Será substituída pelo painel filtrado da campanha.
 */
export default function PaginaInicial(): JSX.Element {
  return (
    <main className="mx-auto flex min-h-dvh max-w-3xl flex-col gap-6 px-4 py-10">
      <header>
        <h1 className="text-2xl font-semibold text-[hsl(var(--texto))]">jEleitoral</h1>
        <p className="mt-1 text-sm text-[hsl(var(--texto-secundario))]">
          Mapeamento, projeção e gestão eleitoral — Eleições Gerais 2026
        </p>
      </header>

      <IndicadorFilaOffline />

      <section className="rounded-[var(--raio)] border border-[hsl(var(--borda))] bg-[hsl(var(--superficie))] p-4">
        <h2 className="text-sm font-medium text-[hsl(var(--texto))]">Em construção</h2>
        <p className="mt-1 text-sm text-[hsl(var(--texto-secundario))]">
          O modelo de dados, o isolamento por organização e campanha, a camada de ingestão do
          IBGE e do TSE e a fila offline já estão implementados. As telas de campo, os
          dashboards e os relatórios ainda não.
        </p>
        <Link
          href="/saude"
          className="mt-3 inline-block text-sm text-[hsl(var(--acento))] underline underline-offset-4"
        >
          Ver estado das integrações
        </Link>
      </section>
    </main>
  );
}
