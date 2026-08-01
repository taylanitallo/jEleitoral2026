'use client';

import * as Dialog from '@radix-ui/react-dialog';
import { AlertTriangle } from 'lucide-react';
import { useEffect, useId, useState } from 'react';
import { cn } from '../utilitarios/cn';
import { Botao } from './Botao';

export interface PropriedadesModalConfirmacao {
  aberto: boolean;
  aoMudarAbertura: (aberto: boolean) => void;
  titulo: string;
  descricao: React.ReactNode;
  /** Texto do botão de confirmação. Prefira o verbo da ação: "Excluir". */
  rotuloConfirmar?: string;
  rotuloCancelar?: string;
  destrutivo?: boolean;
  /**
   * Quando informado, o usuário precisa digitar exatamente este texto para
   * habilitar a confirmação. Obrigatório em exclusões de alto impacto — apagar
   * uma campanha inteira não pode acontecer por clique acidental.
   */
  textoDeConfirmacao?: string;
  /** Consequência da ação, exibida em destaque. Ex.: "1.243 entrevistas serão apagadas." */
  consequencia?: React.ReactNode;
  aoConfirmar: () => void | Promise<void>;
}

/**
 * Modal de confirmação único do sistema.
 *
 * Regra do projeto: **todo** ícone ou ação de exclusão passa por aqui, sem
 * exceção. Não existe `onClick={excluir}` direto em lugar nenhum — quem
 * escrever isso quebra a revisão de código.
 */
export function ModalConfirmacao({
  aberto,
  aoMudarAbertura,
  titulo,
  descricao,
  rotuloConfirmar = 'Confirmar',
  rotuloCancelar = 'Cancelar',
  destrutivo = true,
  textoDeConfirmacao,
  consequencia,
  aoConfirmar,
}: PropriedadesModalConfirmacao): JSX.Element {
  const [digitado, definirDigitado] = useState('');
  const [processando, definirProcessando] = useState(false);
  const idCampo = useId();

  // Limpa o campo ao reabrir: senão o texto digitado numa exclusão anterior
  // deixaria a próxima já confirmada.
  useEffect(() => {
    if (aberto) definirDigitado('');
  }, [aberto]);

  const exigeDigitacao = Boolean(textoDeConfirmacao);
  const podeConfirmar =
    !processando && (!exigeDigitacao || digitado.trim() === textoDeConfirmacao?.trim());

  async function confirmar(): Promise<void> {
    if (!podeConfirmar) return;
    definirProcessando(true);
    try {
      await aoConfirmar();
      aoMudarAbertura(false);
    } finally {
      definirProcessando(false);
    }
  }

  return (
    <Dialog.Root open={aberto} onOpenChange={aoMudarAbertura}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-black/50 backdrop-blur-[2px]" />
        <Dialog.Content
          className={cn(
            'fixed left-1/2 top-1/2 z-50 w-[min(32rem,calc(100vw-2rem))] -translate-x-1/2 -translate-y-1/2',
            'rounded-[var(--raio)] border border-[hsl(var(--borda))] bg-[hsl(var(--superficie-elevada))] p-5 shadow-[var(--sombra-media)]',
          )}
        >
          <div className="flex gap-3">
            <span
              className={cn(
                'mt-0.5 flex size-9 shrink-0 items-center justify-center rounded-full',
                destrutivo
                  ? 'bg-[hsl(var(--perigo-sutil))] text-[hsl(var(--perigo))]'
                  : 'bg-[hsl(var(--informacao-sutil))] text-[hsl(var(--informacao))]',
              )}
              aria-hidden="true"
            >
              <AlertTriangle className="size-4.5" />
            </span>

            <div className="min-w-0 flex-1">
              <Dialog.Title className="text-base font-semibold text-[hsl(var(--texto))]">
                {titulo}
              </Dialog.Title>
              <Dialog.Description className="mt-1 text-sm text-[hsl(var(--texto-secundario))]">
                {descricao}
              </Dialog.Description>

              {consequencia ? (
                <p className="mt-3 rounded-[var(--raio)] bg-[hsl(var(--perigo-sutil))] px-3 py-2 text-sm font-medium text-[hsl(var(--perigo))]">
                  {consequencia}
                </p>
              ) : null}

              {exigeDigitacao ? (
                <div className="mt-4">
                  <label htmlFor={idCampo} className="block text-sm text-[hsl(var(--texto-secundario))]">
                    Para confirmar, digite{' '}
                    <code className="rounded bg-[hsl(var(--fundo-sutil))] px-1 py-0.5 font-mono text-[hsl(var(--texto))]">
                      {textoDeConfirmacao}
                    </code>
                  </label>
                  <input
                    id={idCampo}
                    value={digitado}
                    onChange={(evento) => definirDigitado(evento.target.value)}
                    autoComplete="off"
                    className="mt-1.5 h-9 w-full rounded-[var(--raio)] border border-[hsl(var(--borda))] bg-[hsl(var(--superficie))] px-3 text-sm text-[hsl(var(--texto))]"
                  />
                </div>
              ) : null}
            </div>
          </div>

          <div className="mt-5 flex justify-end gap-2">
            <Dialog.Close asChild>
              <Botao variante="secundario" disabled={processando}>
                {rotuloCancelar}
              </Botao>
            </Dialog.Close>
            <Botao
              variante={destrutivo ? 'perigo' : 'primario'}
              onClick={() => void confirmar()}
              disabled={!podeConfirmar}
              carregando={processando}
            >
              {rotuloConfirmar}
            </Botao>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

/**
 * Estado auxiliar para o padrão mais comum: uma lista onde cada linha tem um
 * ícone de excluir. Evita replicar `useState` em toda tela.
 */
export function useConfirmacao<T>(): {
  alvo: T | null;
  aberto: boolean;
  solicitar: (alvo: T) => void;
  fechar: () => void;
} {
  const [alvo, definirAlvo] = useState<T | null>(null);
  return {
    alvo,
    aberto: alvo !== null,
    solicitar: definirAlvo,
    fechar: () => definirAlvo(null),
  };
}
