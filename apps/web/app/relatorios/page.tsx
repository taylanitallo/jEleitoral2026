'use client';

import { useState } from 'react';
import { BarraAcoes, Botao, EstadoCarregando, EstadoVazio, TarjaUsoInterno } from '@jeleitoral/ui';
import {
  FormatoExportacao,
  NaturezaLevantamento,
  RotuloNaturezaLevantamento,
  type FormatoExportacao as Formato,
  type NaturezaLevantamento as Natureza,
} from '@jeleitoral/tipos';
import { Campo, classeControle } from '@/componentes/cadastro/Campo';
import { useSessao } from '@/lib/useSessao';

/**
 * A lista é fechada de propósito. O usuário escolhe um relatório e um recorte —
 * nunca escreve a consulta. Consulta livre sobre uma base de intenção de voto é
 * um vazamento esperando acontecer.
 */
const RELATORIOS = [
  {
    chave: 'mapeamento_por_bairro',
    titulo: 'Mapeamento por bairro',
    descricao: 'Domicílios, entrevistados e apoiadores por bairro do recorte.',
  },
  {
    chave: 'produtividade_por_entrevistador',
    titulo: 'Produtividade por entrevistador',
    descricao: 'Volume e qualidade da coleta por pessoa da equipe.',
  },
  {
    chave: 'lista_para_mobilizacao',
    titulo: 'Lista para mobilização',
    descricao: 'Contatos classificados para acionamento no dia da eleição.',
  },
] as const;

export default function PaginaRelatorios(): JSX.Element {
  const { idCampanha, carregando: carregandoSessao } = useSessao();
  const [gerando, definirGerando] = useState<string | null>(null);
  const [aviso, definirAviso] = useState<string | null>(null);
  const [formato, definirFormato] = useState<Formato>('PDF');
  const [natureza, definirNatureza] = useState<Natureza>('LEVANTAMENTO_INTERNO');

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
          filtro: { idCampanha },
          filtrosPorExtenso: [],
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
    return (
      <main className="mx-auto max-w-6xl px-4 py-6">
        <EstadoVazio titulo="Nenhuma campanha vinculada" />
      </main>
    );
  }

  return (
    <main className="mx-auto flex max-w-6xl flex-col gap-4 px-4 py-6">
      <BarraAcoes titulo="Relatórios" subtitulo="Exportação com cabeçalho e marca d'água" />

      <TarjaUsoInterno natureza={natureza} />

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

      <ul className="grid gap-3 sm:grid-cols-2">
        {RELATORIOS.map((relatorio) => (
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

      <p className="text-xs text-[hsl(var(--texto-fraco))]">
        Todo arquivo exportado sai com marca d&apos;água pessoal e fica registrado na auditoria.
        Exportações grandes são enfileiradas e avisadas quando prontas.
      </p>
    </main>
  );
}
