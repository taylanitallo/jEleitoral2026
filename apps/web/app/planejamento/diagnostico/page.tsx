'use client';

import { ClipboardList, Plus } from 'lucide-react';
import { useState } from 'react';
import { Botao, EstadoCarregando, EstadoVazio, cn } from '@jeleitoral/ui';
import {
  OrigemProblema,
  RotuloOrigemProblema,
  RotuloStatusDiagnostico,
  RotuloTemaProblema,
  StatusDiagnostico,
  TemaProblema,
} from '@jeleitoral/tipos';
import { Campo, classeControle } from '@/componentes/cadastro/Campo';
import { GraficoTemas, type TemaAgregado } from '@/componentes/diagnostico/GraficoTemas';
import { ErroDaApi, api } from '@/lib/api';
import { useListagem } from '@/lib/useListagem';
import { useSessao } from '@/lib/useSessao';

interface Diagnostico {
  id: string;
  titulo: string;
  status: StatusDiagnostico;
  area: string | null;
  responsavel: string | null;
  total_problemas: number;
}

interface Problema {
  id: string;
  tema: TemaProblema;
  tema_livre: string | null;
  titulo: string;
  gravidade: number;
  frequencia_relatos: number;
  origem: OrigemProblema;
  bairro: string | null;
}

/** Lista e registro de problemas de um diagnóstico. */
function Problemas({ idDiagnostico, aoMudar }: { idDiagnostico: string; aoMudar: () => void }) {
  const { dados, carregando, recarregar } = useListagem<Problema[]>(
    `/diagnostico/${idDiagnostico}/problemas`,
  );

  const [aberto, definirAberto] = useState(false);
  const [tema, definirTema] = useState<TemaProblema>('SAUDE');
  const [titulo, definirTitulo] = useState('');
  const [gravidade, definirGravidade] = useState('3');
  const [relatos, definirRelatos] = useState('1');
  const [origem, definirOrigem] = useState<OrigemProblema>('REUNIAO');
  const [salvando, definirSalvando] = useState(false);
  const [erro, definirErro] = useState<string | null>(null);

  async function registrar(evento: React.FormEvent): Promise<void> {
    evento.preventDefault();
    definirSalvando(true);
    definirErro(null);
    try {
      await api.enviar(`/diagnostico/${idDiagnostico}/problemas`, {
        tema,
        titulo,
        gravidade: Number(gravidade),
        frequenciaRelatos: Number(relatos),
        origem,
      });
      definirTitulo('');
      definirRelatos('1');
      definirAberto(false);
      recarregar();
      aoMudar();
    } catch (falha) {
      definirErro(falha instanceof ErroDaApi ? falha.message : 'Não foi possível registrar.');
    } finally {
      definirSalvando(false);
    }
  }

  return (
    <div className="mt-3 border-t border-[hsl(var(--borda))] pt-3">
      <div className="mb-2 flex items-center justify-between">
        <h3 className="text-sm font-medium text-[hsl(var(--texto))]">Problemas levantados</h3>
        <Botao variante="sutil" tamanho="pequeno" onClick={() => definirAberto((v) => !v)}>
          <Plus className="size-3.5" aria-hidden="true" />
          Registrar
        </Botao>
      </div>

      {aberto ? (
        <form
          onSubmit={(evento) => void registrar(evento)}
          className="mb-3 grid gap-3 rounded-[var(--raio)] bg-[hsl(var(--fundo-sutil))] p-3 sm:grid-cols-2"
        >
          <Campo id="tema" rotulo="Tema" obrigatorio>
            <select
              id="tema"
              className={classeControle}
              value={tema}
              onChange={(e) => definirTema(e.target.value as TemaProblema)}
            >
              {TemaProblema.options.map((opcao) => (
                <option key={opcao} value={opcao}>
                  {RotuloTemaProblema[opcao]}
                </option>
              ))}
            </select>
          </Campo>

          <Campo id="origem" rotulo="Como se soube">
            <select
              id="origem"
              className={classeControle}
              value={origem}
              onChange={(e) => definirOrigem(e.target.value as OrigemProblema)}
            >
              {OrigemProblema.options.map((opcao) => (
                <option key={opcao} value={opcao}>
                  {RotuloOrigemProblema[opcao]}
                </option>
              ))}
            </select>
          </Campo>

          <div className="sm:col-span-2">
            <Campo id="titulo" rotulo="O problema, em poucas palavras" obrigatorio>
              <input
                id="titulo"
                className={classeControle}
                value={titulo}
                onChange={(e) => definirTitulo(e.target.value)}
                required
                minLength={3}
                placeholder="Posto de saúde sem médico à tarde"
              />
            </Campo>
          </div>

          <Campo id="gravidade" rotulo="Gravidade" dica="1 = incomoda, 5 = urgente.">
            <select
              id="gravidade"
              className={classeControle}
              value={gravidade}
              onChange={(e) => definirGravidade(e.target.value)}
            >
              {[1, 2, 3, 4, 5].map((n) => (
                <option key={n} value={n}>
                  {n}
                </option>
              ))}
            </select>
          </Campo>

          <Campo id="relatos" rotulo="Quantas pessoas citaram" dica="É o peso do tema no agregado.">
            <input
              id="relatos"
              className={classeControle}
              value={relatos}
              onChange={(e) => definirRelatos(e.target.value.replace(/\D+/g, '') || '1')}
              inputMode="numeric"
            />
          </Campo>

          {erro ? (
            <p role="alert" className="text-sm text-[hsl(var(--perigo))] sm:col-span-2">
              {erro}
            </p>
          ) : null}

          <div className="sm:col-span-2">
            <Botao type="submit" tamanho="pequeno" carregando={salvando}>
              Registrar problema
            </Botao>
          </div>
        </form>
      ) : null}

      {carregando ? (
        <EstadoCarregando />
      ) : (dados ?? []).length === 0 ? (
        <p className="text-xs text-[hsl(var(--texto-fraco))]">
          Nenhum problema registrado neste diagnóstico.
        </p>
      ) : (
        <ul className="flex flex-col gap-1.5">
          {(dados ?? []).map((problema) => (
            <li key={problema.id} className="flex flex-wrap items-baseline gap-2 text-sm">
              <span className="rounded bg-[hsl(var(--fundo-sutil))] px-1.5 py-0.5 text-xs text-[hsl(var(--texto-secundario))]">
                {problema.tema_livre ?? RotuloTemaProblema[problema.tema]}
              </span>
              <span className="text-[hsl(var(--texto))]">{problema.titulo}</span>
              <span className="text-xs text-[hsl(var(--texto-fraco))]">
                gravidade {problema.gravidade}/5 · {problema.frequencia_relatos}{' '}
                {problema.frequencia_relatos === 1 ? 'relato' : 'relatos'}
                {problema.bairro ? ` · ${problema.bairro}` : ''}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/**
 * Diagnóstico local.
 *
 * O gráfico de temas fica no topo e não no fim: ele é o produto do módulo. Os
 * diagnósticos abaixo são o caminho para alimentá-lo, e um problema isolado é
 * anedota — o que orienta discurso é "saneamento aparece em seis bairros".
 */
export default function PaginaDiagnostico(): JSX.Element {
  const { idCampanha, carregando: carregandoSessao } = useSessao();

  const [expandido, definirExpandido] = useState<string | null>(null);
  const [aberto, definirAberto] = useState(false);
  const [titulo, definirTitulo] = useState('');
  const [salvando, definirSalvando] = useState(false);
  const [erroFormulario, definirErroFormulario] = useState<string | null>(null);

  const { dados, carregando, erro, recarregar } = useListagem<Diagnostico[]>(
    idCampanha ? `/diagnostico?idCampanha=${idCampanha}` : null,
  );

  const {
    dados: temas,
    carregando: carregandoTemas,
    recarregar: recarregarTemas,
  } = useListagem<TemaAgregado[]>(
    idCampanha ? `/diagnostico/agregado/temas?idCampanha=${idCampanha}` : null,
  );

  async function criar(evento: React.FormEvent): Promise<void> {
    evento.preventDefault();
    definirSalvando(true);
    definirErroFormulario(null);
    try {
      await api.enviar('/diagnostico', { idCampanha, titulo });
      definirTitulo('');
      definirAberto(false);
      recarregar();
    } catch (falha) {
      definirErroFormulario(
        falha instanceof ErroDaApi ? falha.message : 'Não foi possível criar o diagnóstico.',
      );
    } finally {
      definirSalvando(false);
    }
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

  return (
    <main className="mx-auto flex max-w-4xl flex-col gap-4 px-4 py-6">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold text-[hsl(var(--texto))]">Diagnóstico local</h1>
          <p className="text-sm text-[hsl(var(--texto-secundario))]">
            O que a campanha ouve na rua, contado por tema.
          </p>
        </div>
        <Botao onClick={() => definirAberto((valor) => !valor)}>
          <ClipboardList className="size-4" aria-hidden="true" />
          Novo diagnóstico
        </Botao>
      </header>

      <section className="rounded-[var(--raio)] border border-[hsl(var(--borda))] p-4">
        <h2 className="mb-2 text-sm font-medium text-[hsl(var(--texto))]">Temas mais citados</h2>
        {carregandoTemas ? <EstadoCarregando /> : <GraficoTemas dados={temas ?? []} />}
      </section>

      {aberto ? (
        <form
          onSubmit={(evento) => void criar(evento)}
          className="flex flex-col gap-3 rounded-[var(--raio)] border border-[hsl(var(--borda))] p-4"
        >
          <Campo
            id="titulo"
            rotulo="Título do diagnóstico"
            obrigatorio
            dica="Ex.: Escuta na Zona Norte, agosto"
          >
            <input
              id="titulo"
              className={classeControle}
              value={titulo}
              onChange={(e) => definirTitulo(e.target.value)}
              required
              minLength={3}
            />
          </Campo>

          {erroFormulario ? (
            <p role="alert" className="text-sm text-[hsl(var(--perigo))]">
              {erroFormulario}
            </p>
          ) : null}

          <div className="flex gap-2">
            <Botao type="submit" carregando={salvando}>
              Criar
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
      ) : (dados ?? []).length === 0 ? (
        <EstadoVazio
          titulo="Nenhum diagnóstico"
          descricao="Crie um diagnóstico para começar a registrar o que a equipe ouve em campo."
        />
      ) : (
        (dados ?? []).map((diagnostico) => (
          <article
            key={diagnostico.id}
            className="rounded-[var(--raio)] border border-[hsl(var(--borda))] p-3"
          >
            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={() =>
                  definirExpandido((atual) => (atual === diagnostico.id ? null : diagnostico.id))
                }
                aria-expanded={expandido === diagnostico.id}
                className="font-medium text-[hsl(var(--texto))] underline-offset-2 hover:underline"
              >
                {diagnostico.titulo}
              </button>
              <span
                className={cn(
                  'rounded-full px-2 py-0.5 text-xs',
                  'bg-[hsl(var(--informacao-sutil))] text-[hsl(var(--informacao))]',
                )}
              >
                {RotuloStatusDiagnostico[diagnostico.status]}
              </span>
              <span className="text-xs text-[hsl(var(--texto-fraco))]">
                {diagnostico.total_problemas}{' '}
                {diagnostico.total_problemas === 1 ? 'problema' : 'problemas'}
                {diagnostico.area ? ` · ${diagnostico.area}` : ''}
              </span>
            </div>

            {expandido === diagnostico.id ? (
              <Problemas idDiagnostico={diagnostico.id} aoMudar={recarregarTemas} />
            ) : null}
          </article>
        ))
      )}
    </main>
  );
}
