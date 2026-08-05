'use client';

import Link from 'next/link';
import { Botao, EstadoCarregando, EstadoErro, EstadoVazio, cn } from '@jeleitoral/ui';
import { ErroDaApi, api } from '@/lib/api';
import { useListagem } from '@/lib/useListagem';
import { useSessao } from '@/lib/useSessao';

interface Alerta {
  id: string;
  tipo: string;
  gravidade: number;
  detalhe: { mensagem?: string } | null;
  criado_em: string;
  id_entrevista: string;
  entrevistador: string;
}

const ROTULO_TIPO: Record<string, string> = {
  DURACAO_CURTA: 'Duração curta',
  GPS_DISTANTE: 'GPS distante do endereço',
  VOLUME_IMPROVAVEL: 'Volume improvável na hora',
  DUPLICIDADE_SUSPEITA: 'Duplicidade suspeita',
  SEM_GEOLOCALIZACAO: 'Sem geolocalização',
  FORA_DO_TERRITORIO: 'Fora do território designado',
};

const CLASSE_GRAVIDADE: Record<number, string> = {
  3: 'border-l-4 border-[hsl(var(--perigo))]',
  2: 'border-l-4 border-[hsl(var(--atencao))]',
  1: 'border-l-4 border-[hsl(var(--borda))]',
};

/**
 * Fila de qualidade da coleta. Existia a listagem (`GET /campo/qualidade/
 * alertas`) sem tela nenhuma para lê-la, e as colunas `revisado_por`/
 * `revisado_em`/`procedente` — desenhadas desde a 0007 — sem ninguém jamais
 * as preencher. Esta tela fecha as duas pontas.
 */
export default function PaginaQualidade(): JSX.Element {
  const { idCampanha, carregando: carregandoSessao } = useSessao();
  const { dados, carregando, erro, recarregar } = useListagem<Alerta[]>(
    idCampanha ? `/campo/qualidade/alertas?idCampanha=${idCampanha}` : null,
  );

  async function revisar(id: string, procedente: boolean): Promise<void> {
    try {
      await api.enviar(`/campo/qualidade/alertas/${id}/revisar`, { procedente });
      recarregar();
    } catch (falha) {
      // Erro pontual num item não deveria travar a fila inteira — o
      // coordenador vê o alerta continuar ali e tenta de novo.
      if (!(falha instanceof ErroDaApi)) throw falha;
    }
  }

  if (carregandoSessao) return <EstadoCarregando />;

  if (!idCampanha) {
    return (
      <main className="mx-auto max-w-3xl px-4 py-6">
        <p role="alert" className="text-sm text-[hsl(var(--perigo))]">
          Seu acesso não está vinculado a nenhuma campanha.
        </p>
      </main>
    );
  }

  return (
    <main className="mx-auto flex max-w-3xl flex-col gap-4 px-4 py-6">
      <header>
        <h1 className="text-xl font-semibold text-[hsl(var(--texto))]">Qualidade da coleta</h1>
        <p className="text-sm text-[hsl(var(--texto-secundario))]">
          Alertas automáticos pendentes de revisão, do mais grave para o mais recente.
        </p>
      </header>

      {erro ? (
        <EstadoErro
          mensagem={erro.corpo.mensagem}
          idCorrelacao={erro.corpo.idCorrelacao}
          semConexao={erro.semConexao}
          aoTentarNovamente={recarregar}
        />
      ) : carregando ? (
        <EstadoCarregando mensagem="Carregando alertas…" linhas={4} />
      ) : (dados ?? []).length === 0 ? (
        <EstadoVazio
          titulo="Nenhum alerta pendente"
          descricao="Toda a coleta recente está dentro dos parâmetros esperados."
        />
      ) : (
        <ul className="flex flex-col gap-2">
          {(dados ?? []).map((alerta) => (
            <li
              key={alerta.id}
              className={cn(
                'flex flex-col gap-2 rounded-[var(--raio)] bg-[hsl(var(--superficie))] p-3 sm:flex-row sm:items-center sm:justify-between',
                CLASSE_GRAVIDADE[alerta.gravidade] ?? CLASSE_GRAVIDADE[1],
              )}
            >
              <div>
                <p className="text-sm font-medium text-[hsl(var(--texto))]">
                  {ROTULO_TIPO[alerta.tipo] ?? alerta.tipo}
                </p>
                <p className="text-xs text-[hsl(var(--texto-secundario))]">
                  {alerta.detalhe?.mensagem ?? '—'}
                </p>
                <p className="text-xs text-[hsl(var(--texto-fraco))]">
                  {alerta.entrevistador} · {new Date(alerta.criado_em).toLocaleString('pt-BR')}
                </p>
              </div>

              <div className="flex items-center gap-2">
                <Link
                  href={`/campo/entrevistas/${alerta.id_entrevista}`}
                  className="text-xs text-[hsl(var(--acento))] hover:underline"
                >
                  Ver entrevista
                </Link>
                <Botao
                  variante="sutil"
                  tamanho="pequeno"
                  onClick={() => void revisar(alerta.id, true)}
                >
                  Procedente
                </Botao>
                <Botao
                  variante="sutil"
                  tamanho="pequeno"
                  onClick={() => void revisar(alerta.id, false)}
                >
                  Improcedente
                </Botao>
              </div>
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
