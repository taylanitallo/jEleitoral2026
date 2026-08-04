'use client';

import { CalendarPlus, MapPin, Users } from 'lucide-react';
import { useState } from 'react';
import { Botao, EstadoCarregando, EstadoVazio, cn } from '@jeleitoral/ui';
import {
  RotuloStatusAtividade,
  RotuloTipoAtividade,
  StatusAtividade,
  TipoAtividade,
  type PaginaDe,
} from '@jeleitoral/tipos';
import { Campo, classeControle } from '@/componentes/cadastro/Campo';
import { RevisarComIa } from '@/componentes/ia/RevisarComIa';
import { ErroDaApi, api } from '@/lib/api';
import { useListagem } from '@/lib/useListagem';
import { useSessao } from '@/lib/useSessao';

interface Atividade {
  id: string;
  tipo: TipoAtividade;
  status: StatusAtividade;
  titulo: string;
  inicio_em: string;
  fim_em: string | null;
  local_descricao: string | null;
  bairro: string | null;
  comite: string | null;
  responsavel: string;
  total_participantes: number;
  total_presentes: number;
}

const CORES_STATUS: Record<StatusAtividade, string> = {
  PLANEJADA: 'bg-[hsl(var(--nao-informou-sutil))] text-[hsl(var(--nao-informou))]',
  CONFIRMADA: 'bg-[hsl(var(--informacao-sutil))] text-[hsl(var(--informacao))]',
  REALIZADA: 'bg-[hsl(var(--sucesso-sutil))] text-[hsl(var(--sucesso))]',
  CANCELADA: 'bg-[hsl(var(--perigo-sutil))] text-[hsl(var(--perigo))]',
  ADIADA: 'bg-[hsl(var(--atencao-sutil))] text-[hsl(var(--atencao))]',
};

/** Data local no formato que o `datetime-local` do navegador aceita. */
function agoraLocal(): string {
  const agora = new Date();
  agora.setMinutes(agora.getMinutes() - agora.getTimezoneOffset());
  return agora.toISOString().slice(0, 16);
}

/**
 * Agenda da campanha.
 *
 * Lista agrupada por dia, e não um calendário de grade. O coordenador municipal
 * abre isto no celular entre um compromisso e outro: o que ele precisa é "o que
 * tem hoje e amanhã", em ordem, com endereço legível. Grade mensal é bonita na
 * tela grande e inútil na rua — e traria uma biblioteca de calendário inteira
 * para dentro do pacote só para isso.
 */
export default function PaginaAgenda(): JSX.Element {
  const { idCampanha, carregando: carregandoSessao } = useSessao();

  const [aberto, definirAberto] = useState(false);
  const [titulo, definirTitulo] = useState('');
  const [tipo, definirTipo] = useState<TipoAtividade>('REUNIAO_EQUIPE');
  const [inicioEm, definirInicioEm] = useState(agoraLocal());
  const [local, definirLocal] = useState('');
  const [roteiro, definirRoteiro] = useState('');
  const [salvando, definirSalvando] = useState(false);
  const [erroFormulario, definirErroFormulario] = useState<string | null>(null);

  const { dados, carregando, erro, recarregar } = useListagem<PaginaDe<Atividade>>(
    idCampanha ? `/agenda?idCampanha=${idCampanha}` : null,
  );

  async function criar(evento: React.FormEvent): Promise<void> {
    evento.preventDefault();
    definirSalvando(true);
    definirErroFormulario(null);
    try {
      await api.enviar('/agenda', {
        idCampanha,
        tipo,
        titulo,
        // `datetime-local` devolve hora sem fuso; o `new Date` interpreta como
        // local e o `toISOString` grava em UTC, que é o que a coluna espera.
        inicioEm: new Date(inicioEm).toISOString(),
        localDescricao: local || undefined,
        roteiro: roteiro || undefined,
      });
      definirTitulo('');
      definirLocal('');
      definirRoteiro('');
      definirAberto(false);
      recarregar();
    } catch (falha) {
      definirErroFormulario(
        falha instanceof ErroDaApi ? falha.message : 'Não foi possível criar a atividade.',
      );
    } finally {
      definirSalvando(false);
    }
  }

  async function marcarRealizada(atividade: Atividade): Promise<void> {
    await api.atualizar(`/agenda/${atividade.id}/fechamento`, { status: 'REALIZADA' });
    recarregar();
  }

  if (carregandoSessao) return <EstadoCarregando />;

  if (!idCampanha) {
    return (
      <main className="mx-auto max-w-4xl px-4 py-6">
        <p role="alert" className="text-sm text-[hsl(var(--perigo))]">
          Seu acesso não está vinculado a nenhuma campanha.
        </p>
      </main>
    );
  }

  // Agrupa por dia preservando a ordem que a API já devolveu.
  const porDia = new Map<string, Atividade[]>();
  for (const atividade of dados?.itens ?? []) {
    const dia = new Date(atividade.inicio_em).toLocaleDateString('pt-BR', {
      weekday: 'long',
      day: '2-digit',
      month: 'long',
    });
    porDia.set(dia, [...(porDia.get(dia) ?? []), atividade]);
  }

  return (
    <main className="mx-auto flex max-w-4xl flex-col gap-4 px-4 py-6">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold text-[hsl(var(--texto))]">Agenda</h1>
          <p className="text-sm text-[hsl(var(--texto-secundario))]">
            Reuniões, encontros com o candidato, visitas e capacitações.
          </p>
        </div>
        <Botao onClick={() => definirAberto((valor) => !valor)}>
          <CalendarPlus className="size-4" aria-hidden="true" />
          Nova atividade
        </Botao>
      </header>

      {aberto ? (
        <form
          onSubmit={(evento) => void criar(evento)}
          className="grid gap-3 rounded-[var(--raio)] border border-[hsl(var(--borda))] p-4 sm:grid-cols-2"
        >
          <Campo id="titulo" rotulo="Título" obrigatorio>
            <input
              id="titulo"
              className={classeControle}
              value={titulo}
              onChange={(e) => definirTitulo(e.target.value)}
              required
              minLength={3}
            />
          </Campo>

          <Campo id="tipo" rotulo="Tipo" obrigatorio>
            <select
              id="tipo"
              className={classeControle}
              value={tipo}
              onChange={(e) => definirTipo(e.target.value as TipoAtividade)}
            >
              {TipoAtividade.options.map((opcao) => (
                <option key={opcao} value={opcao}>
                  {RotuloTipoAtividade[opcao]}
                </option>
              ))}
            </select>
          </Campo>

          <Campo id="inicio" rotulo="Quando" obrigatorio>
            <input
              id="inicio"
              type="datetime-local"
              className={classeControle}
              value={inicioEm}
              onChange={(e) => definirInicioEm(e.target.value)}
              required
            />
          </Campo>

          <Campo id="local" rotulo="Local">
            <input
              id="local"
              className={classeControle}
              value={local}
              onChange={(e) => definirLocal(e.target.value)}
              placeholder="Praça da Matriz, Centro"
            />
          </Campo>

          <div className="sm:col-span-2">
            <Campo
              id="roteiro"
              rotulo="Pauta ou roteiro"
              dica="Na capacitação, o conteúdo. No encontro, a pauta."
            >
              <textarea
                id="roteiro"
                className={cn(classeControle, 'min-h-24')}
                value={roteiro}
                onChange={(e) => definirRoteiro(e.target.value)}
              />
            </Campo>
            <RevisarComIa
              idCampanha={idCampanha}
              texto={roteiro}
              aoAplicar={definirRoteiro}
              className="mt-2"
            />
          </div>

          {erroFormulario ? (
            <p role="alert" className="text-sm text-[hsl(var(--perigo))] sm:col-span-2">
              {erroFormulario}
            </p>
          ) : null}

          <div className="flex gap-2 sm:col-span-2">
            <Botao type="submit" carregando={salvando}>
              Agendar
            </Botao>
            <Botao variante="sutil" onClick={() => definirAberto(false)}>
              Cancelar
            </Botao>
          </div>
        </form>
      ) : null}

      {carregando ? (
        <EstadoCarregando />
      ) : erro ? (
        <p role="alert" className="text-sm text-[hsl(var(--perigo))]">
          {erro.message}
        </p>
      ) : porDia.size === 0 ? (
        <EstadoVazio
          titulo="Agenda vazia"
          descricao="Cadastre a próxima reunião, visita ou capacitação para a equipe saber onde estar."
        />
      ) : (
        [...porDia.entries()].map(([dia, atividades]) => (
          <section key={dia} className="flex flex-col gap-2">
            <h2 className="text-sm font-medium capitalize text-[hsl(var(--texto-secundario))]">
              {dia}
            </h2>
            {atividades.map((atividade) => (
              <article
                key={atividade.id}
                className="flex flex-wrap items-start gap-3 rounded-[var(--raio)] border border-[hsl(var(--borda))] p-3"
              >
                <time
                  dateTime={atividade.inicio_em}
                  className="font-mono text-sm text-[hsl(var(--texto))]"
                >
                  {new Date(atividade.inicio_em).toLocaleTimeString('pt-BR', {
                    hour: '2-digit',
                    minute: '2-digit',
                  })}
                </time>

                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-medium text-[hsl(var(--texto))]">{atividade.titulo}</span>
                    <span
                      className={cn(
                        'rounded-full px-2 py-0.5 text-xs',
                        CORES_STATUS[atividade.status],
                      )}
                    >
                      {RotuloStatusAtividade[atividade.status]}
                    </span>
                  </div>

                  <p className="text-xs text-[hsl(var(--texto-fraco))]">
                    {RotuloTipoAtividade[atividade.tipo]} · {atividade.responsavel}
                  </p>

                  <div className="mt-1 flex flex-wrap gap-3 text-xs text-[hsl(var(--texto-secundario))]">
                    {atividade.local_descricao || atividade.bairro ? (
                      <span className="flex items-center gap-1">
                        <MapPin className="size-3" aria-hidden="true" />
                        {atividade.local_descricao ?? atividade.bairro}
                      </span>
                    ) : null}
                    {atividade.total_participantes > 0 ? (
                      <span className="flex items-center gap-1">
                        <Users className="size-3" aria-hidden="true" />
                        {atividade.status === 'REALIZADA'
                          ? `${atividade.total_presentes} de ${atividade.total_participantes} presentes`
                          : `${atividade.total_participantes} convocados`}
                      </span>
                    ) : null}
                  </div>
                </div>

                {atividade.status !== 'REALIZADA' && atividade.status !== 'CANCELADA' ? (
                  <Botao
                    variante="sutil"
                    tamanho="pequeno"
                    onClick={() => void marcarRealizada(atividade)}
                  >
                    Marcar realizada
                  </Botao>
                ) : null}
              </article>
            ))}
          </section>
        ))
      )}
    </main>
  );
}
