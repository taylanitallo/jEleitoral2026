'use client';

import { X } from 'lucide-react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useCallback, useMemo } from 'react';
import { Botao, cn } from '@jeleitoral/ui';
import type { FiltroGlobal } from '@jeleitoral/tipos';
import {
  contarFiltrosAtivos,
  deParametrosUrl,
  limparFiltro,
  paraParametrosUrl,
  selecionarNivel,
} from '@/lib/filtroGlobal';

export interface OpcaoFiltro {
  valor: string;
  rotulo: string;
}

/**
 * Barra de filtro global.
 *
 * Fica numa linha só, acima dos painéis, e é a única forma de mudar o recorte —
 * não há filtro por painel. Todos recalculam juntos, sempre sobre o mesmo
 * recorte, o que elimina a situação em que dois números da mesma tela discordam
 * porque respondem a filtros diferentes.
 *
 * O estado vive na URL: link compartilhável, botão voltar funcional, recarga
 * sem perda.
 */
export function BarraFiltros({
  idCampanha,
  opcoes,
  className,
}: {
  idCampanha: string;
  opcoes: Partial<Record<keyof FiltroGlobal, OpcaoFiltro[]>>;
  className?: string;
}): JSX.Element {
  const roteador = useRouter();
  const parametros = useSearchParams();

  const filtro = useMemo(
    () => ({ ...deParametrosUrl(new URLSearchParams(parametros.toString())), idCampanha }),
    [parametros, idCampanha],
  );

  const aplicar = useCallback(
    (novo: Partial<FiltroGlobal>) => {
      // `scroll: false` para o painel não pular para o topo a cada ajuste —
      // quem está comparando seções perde a referência visual.
      roteador.replace(`?${paraParametrosUrl(novo).toString()}`, { scroll: false });
    },
    [roteador],
  );

  const campos: Array<{ chave: keyof FiltroGlobal; rotulo: string }> = [
    { chave: 'idCargo', rotulo: 'Cargo' },
    { chave: 'idCandidato', rotulo: 'Candidato' },
    { chave: 'uf', rotulo: 'UF' },
    { chave: 'idMunicipio', rotulo: 'Município' },
    { chave: 'idZona', rotulo: 'Zona' },
    { chave: 'idLocalVotacao', rotulo: 'Local' },
    { chave: 'idSecao', rotulo: 'Seção' },
    { chave: 'idBairro', rotulo: 'Bairro' },
    { chave: 'idEquipe', rotulo: 'Equipe' },
  ];

  const ativos = contarFiltrosAtivos(filtro);

  const aFormatoData = (data: Date | undefined): string =>
    data ? data.toISOString().slice(0, 10) : '';
  const aplicarData = (chave: 'dataInicio' | 'dataFim', valor: string): void => {
    const novo: Record<string, unknown> = { ...filtro };
    if (!valor) delete novo[chave];
    else novo[chave] = new Date(`${valor}T00:00:00`);
    aplicar(novo as Partial<FiltroGlobal>);
  };

  return (
    <div
      data-imprimir="ocultar"
      className={cn(
        'flex flex-wrap items-end gap-2 rounded-[var(--raio)] border border-[hsl(var(--borda))] bg-[hsl(var(--superficie))] p-3',
        className,
      )}
    >
      {campos
        .filter(({ chave }) => (opcoes[chave]?.length ?? 0) > 0)
        .map(({ chave, rotulo }) => (
          <label key={chave} className="flex min-w-[9rem] flex-1 flex-col gap-1">
            <span className="text-xs text-[hsl(var(--texto-secundario))]">{rotulo}</span>
            <select
              value={String(filtro[chave] ?? '')}
              onChange={(evento) =>
                aplicar(selecionarNivel(filtro, chave, evento.target.value || undefined))
              }
              className="h-9 rounded-[var(--raio)] border border-[hsl(var(--borda))] bg-[hsl(var(--superficie))] px-2 text-sm text-[hsl(var(--texto))]"
            >
              <option value="">Todos</option>
              {opcoes[chave]?.map((opcao) => (
                <option key={opcao.valor} value={opcao.valor}>
                  {opcao.rotulo}
                </option>
              ))}
            </select>
          </label>
        ))}

      <label className="flex min-w-[8rem] flex-1 flex-col gap-1">
        <span className="text-xs text-[hsl(var(--texto-secundario))]">Período — de</span>
        <input
          type="date"
          value={aFormatoData(filtro.dataInicio)}
          onChange={(evento) => aplicarData('dataInicio', evento.target.value)}
          className="h-9 rounded-[var(--raio)] border border-[hsl(var(--borda))] bg-[hsl(var(--superficie))] px-2 text-sm text-[hsl(var(--texto))]"
        />
      </label>
      <label className="flex min-w-[8rem] flex-1 flex-col gap-1">
        <span className="text-xs text-[hsl(var(--texto-secundario))]">até</span>
        <input
          type="date"
          value={aFormatoData(filtro.dataFim)}
          onChange={(evento) => aplicarData('dataFim', evento.target.value)}
          className="h-9 rounded-[var(--raio)] border border-[hsl(var(--borda))] bg-[hsl(var(--superficie))] px-2 text-sm text-[hsl(var(--texto))]"
        />
      </label>

      {ativos > 0 ? (
        <Botao variante="sutil" onClick={() => aplicar(limparFiltro(filtro))} className="h-9">
          <X />
          Limpar {ativos}
        </Botao>
      ) : null}
    </div>
  );
}
