'use client';

import { CloudOff, CloudUpload, TriangleAlert } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import { Botao, cn } from '@jeleitoral/ui';
import type { EntradaEntrevista, ResultadoItemSincronizacao } from '@jeleitoral/tipos';
import { api } from '@/lib/api';
import { filaOffline, type ResumoFila } from '@/lib/filaOffline';

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

  const enviarLote = useCallback(
    async (idCampanha: string, entrevistas: EntradaEntrevista[]) => {
      const resposta = await api.enviar<{ resultados: ResultadoItemSincronizacao[] }>(
        '/campo/sincronizar',
        { idCampanha, entrevistas },
      );
      return resposta.resultados;
    },
    [],
  );

  const sincronizar = useCallback(async () => {
    if (!navigator.onLine) {
      definirResumo(await filaOffline.resumir());
      return;
    }
    definirSincronizando(true);
    try {
      const atualizado = await filaOffline.sincronizar(enviarLote);
      await filaOffline.limparEnviados();
      definirResumo(atualizado);
    } finally {
      definirSincronizando(false);
    }
  }, [enviarLote]);

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
        className,
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
  );
}
