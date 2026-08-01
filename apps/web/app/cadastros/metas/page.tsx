'use client';

import { useEffect, useState } from 'react';
import {
  AvisoNaoSubstitui,
  BarraAcoes,
  Botao,
  EstadoCarregando,
  EstadoErro,
  EstadoVazio,
} from '@jeleitoral/ui';
import {
  NivelTerritorial,
  RotuloNivelTerritorial,
  TipoMeta,
  type NivelTerritorial as Nivel,
  type TipoMeta as Tipo,
} from '@jeleitoral/tipos';
import { formatarPercentual } from '@jeleitoral/utilitarios';
import { Campo, classeControle } from '@/componentes/cadastro/Campo';
import { Tabela } from '@/componentes/cadastro/Tabela';
import { ErroDaApi, api } from '@/lib/api';
import { useListagem } from '@/lib/useListagem';
import { useSessao } from '@/lib/useSessao';

interface Meta {
  id: string;
  nivel: string;
  idReferencia: string;
  tipo: string;
  valor: number;
  realizado?: number;
  percentualAtingido?: number;
  situacao?: string;
}

interface Candidato {
  id: string;
  nome_urna: string;
  proprio: boolean;
  cargo: string;
}

interface Cargo {
  id: string;
  nome: string;
}

export default function PaginaMetas(): JSX.Element {
  const { idCampanha, carregando: carregandoSessao } = useSessao();

  const [candidatos, definirCandidatos] = useState<Candidato[]>([]);
  const [cargos, definirCargos] = useState<Cargo[]>([]);
  const [idCandidato, definirIdCandidato] = useState('');
  const [aberto, definirAberto] = useState(false);
  const [salvando, definirSalvando] = useState(false);
  const [erroSalvar, definirErroSalvar] = useState<string | null>(null);

  const { dados, carregando, erro, recarregar } = useListagem<Meta[]>(
    idCampanha && idCandidato
      ? `/metas?idCampanha=${idCampanha}&idCandidato=${idCandidato}`
      : null,
  );

  useEffect(() => {
    if (!idCampanha) return;
    void Promise.all([
      api.obter<Candidato[]>(`/candidatos?idCampanha=${idCampanha}`).catch(() => []),
      api.obter<Cargo[]>('/candidatos/cargos').catch(() => []),
    ]).then(([lista, listaCargos]) => {
      definirCandidatos(lista);
      definirCargos(listaCargos);
      // Metas só existem para candidato próprio; pré-selecionar o primeiro evita
      // uma tela vazia que parece defeito.
      const proprio = lista.find((candidato) => candidato.proprio) ?? lista[0];
      if (proprio) definirIdCandidato(proprio.id);
    });
  }, [idCampanha]);

  async function salvar(evento: React.FormEvent<HTMLFormElement>): Promise<void> {
    evento.preventDefault();
    if (!idCampanha || !idCandidato) return;
    const formulario = new FormData(evento.currentTarget);

    definirSalvando(true);
    definirErroSalvar(null);
    try {
      await api.enviar('/metas', {
        idCampanha,
        idCandidato,
        idCargo: String(formulario.get('idCargo')),
        tipo: String(formulario.get('tipo')),
        valor: Number(formulario.get('valor')),
        nivel: String(formulario.get('nivel')),
        idReferencia: String(formulario.get('idReferencia')).trim(),
        prazo: String(formulario.get('prazo')) || undefined,
      });
      definirAberto(false);
      recarregar();
    } catch (falha) {
      definirErroSalvar(
        falha instanceof ErroDaApi ? falha.corpo.mensagem : 'Não foi possível salvar.',
      );
    } finally {
      definirSalvando(false);
    }
  }

  async function distribuir(meta: Meta): Promise<void> {
    // Desce a meta um nível: de município para bairro, de bairro para seção.
    // A API rateia proporcionalmente ao eleitorado de cada destino.
    const ordem = NivelTerritorial.options;
    const posicao = ordem.indexOf(meta.nivel as Nivel);
    const destino = posicao > 0 ? ordem[posicao - 1] : null;
    if (!destino) return;
    await api.enviar('/metas/distribuir', { idMeta: meta.id, nivelDestino: destino });
    recarregar();
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
      <BarraAcoes
        titulo="Metas"
        subtitulo={dados ? `${dados.length} meta(s)` : undefined}
        atualizar={{ aoAcionar: recarregar, carregando }}
        novo={{
          aoAcionar: () => definirAberto(true),
          rotulo: 'Nova meta',
          desabilitado: !idCandidato,
        }}
        imprimir={{}}
      />

      <AvisoNaoSubstitui contexto="juridico" />

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

      {aberto ? (
        <form
          onSubmit={(evento) => void salvar(evento)}
          className="grid gap-3 rounded-[var(--raio)] border border-[hsl(var(--borda))] bg-[hsl(var(--superficie))] p-4 sm:grid-cols-2"
        >
          <Campo id="idCargo" rotulo="Cargo" obrigatorio>
            <select id="idCargo" name="idCargo" required className={classeControle}>
              {cargos.map((cargo) => (
                <option key={cargo.id} value={cargo.id}>
                  {cargo.nome}
                </option>
              ))}
            </select>
          </Campo>

          <Campo id="tipo" rotulo="Tipo" obrigatorio>
            <select id="tipo" name="tipo" required className={classeControle}>
              {TipoMeta.options.map((valor: Tipo) => (
                <option key={valor} value={valor}>
                  {valor === 'VOTOS_ABSOLUTOS' ? 'Votos absolutos' : 'Percentual do eleitorado'}
                </option>
              ))}
            </select>
          </Campo>

          <Campo id="nivel" rotulo="Nível territorial" obrigatorio>
            <select id="nivel" name="nivel" required className={classeControle}>
              {NivelTerritorial.options.map((valor: Nivel) => (
                <option key={valor} value={valor}>
                  {RotuloNivelTerritorial[valor]}
                </option>
              ))}
            </select>
          </Campo>

          <Campo
            id="idReferencia"
            rotulo="Referência do território"
            obrigatorio
            dica="Código IBGE do município, ou identificador do bairro/seção."
          >
            <input id="idReferencia" name="idReferencia" required className={classeControle} />
          </Campo>

          <Campo id="valor" rotulo="Valor" obrigatorio>
            <input
              id="valor"
              name="valor"
              type="number"
              step="0.01"
              min="0.01"
              required
              className={classeControle}
            />
          </Campo>

          <Campo id="prazo" rotulo="Prazo">
            <input id="prazo" name="prazo" type="date" className={classeControle} />
          </Campo>

          {erroSalvar ? (
            <p role="alert" className="text-sm text-[hsl(var(--perigo))] sm:col-span-2">
              {erroSalvar}
            </p>
          ) : null}

          <div className="flex gap-2 sm:col-span-2">
            <Botao type="submit" carregando={salvando}>
              Salvar meta
            </Botao>
            <Botao type="button" variante="sutil" onClick={() => definirAberto(false)}>
              Cancelar
            </Botao>
          </div>
        </form>
      ) : null}

      {!idCandidato ? (
        <EstadoVazio
          titulo="Selecione um candidato"
          descricao="As metas são definidas por candidato e por território."
        />
      ) : erro ? (
        <EstadoErro
          mensagem={erro.corpo.mensagem}
          idCorrelacao={erro.corpo.idCorrelacao}
          semConexao={erro.semConexao}
          aoTentarNovamente={recarregar}
        />
      ) : carregando && !dados ? (
        <EstadoCarregando mensagem="Carregando metas…" linhas={3} />
      ) : !dados || dados.length === 0 ? (
        <EstadoVazio
          titulo="Nenhuma meta definida"
          descricao="Defina a meta no nível mais alto e use “Distribuir” para ratear por território."
        />
      ) : (
        <Tabela
          linhas={dados}
          chaveDe={(linha) => linha.id}
          colunas={[
            {
              chave: 'nivel',
              rotulo: 'Nível',
              render: (linha) =>
                RotuloNivelTerritorial[linha.nivel as Nivel] ?? linha.nivel,
            },
            { chave: 'referencia', rotulo: 'Território', render: (linha) => linha.idReferencia },
            {
              chave: 'valor',
              rotulo: 'Meta',
              numerico: true,
              render: (linha) =>
                linha.tipo === 'PERCENTUAL'
                  ? formatarPercentual(linha.valor / 100)
                  : linha.valor.toLocaleString('pt-BR'),
            },
            {
              chave: 'realizado',
              rotulo: 'Realizado',
              numerico: true,
              render: (linha) => linha.realizado?.toLocaleString('pt-BR') ?? '—',
            },
            {
              chave: 'atingido',
              rotulo: 'Atingido',
              numerico: true,
              render: (linha) =>
                linha.percentualAtingido === undefined
                  ? '—'
                  : formatarPercentual(linha.percentualAtingido, 0),
            },
            {
              chave: 'acoes',
              rotulo: 'Ações',
              render: (linha) =>
                linha.nivel === 'SECAO' ? (
                  <span className="text-xs text-[hsl(var(--texto-fraco))]">nível mínimo</span>
                ) : (
                  <Botao
                    variante="sutil"
                    tamanho="pequeno"
                    onClick={() => void distribuir(linha)}
                  >
                    Distribuir
                  </Botao>
                ),
            },
          ]}
        />
      )}
    </main>
  );
}
