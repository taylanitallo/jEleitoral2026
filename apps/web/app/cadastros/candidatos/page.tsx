'use client';

import { useEffect, useState } from 'react';
import {
  BarraAcoes,
  Botao,
  EstadoCarregando,
  EstadoErro,
  EstadoVazio,
} from '@jeleitoral/ui';
import { Campo, classeControle } from '@/componentes/cadastro/Campo';
import { Tabela } from '@/componentes/cadastro/Tabela';
import { ErroDaApi, api } from '@/lib/api';
import { useListagem } from '@/lib/useListagem';
import { useSessao } from '@/lib/useSessao';

interface Candidato {
  id: string;
  nome_urna: string;
  numero_urna: string;
  proprio: boolean;
  origem: string;
  situacao: string | null;
  sigla_partido: string | null;
  cargo: string;
}

interface Cargo {
  id: string;
  nome: string;
}

interface Partido {
  id: string;
  numero: number;
  sigla: string;
  nome: string;
}

export default function PaginaCandidatos(): JSX.Element {
  const { idCampanha, carregando: carregandoSessao } = useSessao();
  const { dados, carregando, erro, recarregar } = useListagem<Candidato[]>(
    idCampanha ? `/candidatos?idCampanha=${idCampanha}` : null,
  );

  const [cargos, definirCargos] = useState<Cargo[]>([]);
  const [partidos, definirPartidos] = useState<Partido[]>([]);
  const [aberto, definirAberto] = useState(false);
  const [salvando, definirSalvando] = useState(false);
  const [erroSalvar, definirErroSalvar] = useState<string | null>(null);

  useEffect(() => {
    void Promise.all([
      api.obter<Cargo[]>('/candidatos/cargos').catch(() => []),
      api.obter<Partido[]>('/candidatos/partidos').catch(() => []),
    ]).then(([listaCargos, listaPartidos]) => {
      definirCargos(listaCargos);
      definirPartidos(listaPartidos);
    });
  }, []);

  async function salvar(evento: React.FormEvent<HTMLFormElement>): Promise<void> {
    evento.preventDefault();
    if (!idCampanha) return;
    const formulario = new FormData(evento.currentTarget);

    definirSalvando(true);
    definirErroSalvar(null);
    try {
      await api.enviar('/candidatos', {
        idCampanha,
        idCargo: String(formulario.get('idCargo')),
        nomeCompleto: String(formulario.get('nomeCompleto')).trim(),
        nomeUrna: String(formulario.get('nomeUrna')).trim(),
        numeroUrna: String(formulario.get('numeroUrna')).trim(),
        idPartido: String(formulario.get('idPartido')) || undefined,
        uf: String(formulario.get('uf')).trim().toUpperCase() || undefined,
        // "Próprio" separa o candidato da campanha dos adversários mapeados.
        // A projeção e as metas só valem para os próprios.
        proprio: formulario.get('proprio') === 'on',
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

  if (carregandoSessao) return <EstadoCarregando mensagem="Carregando…" linhas={3} />;

  if (!idCampanha) {
    return (
      <main className="mx-auto max-w-6xl px-4 py-6">
        <EstadoVazio
          titulo="Nenhuma campanha vinculada"
          descricao="Cadastre uma campanha antes de registrar candidatos."
        />
      </main>
    );
  }

  return (
    <main className="mx-auto flex max-w-6xl flex-col gap-4 px-4 py-6">
      <BarraAcoes
        titulo="Candidatos"
        subtitulo={dados ? `${dados.length} na campanha` : undefined}
        atualizar={{ aoAcionar: recarregar, carregando }}
        novo={{ aoAcionar: () => definirAberto(true), rotulo: 'Novo candidato' }}
        imprimir={{}}
      />

      {aberto ? (
        <form
          onSubmit={(evento) => void salvar(evento)}
          className="grid gap-3 rounded-[var(--raio)] border border-[hsl(var(--borda))] bg-[hsl(var(--superficie))] p-4 sm:grid-cols-2"
        >
          <Campo id="nomeCompleto" rotulo="Nome completo" obrigatorio>
            <input
              id="nomeCompleto"
              name="nomeCompleto"
              required
              minLength={5}
              maxLength={150}
              className={classeControle}
            />
          </Campo>

          <Campo id="nomeUrna" rotulo="Nome de urna" obrigatorio>
            <input
              id="nomeUrna"
              name="nomeUrna"
              required
              minLength={2}
              maxLength={60}
              className={classeControle}
            />
          </Campo>

          <Campo
            id="numeroUrna"
            rotulo="Número de urna"
            obrigatorio
            dica="De 2 a 5 dígitos, conforme o cargo."
          >
            <input
              id="numeroUrna"
              name="numeroUrna"
              required
              inputMode="numeric"
              pattern="\d{2,5}"
              className={classeControle}
            />
          </Campo>

          <Campo id="idCargo" rotulo="Cargo" obrigatorio>
            <select id="idCargo" name="idCargo" required className={classeControle}>
              <option value="">Selecione…</option>
              {cargos.map((cargo) => (
                <option key={cargo.id} value={cargo.id}>
                  {cargo.nome}
                </option>
              ))}
            </select>
          </Campo>

          <Campo id="idPartido" rotulo="Partido">
            <select id="idPartido" name="idPartido" className={classeControle}>
              <option value="">—</option>
              {partidos.map((partido) => (
                <option key={partido.id} value={partido.id}>
                  {partido.numero} · {partido.sigla}
                </option>
              ))}
            </select>
          </Campo>

          <Campo id="uf" rotulo="UF" dica="Apenas para cargos estaduais.">
            <input id="uf" name="uf" maxLength={2} className={classeControle} />
          </Campo>

          <label className="flex items-center gap-2 text-sm text-[hsl(var(--texto))] sm:col-span-2">
            <input type="checkbox" name="proprio" className="size-4" />
            É candidato próprio desta campanha
          </label>

          {erroSalvar ? (
            <p role="alert" className="text-sm text-[hsl(var(--perigo))] sm:col-span-2">
              {erroSalvar}
            </p>
          ) : null}

          <div className="flex gap-2 sm:col-span-2">
            <Botao type="submit" carregando={salvando}>
              Cadastrar
            </Botao>
            <Botao type="button" variante="sutil" onClick={() => definirAberto(false)}>
              Cancelar
            </Botao>
          </div>
        </form>
      ) : null}

      {erro ? (
        <EstadoErro
          mensagem={erro.corpo.mensagem}
          idCorrelacao={erro.corpo.idCorrelacao}
          semConexao={erro.semConexao}
          aoTentarNovamente={recarregar}
        />
      ) : carregando && !dados ? (
        <EstadoCarregando mensagem="Carregando candidatos…" linhas={3} />
      ) : !dados || dados.length === 0 ? (
        <EstadoVazio
          titulo="Nenhum candidato cadastrado"
          descricao="Cadastre ao menos o candidato próprio: metas e projeção dependem dele."
        />
      ) : (
        <Tabela
          linhas={dados}
          chaveDe={(linha) => linha.id}
          colunas={[
            {
              chave: 'nome',
              rotulo: 'Nome de urna',
              render: (linha) => (
                <span className="flex items-center gap-2">
                  {linha.nome_urna}
                  {linha.proprio ? (
                    <span className="rounded bg-[hsl(var(--acento-sutil))] px-1.5 py-0.5 text-xs text-[hsl(var(--acento))]">
                      próprio
                    </span>
                  ) : null}
                </span>
              ),
            },
            {
              chave: 'numero',
              rotulo: 'Número',
              numerico: true,
              render: (linha) => linha.numero_urna,
            },
            { chave: 'cargo', rotulo: 'Cargo', render: (linha) => linha.cargo },
            { chave: 'partido', rotulo: 'Partido', render: (linha) => linha.sigla_partido ?? '—' },
            { chave: 'origem', rotulo: 'Origem', render: (linha) => linha.origem },
            { chave: 'situacao', rotulo: 'Situação', render: (linha) => linha.situacao ?? '—' },
          ]}
        />
      )}
    </main>
  );
}
