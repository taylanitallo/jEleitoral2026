'use client';

import { ShieldAlert } from 'lucide-react';
import type { NaturezaLevantamento } from '@jeleitoral/tipos';
import { cn } from '../utilitarios/cn';

/**
 * Tarja de uso interno.
 *
 * Pesquisa de opinião destinada ao conhecimento público exige registro prévio
 * no PesqEle até 5 dias antes da divulgação (Lei 9.504/97, art. 33;
 * Res.-TSE 23.600/2019). Divulgar sem registro sujeita a multa — e o TSE já
 * penalizou inclusive quem apenas replicou pesquisa não registrada.
 *
 * Por isso, todo relatório de `LEVANTAMENTO_INTERNO` carrega esta tarja na
 * tela, no PDF e na impressão. Ela não é decorativa: é o aviso que separa o
 * uso legítimo do ilícito.
 */
export function TarjaUsoInterno({
  natureza,
  className,
}: {
  natureza: NaturezaLevantamento;
  className?: string;
}): JSX.Element | null {
  if (natureza !== 'LEVANTAMENTO_INTERNO') return null;
  return (
    <div
      role="note"
      className={cn(
        'tarja-uso-interno flex items-start gap-2 rounded-[var(--raio)] border-2 border-[hsl(var(--atencao))] bg-[hsl(var(--atencao-sutil))] px-3 py-2',
        className,
      )}
    >
      <ShieldAlert className="mt-0.5 size-4 shrink-0 text-[hsl(var(--atencao))]" aria-hidden="true" />
      <div className="text-sm">
        <p className="font-semibold uppercase tracking-wide text-[hsl(var(--atencao))]">
          Uso interno — vedada a divulgação pública
        </p>
        <p className="mt-0.5 text-[hsl(var(--texto-secundario))]">
          Este é um levantamento interno de campanha, sem registro no PesqEle. Divulgá-lo
          publicamente, inclusive em redes sociais, pode configurar infração ao art. 33 da Lei
          9.504/97.
        </p>
      </div>
    </div>
  );
}

/**
 * Aviso permanente de que o sistema não substitui assessoria jurídica
 * eleitoral nem prestação de contas oficial. Fica no rodapé das áreas
 * sensíveis (levantamentos e financeiro).
 */
export function AvisoNaoSubstitui({ contexto }: { contexto: 'juridico' | 'financeiro' }): JSX.Element {
  return (
    <p className="text-xs text-[hsl(var(--texto-fraco))]">
      {contexto === 'juridico'
        ? 'O jEleitoral é ferramenta de gestão e não substitui assessoria jurídica eleitoral. Consulte seu advogado antes de divulgar qualquer número.'
        : 'Este módulo é de controle gerencial interno e não substitui a prestação de contas oficial à Justiça Eleitoral. Use a exportação com código TSE para conciliação pelo contador.'}
    </p>
  );
}
