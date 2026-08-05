'use client';

import { useSearchParams } from 'next/navigation';
import { Suspense, useMemo } from 'react';
import {
  BarraAcoes,
  EstadoCarregando,
  EstadoErro,
  EstadoVazio,
  EtiquetaClassificacao,
  TarjaUsoInterno,
  corDaClassificacao,
} from '@jeleitoral/ui';
import { formatarPercentual } from '@jeleitoral/utilitarios';
import type { ClassificacaoEleitor } from '@jeleitoral/tipos';
import { BarraFiltros } from '@/componentes/dashboard/BarraFiltros';
import { CartaoIndicador } from '@/componentes/dashboard/CartaoIndicador';
import { GraficoTendencia } from '@/componentes/dashboard/GraficoTendencia';
import { deParametrosUrl, descreverFiltro } from '@/lib/filtroGlobal';
import { useOpcoesFiltro } from '@/lib/useOpcoesFiltro';
import { useResumoPainel } from '@/lib/useResumoPainel';
import { useSessao } from '@/lib/useSessao';

/** Ordem fixa das faixas. Nunca reordenar por tamanho: a cor segue a entidade. */
const ORDEM_CLASSIFICACAO: ClassificacaoEleitor[] = [
  'APOIADOR',
  'PROVAVEL',
  'INDECISO',
  'OPOSICAO',
  'NAO_INFORMOU',
];

function ConteudoPainel(): JSX.Element {
  const parametros = useSearchParams();
  const { sessao, idCampanha, carregando: carregandoSessao } = useSessao();

  const filtro = useMemo(
    () => ({
      ...deParametrosUrl(new URLSearchParams(parametros.toString())),
      idCampanha: idCampanha ?? '',
    }),
    [parametros, idCampanha],
  );

  const { resumo, carregando, erro, recarregar } = useResumoPainel(filtro);
  const { opcoes, carregando: carregandoOpcoes } = useOpcoesFiltro(idCampanha, filtro);

  if (carregandoSessao) {
    return <EstadoCarregando mensagem="Carregando sua campanha…" linhas={4} />;
  }

  if (!idCampanha) {
    return (
      <EstadoVazio
        titulo="Nenhuma campanha vinculada"
        descricao={`O usuário ${sessao?.email ?? ''} não está vinculado a nenhuma campanha. Peça ao administrador da organização para incluí-lo.`}
      />
    );
  }

  const totalClassificado =
    resumo?.porClassificacao.reduce((soma, item) => soma + item.total, 0) ?? 0;

  return (
    <div className="flex flex-col gap-4">
      <BarraAcoes
        titulo="Painel da campanha"
        subtitulo={descreverFiltro(filtro)}
        atualizar={{ aoAcionar: recarregar, carregando }}
        exportarPdf={{ desabilitado: true, dica: 'Exportação em PDF ainda não implementada' }}
        exportarExcel={{ desabilitado: true, dica: 'Exportação em Excel ainda não implementada' }}
        imprimir={{}}
      />

      <TarjaUsoInterno natureza="LEVANTAMENTO_INTERNO" />

      <BarraFiltros idCampanha={idCampanha} opcoes={opcoes} />

      {!carregandoOpcoes && opcoes.uf.length === 0 ? (
        <p className="rounded-[var(--raio)] border border-[hsl(var(--borda))] bg-[hsl(var(--superficie))] px-3 py-2 text-sm text-[hsl(var(--texto-fraco))]">
          As tabelas de referência do IBGE ainda não foram carregadas neste ambiente, então o filtro
          por UF e município está sem opções. Rode <code>pnpm ibge:sincronizar</code> na API.
        </p>
      ) : null}

      {erro ? (
        <EstadoErro
          mensagem={erro.corpo.mensagem}
          idCorrelacao={erro.corpo.idCorrelacao}
          semConexao={erro.semConexao}
          aoTentarNovamente={recarregar}
        />
      ) : carregando && !resumo ? (
        <EstadoCarregando mensagem="Calculando o recorte…" linhas={4} />
      ) : !resumo || resumo.eleitoresMapeados === 0 ? (
        <EstadoVazio
          filtrado
          descricao="Nenhum eleitor mapeado neste recorte. Ajuste os filtros ou registre entrevistas em campo."
        />
      ) : (
        <>
          <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <CartaoIndicador
              rotulo="Eleitores mapeados"
              valor={resumo.eleitoresMapeados}
              unidade="pessoas"
            />
            <CartaoIndicador rotulo="Domicílios visitados" valor={resumo.domiciliosVisitados} />
            <CartaoIndicador rotulo="Entrevistas concluídas" valor={resumo.entrevistasConcluidas} />
            <CartaoIndicador
              rotulo="Cobertura do recorte"
              valor={
                resumo.eleitoradoDoRecorte > 0 ? formatarPercentual(resumo.coberturaAmostral) : '—'
              }
              detalhe={
                resumo.eleitoradoDoRecorte > 0
                  ? `${resumo.eleitoresMapeados} de ${resumo.eleitoradoDoRecorte} eleitores`
                  : 'Selecione seção, zona ou município para calcular'
              }
              advertencia={
                resumo.eleitoradoDoRecorte > 0 && resumo.coberturaAmostral < 0.15
                  ? 'Cobertura baixa. Trate os números como indicação, não como previsão.'
                  : null
              }
            />
          </section>

          <section className="grafico evitar-quebra rounded-[var(--raio)] border border-[hsl(var(--borda))] bg-[hsl(var(--superficie))] p-4">
            <h2 className="text-sm font-medium text-[hsl(var(--texto))]">
              Classificação dos eleitores mapeados
            </h2>

            {/*
              Faixas na ordem fixa da entidade, com vão de 2px entre elas: a
              separação sobrevive à impressão em preto e branco. A identidade
              está na legenda com ícone e rótulo, nunca só na cor.
            */}
            <div className="mt-3 flex h-8 w-full gap-0.5 overflow-hidden rounded">
              {ORDEM_CLASSIFICACAO.map((chave) => {
                const total =
                  resumo.porClassificacao.find((i) => i.classificacao === chave)?.total ?? 0;
                if (total === 0) return null;
                return (
                  <div
                    key={chave}
                    title={`${chave}: ${total}`}
                    style={{
                      width: `${(total / totalClassificado) * 100}%`,
                      backgroundColor: corDaClassificacao(chave),
                    }}
                  />
                );
              })}
            </div>

            <ul className="mt-3 flex flex-wrap gap-x-4 gap-y-2">
              {ORDEM_CLASSIFICACAO.map((chave) => {
                const total =
                  resumo.porClassificacao.find((i) => i.classificacao === chave)?.total ?? 0;
                return (
                  <li key={chave} className="flex items-center gap-2 text-sm">
                    <EtiquetaClassificacao classificacao={chave} />
                    <span className="text-[hsl(var(--texto))]" data-numerico>
                      {total}
                    </span>
                    <span className="text-[hsl(var(--texto-fraco))]" data-numerico>
                      {totalClassificado > 0
                        ? formatarPercentual(total / totalClassificado, 0)
                        : '—'}
                    </span>
                  </li>
                );
              })}
            </ul>
          </section>

          <section className="grafico evitar-quebra rounded-[var(--raio)] border border-[hsl(var(--borda))] bg-[hsl(var(--superficie))] p-4">
            <h2 className="text-sm font-medium text-[hsl(var(--texto))]">Entrevistas por dia</h2>
            <div className="mt-3">
              <GraficoTendencia dados={resumo.entrevistasPorDia} rotulo="entrevistas" />
            </div>
          </section>
        </>
      )}
    </div>
  );
}

export default function PaginaPainel(): JSX.Element {
  return (
    <main className="mx-auto flex max-w-6xl flex-col gap-4 px-4 py-6">
      {/* `useSearchParams` exige fronteira de Suspense na renderização estática. */}
      <Suspense fallback={<EstadoCarregando mensagem="Carregando painel…" />}>
        <ConteudoPainel />
      </Suspense>
    </main>
  );
}
