'use client';

import { CloudOff, CloudUpload, TriangleAlert } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import { Botao, cn } from '@jeleitoral/ui';
import { enviarLoteEntrevistas } from '@/lib/enviarLoteEntrevistas';
import { filaOffline, type ItemFila, type ResumoFila } from '@/lib/filaOffline';

/**
 * Indicador permanente do estado da fila offline.
 *
 * Fica visível em toda a área de campo. O entrevistador precisa saber, o tempo
 * todo, se o trabalho dele já subiu — a alternativa é ele descobrir no fim do
 * dia que perdeu tudo, e não descobrir é pior ainda.
 *
 * A sincronização é disparada por três gatilhos: ao montar, ao voltar a
 * conexão (`online`) e a cada dois minutos. A trava de reentrância da própria
 * fila garante que os três não se atropelem.
 */
export function IndicadorFilaOffline({ className }: { className?: string }): JSX.Element | null {
  const [resumo, definirResumo] = useState<ResumoFila | null>(null);
  const [online, definirOnline] = useState(true);
  const [sincronizando, definirSincronizando] = useState(false);
  const [mostrarAtencao, definirMostrarAtencao] = useState(false);
  const [itensAtencao, definirItensAtencao] = useState<ItemFila[]>([]);
  const [reenviando, definirReenviando] = useState<string | null>(null);

  const sincronizar = useCallback(async () => {
    if (!navigator.onLine) {
      definirResumo(await filaOffline.resumir());
      return;
    }
    definirSincronizando(true);
    try {
      const atualizado = await filaOffline.sincronizar(enviarLoteEntrevistas);
      await filaOffline.limparEnviados();
      definirResumo(atualizado);
    } finally {
      definirSincronizando(false);
    }
  }, []);

  /**
   * Reenvia um item recusado, sem alterar o conteúdo.
   *
   * `filaOffline.reenviar()` estava implementado desde a fila offline original
   * e nunca era chamado por UI nenhuma — item recusado (`ATENCAO`) ficava
   * preso no aparelho para sempre, visível só como um número na contagem, sem
   * caminho de volta. Reenviar sem edição cobre o caso mais comum: a recusa
   * era passageira (rede caiu no meio, servidor fora por um instante) e o
   * mesmo conteúdo passa da segunda vez.
   */
  async function tentarNovamente(item: ItemFila): Promise<void> {
    definirReenviando(item.idLocalOffline);
    try {
      await filaOffline.reenviar(item.idLocalOffline, item.entrevista);
      await sincronizar();
      definirItensAtencao(await filaOffline.listar('ATENCAO'));
    } finally {
      definirReenviando(null);
    }
  }

  useEffect(() => {
    if (!mostrarAtencao) return;
    void filaOffline.listar('ATENCAO').then(definirItensAtencao);
  }, [mostrarAtencao, resumo?.atencao]);

  useEffect(() => {
    definirOnline(navigator.onLine);
    void sincronizar();

    const aoConectar = (): void => {
      definirOnline(true);
      void sincronizar();
    };
    const aoDesconectar = (): void => definirOnline(false);

    window.addEventListener('online', aoConectar);
    window.addEventListener('offline', aoDesconectar);
    const temporizador = window.setInterval(() => void sincronizar(), 120_000);

    return () => {
      window.removeEventListener('online', aoConectar);
      window.removeEventListener('offline', aoDesconectar);
      window.clearInterval(temporizador);
    };
  }, [sincronizar]);

  // Nada pendente e conexão boa: não ocupa espaço na tela.
  if (!resumo || (resumo.total === 0 && online)) return null;

  const temAtencao = resumo.atencao > 0;

  return (
    <div className={cn('flex flex-col gap-2', className)}>
      <div
        role="status"
        aria-live="polite"
        className={cn(
          'flex items-center gap-2 rounded-[var(--raio)] border px-3 py-2 text-sm',
          temAtencao
            ? 'border-[hsl(var(--atencao)/0.4)] bg-[hsl(var(--atencao-sutil))] text-[hsl(var(--atencao))]'
            : online
              ? 'border-[hsl(var(--informacao)/0.3)] bg-[hsl(var(--informacao-sutil))] text-[hsl(var(--informacao))]'
              : 'border-[hsl(var(--borda))] bg-[hsl(var(--fundo-sutil))] text-[hsl(var(--texto-secundario))]',
        )}
      >
        {temAtencao ? (
          <TriangleAlert className="size-4 shrink-0" aria-hidden="true" />
        ) : online ? (
          <CloudUpload className="size-4 shrink-0" aria-hidden="true" />
        ) : (
          <CloudOff className="size-4 shrink-0" aria-hidden="true" />
        )}

        <span className="min-w-0 flex-1">
          {temAtencao ? (
            <>
              <strong>{resumo.atencao}</strong>{' '}
              {resumo.atencao === 1 ? 'entrevista precisa' : 'entrevistas precisam'} de correção.
            </>
          ) : !online ? (
            <>
              Sem conexão. <strong>{resumo.pendentes}</strong>{' '}
              {resumo.pendentes === 1 ? 'entrevista salva' : 'entrevistas salvas'} no aparelho —
              sobem sozinhas quando o sinal voltar.
            </>
          ) : (
            <>
              Enviando <strong>{resumo.pendentes}</strong>{' '}
              {resumo.pendentes === 1 ? 'entrevista' : 'entrevistas'}…
            </>
          )}
        </span>

        {temAtencao ? (
          <Botao
            variante="sutil"
            tamanho="pequeno"
            onClick={() => definirMostrarAtencao((v) => !v)}
          >
            {mostrarAtencao ? 'Ocultar' : 'Ver'}
          </Botao>
        ) : null}

        {online && resumo.pendentes > 0 ? (
          <Botao
            variante="sutil"
            tamanho="pequeno"
            onClick={() => void sincronizar()}
            carregando={sincronizando}
          >
            Enviar agora
          </Botao>
        ) : null}
      </div>

      {mostrarAtencao && temAtencao ? (
        <ul className="flex flex-col gap-1.5 rounded-[var(--raio)] border border-[hsl(var(--atencao)/0.4)] bg-[hsl(var(--superficie))] p-2">
          {itensAtencao.map((item) => (
            <li
              key={item.idLocalOffline}
              className="flex items-center justify-between gap-2 rounded-[var(--raio)] bg-[hsl(var(--fundo-sutil))] px-2 py-1.5 text-xs"
            >
              <span className="min-w-0 flex-1 truncate text-[hsl(var(--texto-secundario))]">
                {item.motivo ?? 'O servidor recusou este item.'}
              </span>
              <Botao
                variante="sutil"
                tamanho="pequeno"
                onClick={() => void tentarNovamente(item)}
                carregando={reenviando === item.idLocalOffline}
              >
                Tentar de novo
              </Botao>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
