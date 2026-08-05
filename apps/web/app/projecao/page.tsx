'use client';

import { useEffect, useState } from 'react';
import {
  AvisoNaoSubstitui,
  BarraAcoes,
  Botao,
  EstadoCarregando,
  EstadoErro,
  EstadoVazio,
  TarjaUsoInterno,
} from '@jeleitoral/ui';
import {
  NivelTerritorial,
  RotuloMetodoProjecao,
  RotuloNivelTerritorial,
  type MetodoProjecao,
  type NivelTerritorial as Nivel,
} from '@jeleitoral/tipos';
import { formatarPercentual } from '@jeleitoral/utilitarios';
import { Campo, classeControle } from '@/componentes/cadastro/Campo';
import { Tabela } from '@/componentes/cadastro/Tabela';
import { api, ErroDaApi } from '@/lib/api';
import { useListagem } from '@/lib/useListagem';
import { useSessao } from '@/lib/useSessao';

interface Projecao {
  nivel: string;
  id_referencia: string;
  votos_projetados: number;
  intervalo_min: number;
  intervalo_max: number;
  indice_confianca: number;
  cobertura_amostral: number;
  eleitorado_base: number;
  amostra_tamanho: number;
  metodo: MetodoProjecao;
  calculado_em: string;
}

interface Candidato {
  id: string;
  nome_urna: string;
  proprio: boolean;
  cargo: string;
}

/**
 * Projeção de votos.
 *
 * Todo número aqui vem acompanhado do intervalo e da cobertura que o produziram.
 * Um voto projetado sem a cobertura ao lado é um número que vira promessa na
 * reunião seguinte — e a cobertura é justamente o que diz se ele merece crédito.
 */
export default function PaginaProjecao(): JSX.Element {
  const { idCampanha, carregando: carregandoSessao } = useSessao();

  const [candidatos, definirCandidatos] = useState<Candidato[]>([]);
  const [idCandidato, definirIdCandidato] = useState('');
  const [nivel, definirNivel] = useState<Nivel | ''>('');
  const [recalculando, definirRecalculando] = useState(false);
  const [erroRecalculo, definirErroRecalculo] = useState<string | null>(null);

  const { dados, carregando, erro, recarregar } = useListagem<Projecao[]>(
    idCampanha && idCandidato
      ? `/projecao?idCampanha=${idCampanha}&idCandidato=${idCandidato}${
          nivel ? `&nivel=${nivel}` : ''
        }`
      : null,
  );

  useEffect(() => {
    if (!idCampanha) return;
    void api
      .obter<Candidato[]>(`/candidatos?idCampanha=${idCampanha}`)
      .then((lista) => {
        definirCandidatos(lista);
        const proprio = lista.find((candidato) => candidato.proprio) ?? lista[0];
        if (proprio) definirIdCandidato(proprio.id);
      })
      .catch(() => definirCandidatos([]));
  }, [idCampanha]);

  /**
   * Recalcula a chapa inteira. É esta rota que alimenta `projecoes_diarias`
   * — sem alguém acionando isto todo dia, o gráfico de tendência da Fase 6
   * nasce sem série. Até existir agendador externo, é este botão.
   */
  async function recalcular(): Promise<void> {
    if (!idCampanha) return;
    definirRecalculando(true);
    definirErroRecalculo(null);
    try {
      await api.enviar('/projecao/recalcular', { idCampanha });
      recarregar();
    } catch (falha) {
      definirErroRecalculo(
        falha instanceof ErroDaApi
          ? falha.corpo.mensagem
          : 'Não foi possível recalcular a projeção.',
      );
    } finally {
      definirRecalculando(false);
    }
  }

  const ultimaAtualizacao =
    dados && dados.length > 0
      ? dados.reduce(
          (maisRecente, linha) =>
            linha.calculado_em > maisRecente ? linha.calculado_em : maisRecente,
          dados[0]!.calculado_em,
        )
      : null;

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
      <BarraAcoes
        titulo="Projeção de votos"
        subtitulo={dados ? `${dados.length} território(s)` : undefined}
        atualizar={{ aoAcionar: recarregar, carregando }}
        imprimir={{}}
      />

      <TarjaUsoInterno natureza="LEVANTAMENTO_INTERNO" />
      <AvisoNaoSubstitui contexto="juridico" />

      <div
        data-imprimir="ocultar"
        className="flex flex-wrap items-center justify-between gap-2 rounded-[var(--raio)] border border-[hsl(var(--borda))] bg-[hsl(var(--superficie))] p-3"
      >
        <p className="text-xs text-[hsl(var(--texto-secundario))]">
          {ultimaAtualizacao
            ? `Última atualização: ${new Date(ultimaAtualizacao).toLocaleString('pt-BR')}`
            : 'Ainda não recalculada.'}
        </p>
        <Botao
          variante="sutil"
          tamanho="pequeno"
          onClick={() => void recalcular()}
          carregando={recalculando}
        >
          Recalcular chapa
        </Botao>
      </div>

      {erroRecalculo ? (
        <p role="alert" className="text-sm text-[hsl(var(--perigo))]">
          {erroRecalculo}
        </p>
      ) : null}

      <div className="grid gap-3 sm:grid-cols-2">
        <Campo id="candidato" rotulo="Candidato">
          <select
            id="candidato"
            value={idCandidato}
            onChange={(evento) => definirIdCandidato(evento.target.value)}
            className={classeControle}
          >
            <option value="">Selecione…</option>
            {candidatos.map((candidato) => (
              <option key={candidato.id} value={candidato.id}>
                {candidato.nome_urna} — {candidato.cargo}
              </option>
            ))}
          </select>
        </Campo>

        <Campo id="nivel" rotulo="Nível territorial">
          <select
            id="nivel"
            value={nivel}
            onChange={(evento) => definirNivel(evento.target.value as Nivel | '')}
            className={classeControle}
          >
            <option value="">Todos</option>
            {NivelTerritorial.options.map((valor: Nivel) => (
              <option key={valor} value={valor}>
                {RotuloNivelTerritorial[valor]}
              </option>
            ))}
          </select>
        </Campo>
      </div>

      {!idCandidato ? (
        <EstadoVazio titulo="Selecione um candidato" />
      ) : erro ? (
        <EstadoErro
          mensagem={erro.corpo.mensagem}
          idCorrelacao={erro.corpo.idCorrelacao}
          semConexao={erro.semConexao}
          aoTentarNovamente={recarregar}
        />
      ) : carregando && !dados ? (
        <EstadoCarregando mensagem="Carregando projeções…" linhas={4} />
      ) : !dados || dados.length === 0 ? (
        <EstadoVazio
          titulo="Nenhuma projeção calculada"
          descricao="A projeção é recalculada por seção conforme as entrevistas chegam do campo."
        />
      ) : (
        <Tabela
          linhas={dados}
          chaveDe={(linha) => `${linha.nivel}:${linha.id_referencia}`}
          colunas={[
            {
              chave: 'nivel',
              rotulo: 'Nível',
              render: (linha) => RotuloNivelTerritorial[linha.nivel as Nivel] ?? linha.nivel,
            },
            { chave: 'territorio', rotulo: 'Território', render: (linha) => linha.id_referencia },
            {
              chave: 'votos',
              rotulo: 'Votos projetados',
              numerico: true,
              render: (linha) => linha.votos_projetados.toLocaleString('pt-BR'),
            },
            {
              chave: 'intervalo',
              rotulo: 'Intervalo',
              numerico: true,
              render: (linha) =>
                `${linha.intervalo_min.toLocaleString('pt-BR')} – ${linha.intervalo_max.toLocaleString('pt-BR')}`,
            },
            {
              chave: 'cobertura',
              rotulo: 'Cobertura',
              numerico: true,
              render: (linha) => (
                <span
                  title={
                    linha.cobertura_amostral < 0.15
                      ? 'Abaixo de 15%: trate como indicação, não como previsão.'
                      : undefined
                  }
                >
                  {formatarPercentual(linha.cobertura_amostral, 0)}
                  {linha.cobertura_amostral < 0.15 ? ' ⚠' : ''}
                </span>
              ),
            },
            {
              chave: 'amostra',
              rotulo: 'Amostra',
              numerico: true,
              render: (linha) =>
                `${linha.amostra_tamanho.toLocaleString('pt-BR')} / ${linha.eleitorado_base.toLocaleString('pt-BR')}`,
            },
            {
              chave: 'metodo',
              rotulo: 'Método',
              render: (linha) => RotuloMetodoProjecao[linha.metodo] ?? linha.metodo,
            },
          ]}
        />
      )}
    </main>
  );
}
