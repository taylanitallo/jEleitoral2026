import { CloudOff } from 'lucide-react';

/**
 * Tela servida pelo service worker quando a rede falha e a rota pedida não está
 * em cache.
 *
 * O que ela precisa fazer é uma coisa só: impedir que o entrevistador conclua
 * que perdeu o trabalho. Quem vê a tela de erro do navegador em campo supõe o
 * pior, e o custo desse susto é alguém refazendo entrevista que já estava
 * salva — ou desistindo de usar o sistema.
 */
export const metadata = { title: 'Sem conexão — jEleitoral' };

export default function PaginaOffline(): JSX.Element {
  return (
    <main className="mx-auto grid min-h-[70dvh] max-w-md place-items-center px-6 text-center">
      <div className="flex flex-col items-center gap-4">
        <CloudOff
          className="size-12 text-[hsl(var(--texto-fraco))]"
          aria-hidden="true"
          strokeWidth={1.5}
        />

        <h1 className="text-xl font-semibold text-[hsl(var(--texto))]">Sem conexão</h1>

        <p className="text-[hsl(var(--texto-secundario))]">
          As entrevistas já salvas neste aparelho <strong>estão guardadas</strong> e sobem sozinhas
          assim que o sinal voltar. Você pode continuar entrevistando normalmente.
        </p>

        <p className="text-sm text-[hsl(var(--texto-fraco))]">
          Se esta é a primeira vez que abre o aplicativo neste aparelho, conecte-se uma vez à
          internet — depois disso ele passa a funcionar offline.
        </p>
      </div>
    </main>
  );
}
