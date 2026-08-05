'use client';

import { useSearchParams } from 'next/navigation';
import { Suspense, useMemo, useState } from 'react';
import { BarraAcoes, Botao, EstadoCarregando, EstadoVazio, TarjaUsoInterno } from '@jeleitoral/ui';
import {
  FormatoExportacao,
  NaturezaLevantamento,
  RotuloNaturezaLevantamento,
  type FiltroGlobal,
  type FormatoExportacao as Formato,
  type NaturezaLevantamento as Natureza,
} from '@jeleitoral/tipos';
import { Campo, classeControle } from '@/componentes/cadastro/Campo';
import { BarraFiltros } from '@/componentes/dashboard/BarraFiltros';
import { deParametrosUrl, descreverFiltro } from '@/lib/filtroGlobal';
import { useListagem } from '@/lib/useListagem';
import { useOpcoesFiltro, type OpcoesFiltro } from '@/lib/useOpcoesFiltro';
import { useSessao } from '@/lib/useSessao';

interface RelatorioCatalogo {
  chave: string;
  titulo: string;
  descricao: string;
}

/**
 * Rótulo legível de cada filtro ativo, para a auditoria da exportação.
 *
 * A URL só guarda IDs (`idBairro=uuid`). Sem resolver para o nome antes de
 * mandar ao servidor, o cabeçalho do PDF diria "Bairro: 3f2a...", que não
 * serve para auditar recorte nenhum três meses depois.
 */
function rotulosDosFiltrosAtivos(
  filtro: Partial<FiltroGlobal>,
  opcoes: OpcoesFiltro,
): Array<{ rotulo: string; valor: string }> {
  const nomes: Partial<Record<keyof FiltroGlobal, string>> = {
    idCargo: 'Cargo',
    idCandidato: 'Candidato',
    uf: 'UF',
    idMunicipio: 'Município',
    idZona: 'Zona',
    idLocalVotacao: 'Local de votação',
    idSecao: 'Seção',
    idBairro: 'Bairro',
    idEquipe: 'Equipe',
  };

  const partes: Array<{ rotulo: string; valor: string }> = [];
  for (const [chave, rotulo] of Object.entries(nomes) as Array<[keyof FiltroGlobal, string]>) {
    const valor = filtro[chave];
    if (valor === undefined || valor === null || valor === '') continue;
    const opcao = opcoes[chave as keyof OpcoesFiltro]?.find((item) => item.valor === String(valor));
    partes.push({ rotulo, valor: opcao?.rotulo ?? String(valor) });
  }
  if (filtro.dataInicio || filtro.dataFim) {
    const inicio = filtro.dataInicio?.toLocaleDateString('pt-BR') ?? 'início';
    const fim = filtro.dataFim?.toLocaleDateString('pt-BR') ?? 'hoje';
    partes.push({ rotulo: 'Período', valor: `${inicio} a ${fim}` });
  }
  return partes;
}

function ConteudoRelatorios(): JSX.Element {
  const parametros = useSearchParams();
  const { idCampanha, carregando: carregandoSessao } = useSessao();
  const [gerando, definirGerando] = useState<string | null>(null);
  const [aviso, definirAviso] = useState<string | null>(null);
  const [formato, definirFormato] = useState<Formato>('PDF');
  const [natureza, definirNatureza] = useState<Natureza>('LEVANTAMENTO_INTERNO');

  const filtro = useMemo(
    () => ({
      ...deParametrosUrl(new URLSearchParams(parametros.toString())),
      idCampanha: idCampanha ?? '',
    }),
    [parametros, idCampanha],
  );
  const { opcoes } = useOpcoesFiltro(idCampanha, filtro);
  const { dados: catalogo, carregando: carregandoCatalogo } =
    useListagem<RelatorioCatalogo[]>('/relatorios/catalogo');

  async function exportar(relatorio: string): Promise<void> {
    if (!idCampanha) return;
    definirGerando(relatorio);
    definirAviso(null);

    try {
      // Resposta binária: o cliente comum devolve JSON, então aqui vai `fetch`
      // direto para preservar o corpo como blob.
      const resposta = await fetch('/api/relatorios/exportar', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          relatorio,
          formato,
          natureza,
          filtro,
          filtrosPorExtenso: rotulosDosFiltrosAtivos(filtro, opcoes),
        }),
      });

      if (resposta.status === 202) {
        const corpo = (await resposta.json()) as { mensagem: string };
        definirAviso(corpo.mensagem);
        return;
      }

      if (!resposta.ok) {
        const corpo = (await resposta.json().catch(() => null)) as { mensagem?: string } | null;
        definirAviso(corpo?.mensagem ?? 'Não foi possível gerar o relatório.');
        return;
      }

      const blob = await resposta.blob();
      const nome =
        /filename="([^"]+)"/.exec(resposta.headers.get('Content-Disposition') ?? '')?.[1] ??
        `${relatorio}.${formato.toLowerCase()}`;

      const url = URL.createObjectURL(blob);
      const ancora = document.createElement('a');
      ancora.href = url;
      ancora.download = nome;
      ancora.click();
      URL.revokeObjectURL(url);
    } finally {
      definirGerando(null);
    }
  }

  if (carregandoSessao) return <EstadoCarregando mensagem="Carregando…" linhas={3} />;

  if (!idCampanha) {
    return <EstadoVazio titulo="Nenhuma campanha vinculada" />;
  }

  return (
    <>
      <BarraAcoes titulo="Relatórios" subtitulo={descreverFiltro(filtro)} imprimir={{}} />

      <TarjaUsoInterno natureza={natureza} />

      <BarraFiltros idCampanha={idCampanha} opcoes={opcoes} />

      <div className="grid gap-3 sm:grid-cols-2">
        <Campo id="formato" rotulo="Formato">
          <select
            id="formato"
            value={formato}
            onChange={(evento) => definirFormato(evento.target.value as Formato)}
            className={classeControle}
          >
            {FormatoExportacao.options.map((valor) => (
              <option key={valor} value={valor}>
                {valor}
              </option>
            ))}
          </select>
        </Campo>

        <Campo
          id="natureza"
          rotulo="Natureza"
          dica="Levantamento interno não pode ser divulgado publicamente."
        >
          <select
            id="natureza"
            value={natureza}
            onChange={(evento) => definirNatureza(evento.target.value as Natureza)}
            className={classeControle}
          >
            {NaturezaLevantamento.options.map((valor: Natureza) => (
              <option key={valor} value={valor}>
                {RotuloNaturezaLevantamento[valor]}
              </option>
            ))}
          </select>
        </Campo>
      </div>

      {aviso ? (
        <p
          role="status"
          className="rounded-[var(--raio)] border border-[hsl(var(--borda))] bg-[hsl(var(--fundo-sutil))] px-3 py-2 text-sm text-[hsl(var(--texto-secundario))]"
        >
          {aviso}
        </p>
      ) : null}

      {carregandoCatalogo ? (
        <EstadoCarregando mensagem="Carregando relatórios…" linhas={3} />
      ) : (
        <ul className="grid gap-3 sm:grid-cols-2">
          {(catalogo ?? []).map((relatorio) => (
            <li
              key={relatorio.chave}
              className="flex flex-col gap-2 rounded-[var(--raio)] border border-[hsl(var(--borda))] bg-[hsl(var(--superficie))] p-4"
            >
              <h2 className="text-sm font-medium text-[hsl(var(--texto))]">{relatorio.titulo}</h2>
              <p className="text-sm text-[hsl(var(--texto-secundario))]">{relatorio.descricao}</p>
              <Botao
                className="self-start"
                carregando={gerando === relatorio.chave}
                onClick={() => void exportar(relatorio.chave)}
              >
                Exportar {formato}
              </Botao>
            </li>
          ))}
        </ul>
      )}

      <p className="text-xs text-[hsl(var(--texto-fraco))]">
        Todo arquivo exportado sai com marca d&apos;água pessoal e fica registrado na auditoria.
        Exportações grandes são enfileiradas e avisadas quando prontas.
      </p>
    </>
  );
}

export default function PaginaRelatorios(): JSX.Element {
  return (
    <main className="mx-auto flex max-w-6xl flex-col gap-4 px-4 py-6">
      {/* `useSearchParams` exige fronteira de Suspense na renderização estática. */}
      <Suspense fallback={<EstadoCarregando mensagem="Carregando relatórios…" />}>
        <ConteudoRelatorios />
      </Suspense>
    </main>
  );
}
