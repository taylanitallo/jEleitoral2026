'use client';

import {
  Download,
  FileSpreadsheet,
  FileText,
  Filter,
  Pencil,
  Plus,
  Printer,
  RefreshCw,
  Trash2,
} from 'lucide-react';
import { cn } from '../utilitarios/cn';
import { Botao } from './Botao';

/**
 * Ação da barra. `aoAcionar` ausente ou `desabilitado` verdadeiro mantém o
 * botão visível porém inerte — some da tela só o que o perfil do usuário não
 * tem permissão para fazer, via `visivel`.
 */
export interface AcaoBarra {
  aoAcionar?: () => void;
  desabilitado?: boolean;
  carregando?: boolean;
  visivel?: boolean;
  rotulo?: string;
  /** Sobrescreve a dica exibida no `title`/`aria-label`. */
  dica?: string;
}

export interface PropriedadesBarraAcoes {
  titulo?: string;
  subtitulo?: React.ReactNode;
  novo?: AcaoBarra;
  editar?: AcaoBarra;
  excluir?: AcaoBarra;
  exportarPdf?: AcaoBarra;
  exportarExcel?: AcaoBarra;
  imprimir?: AcaoBarra;
  filtrar?: AcaoBarra;
  atualizar?: AcaoBarra;
  /** Quantidade de filtros ativos, exibida como contador no botão de filtro. */
  filtrosAtivos?: number;
  /** Ações específicas da tela, renderizadas antes das padrão. */
  acoesExtras?: React.ReactNode;
  className?: string;
}

const VISIVEL_POR_PADRAO = (acao?: AcaoBarra): boolean => Boolean(acao) && acao?.visivel !== false;

/**
 * Barra de ações padrão de todas as telas de listagem e dashboard.
 *
 * Padroniza posição, ordem e rótulo das operações — o operador aprende uma vez
 * e a interface inteira se comporta igual. Sai da impressão por
 * `data-imprimir="ocultar"`.
 *
 * A exclusão aqui apenas **dispara** a intenção; quem confirma é o
 * `ModalConfirmacao`. Esta barra nunca exclui nada sozinha.
 */
export function BarraAcoes({
  titulo,
  subtitulo,
  novo,
  editar,
  excluir,
  exportarPdf,
  exportarExcel,
  imprimir,
  filtrar,
  atualizar,
  filtrosAtivos = 0,
  acoesExtras,
  className,
}: PropriedadesBarraAcoes): JSX.Element {
  return (
    <div
      data-imprimir="ocultar"
      className={cn(
        'barra-acoes flex flex-wrap items-center justify-between gap-3 border-b border-[hsl(var(--borda))] pb-3',
        className,
      )}
    >
      {titulo ? (
        <div className="min-w-0">
          <h1 className="truncate text-lg font-semibold text-[hsl(var(--texto))]">{titulo}</h1>
          {subtitulo ? (
            <p className="mt-0.5 truncate text-sm text-[hsl(var(--texto-secundario))]">{subtitulo}</p>
          ) : null}
        </div>
      ) : (
        <span />
      )}

      <div className="flex flex-wrap items-center gap-1.5">
        {acoesExtras}

        {VISIVEL_POR_PADRAO(atualizar) ? (
          <Botao
            variante="sutil"
            tamanho="icone"
            onClick={atualizar?.aoAcionar}
            disabled={atualizar?.desabilitado}
            carregando={atualizar?.carregando}
            title={atualizar?.dica ?? 'Atualizar'}
            aria-label={atualizar?.dica ?? 'Atualizar'}
          >
            {atualizar?.carregando ? null : <RefreshCw />}
          </Botao>
        ) : null}

        {VISIVEL_POR_PADRAO(filtrar) ? (
          <Botao
            variante="secundario"
            onClick={filtrar?.aoAcionar}
            disabled={filtrar?.desabilitado}
            title={filtrar?.dica ?? 'Filtrar'}
          >
            <Filter />
            {filtrar?.rotulo ?? 'Filtrar'}
            {filtrosAtivos > 0 ? (
              <span
                className="ml-0.5 rounded-full bg-[hsl(var(--acento))] px-1.5 text-xs font-semibold text-[hsl(var(--acento-contraste))]"
                aria-label={`${filtrosAtivos} filtros ativos`}
              >
                {filtrosAtivos}
              </span>
            ) : null}
          </Botao>
        ) : null}

        {VISIVEL_POR_PADRAO(imprimir) ? (
          <Botao
            variante="sutil"
            tamanho="icone"
            onClick={imprimir?.aoAcionar ?? (() => window.print())}
            disabled={imprimir?.desabilitado}
            title={imprimir?.dica ?? 'Imprimir'}
            aria-label={imprimir?.dica ?? 'Imprimir'}
          >
            <Printer />
          </Botao>
        ) : null}

        {VISIVEL_POR_PADRAO(exportarPdf) ? (
          <Botao
            variante="secundario"
            onClick={exportarPdf?.aoAcionar}
            disabled={exportarPdf?.desabilitado}
            carregando={exportarPdf?.carregando}
            title={exportarPdf?.dica ?? 'Exportar em PDF'}
          >
            <FileText />
            {exportarPdf?.rotulo ?? 'PDF'}
          </Botao>
        ) : null}

        {VISIVEL_POR_PADRAO(exportarExcel) ? (
          <Botao
            variante="secundario"
            onClick={exportarExcel?.aoAcionar}
            disabled={exportarExcel?.desabilitado}
            carregando={exportarExcel?.carregando}
            title={exportarExcel?.dica ?? 'Exportar em Excel'}
          >
            <FileSpreadsheet />
            {exportarExcel?.rotulo ?? 'Excel'}
          </Botao>
        ) : null}

        {VISIVEL_POR_PADRAO(excluir) ? (
          <Botao
            variante="contorno_perigo"
            onClick={excluir?.aoAcionar}
            disabled={excluir?.desabilitado}
            title={excluir?.dica ?? 'Excluir'}
          >
            <Trash2 />
            {excluir?.rotulo ?? 'Excluir'}
          </Botao>
        ) : null}

        {VISIVEL_POR_PADRAO(editar) ? (
          <Botao
            variante="secundario"
            onClick={editar?.aoAcionar}
            disabled={editar?.desabilitado}
            title={editar?.dica ?? 'Editar'}
          >
            <Pencil />
            {editar?.rotulo ?? 'Editar'}
          </Botao>
        ) : null}

        {VISIVEL_POR_PADRAO(novo) ? (
          <Botao
            variante="primario"
            onClick={novo?.aoAcionar}
            disabled={novo?.desabilitado}
            carregando={novo?.carregando}
            title={novo?.dica ?? 'Novo registro'}
          >
            <Plus />
            {novo?.rotulo ?? 'Novo'}
          </Botao>
        ) : null}
      </div>
    </div>
  );
}

/** Ícone de download reexportado para telas que montam ações extras. */
export { Download as IconeDownload };
