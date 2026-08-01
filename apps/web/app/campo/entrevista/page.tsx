'use client';

import { FormularioEntrevista } from '@/componentes/campo/FormularioEntrevista';
import { IndicadorFilaOffline } from '@/componentes/IndicadorFilaOffline';

/**
 * Tela de entrevista em campo.
 *
 * Por enquanto os dados do domicílio, dos cargos e do termo de consentimento
 * estão fixos: as telas de seleção de território e a carga de cargos por
 * campanha ainda não existem. O que está exercitado de ponta a ponta é o
 * caminho crítico — preencher, consentir, salvar na fila local e sincronizar.
 */

const CARGOS_DEMONSTRACAO = [
  { id: '00000000-0000-4000-8000-000000000006', nome: 'Deputado Federal', quantidadeVotosPermitida: 1 },
  { id: '00000000-0000-4000-8000-000000000005', nome: 'Senador', quantidadeVotosPermitida: 2 },
  { id: '00000000-0000-4000-8000-000000000003', nome: 'Governador', quantidadeVotosPermitida: 1 },
];

const TEXTO_CONSENTIMENTO =
  'Autorizo o registro das informações que forneci, incluindo minha preferência ' +
  'eleitoral, para uso exclusivo no planejamento desta campanha. Fui informado de ' +
  'que posso consultar, corrigir ou pedir a exclusão dos meus dados a qualquer ' +
  'momento, e de que eles não serão compartilhados com terceiros nem divulgados ' +
  'publicamente.';

export default function PaginaEntrevista(): JSX.Element {
  return (
    <main className="mx-auto flex min-h-dvh max-w-2xl flex-col gap-4 px-4 py-6">
      <header>
        <h1 className="text-xl font-semibold text-[hsl(var(--texto))]">Nova entrevista</h1>
      </header>

      <IndicadorFilaOffline />

      <FormularioEntrevista
        idCampanha="00000000-0000-4000-8000-000000000001"
        idDomicilio="00000000-0000-4000-8000-000000000002"
        enderecoResumido="Rua São José, 42 — Centro"
        cargos={CARGOS_DEMONSTRACAO}
        idVersaoConsentimento="00000000-0000-4000-8000-000000000010"
        textoConsentimento={TEXTO_CONSENTIMENTO}
      />
    </main>
  );
}
