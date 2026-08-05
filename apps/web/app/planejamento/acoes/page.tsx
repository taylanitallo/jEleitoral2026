'use client';

import { Ban, CheckCircle2, ListChecks, Play, Plus } from 'lucide-react';
import { useState } from 'react';
import { Botao, EstadoCarregando, EstadoVazio, cn } from '@jeleitoral/ui';
import { Prioridade, RotuloPrioridade, RotuloStatusAcao, StatusAcao } from '@jeleitoral/tipos';
import { Campo, classeControle } from '@/componentes/cadastro/Campo';
import { ErroDaApi, api } from '@/lib/api';
import { useListagem } from '@/lib/useListagem';
import { useSessao } from '@/lib/useSessao';

interface Acao {
  id: string;
  titulo: string;
  descricao: string | null;
  status: StatusAcao;
  prioridade: Prioridade;
  prazo: string | null;
  resultado_esperado: string | null;
  eixo: string | null;
  area: string | null;
  responsavel: string | null;
  total_atividades: number;
}

interface EixoOpcao {
  id: string;
  titulo: string;
}

interface AreaOpcao {
  id: string;
  nome: string;
}

const CLASSE_STATUS: Record<StatusAcao, string> = {
  PLANEJADA: 'bg-[hsl(var(--informacao-sutil))] text-[hsl(var(--informacao))]',
  EM_EXECUCAO: 'bg-[hsl(var(--alerta-sutil))] text-[hsl(var(--alerta))]',
  CONCLUIDA: 'bg-[hsl(var(--sucesso-sutil))] text-[hsl(var(--sucesso))]',
  CANCELADA: 'bg-[hsl(var(--fundo-sutil))] text-[hsl(var(--texto-fraco))]',
};

const CLASSE_PRIORIDADE: Record<Prioridade, string> = {
  ALTA: 'bg-[hsl(var(--perigo-sutil))] text-[hsl(var(--perigo))]',
  MEDIA: 'bg-[hsl(var(--alerta-sutil))] text-[hsl(var(--alerta))]',
  BAIXA: 'bg-[hsl(var(--fundo-sutil))] text-[hsl(var(--texto-secundario))]',
};

/**
 * Plano de ações.
 *
 * Fecha o penúltimo elo da cadeia `diagnóstico → eixo → ação → atividade`: a
 * API já existia (`/planejamento/acoes`), mas sem esta tela dava para criar um
 * eixo e não dava para desdobrá-lo em ação — a coordenação anotava em outro
 * lugar e a rastreabilidade se perdia bem no meio do caminho.
 */
export default function PaginaAcoes(): JSX.Element {
  const { idCampanha, carregando: carregandoSessao } = useSessao();

  const { dados, carregando, erro, recarregar } = useListagem<Acao[]>(
    idCampanha ? `/planejamento/acoes?idCampanha=${idCampanha}` : null,
  );
  const { dados: eixos } = useListagem<EixoOpcao[]>(
    idCampanha ? `/planejamento/eixos?idCampanha=${idCampanha}` : null,
  );
  const { dados: areas } = useListagem<AreaOpcao[]>(
    idCampanha ? `/planejamento/areas?idCampanha=${idCampanha}` : null,
  );

  const [aberto, definirAberto] = useState(false);
  const [titulo, definirTitulo] = useState('');
  const [descricao, definirDescricao] = useState('');
  const [idEixo, definirIdEixo] = useState('');
  const [idArea, definirIdArea] = useState('');
  const [prioridade, definirPrioridade] = useState<Prioridade>('MEDIA');
  const [prazo, definirPrazo] = useState('');
  const [resultadoEsperado, definirResultadoEsperado] = useState('');
  const [salvando, definirSalvando] = useState(false);
  const [erroFormulario, definirErroFormulario] = useState<string | null>(null);

  const [concluindo, definirConcluindo] = useState<string | null>(null);
  const [resultadoObtido, definirResultadoObtido] = useState('');
  const [enviandoConclusao, definirEnviandoConclusao] = useState(false);

  async function criar(evento: React.FormEvent): Promise<void> {
    evento.preventDefault();
    definirSalvando(true);
    definirErroFormulario(null);
    try {
      await api.enviar('/planejamento/acoes', {
        idCampanha,
        titulo,
        descricao: descricao || undefined,
        idEixo: idEixo || undefined,
        idArea: idArea || undefined,
        prioridade,
        prazo: prazo || undefined,
        resultadoEsperado: resultadoEsperado || undefined,
      });
      definirTitulo('');
      definirDescricao('');
      definirIdEixo('');
      definirIdArea('');
      definirPrioridade('MEDIA');
      definirPrazo('');
      definirResultadoEsperado('');
      definirAberto(false);
      recarregar();
    } catch (falha) {
      definirErroFormulario(
        falha instanceof ErroDaApi ? falha.message : 'Não foi possível criar a ação.',
      );
    } finally {
      definirSalvando(false);
    }
  }

  async function mudarStatus(id: string, status: StatusAcao): Promise<void> {
    await api.atualizar(`/planejamento/acoes/${id}`, { status });
    recarregar();
  }

  async function concluir(id: string): Promise<void> {
    definirEnviandoConclusao(true);
    try {
      await api.atualizar(`/planejamento/acoes/${id}`, {
        status: 'CONCLUIDA',
        resultadoObtido: resultadoObtido || undefined,
      });
      definirConcluindo(null);
      definirResultadoObtido('');
      recarregar();
    } finally {
      definirEnviandoConclusao(false);
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
          <h1 className="text-xl font-semibold text-[hsl(var(--texto))]">Plano de ações</h1>
          <p className="text-sm text-[hsl(var(--texto-secundario))]">
            O que a campanha vai fazer a partir dos eixos da linha narrativa e das áreas
            estratégicas.
          </p>
        </div>
        <Botao onClick={() => definirAberto((valor) => !valor)}>
          <Plus className="size-4" aria-hidden="true" />
          Nova ação
        </Botao>
      </header>

      {aberto ? (
        <form
          onSubmit={(evento) => void criar(evento)}
          className="grid gap-3 rounded-[var(--raio)] border border-[hsl(var(--borda))] p-4 sm:grid-cols-2"
        >
          <div className="sm:col-span-2">
            <Campo id="titulo" rotulo="Título da ação" obrigatorio>
              <input
                id="titulo"
                className={classeControle}
                value={titulo}
                onChange={(e) => definirTitulo(e.target.value)}
                required
                minLength={3}
                placeholder="Ex.: Mutirão de limpeza na Zona Norte"
              />
            </Campo>
          </div>

          <Campo id="eixo" rotulo="Eixo narrativo" dica="É o que dá lastro à ação.">
            <select
              id="eixo"
              className={classeControle}
              value={idEixo}
              onChange={(e) => definirIdEixo(e.target.value)}
            >
              <option value="">Sem eixo</option>
              {(eixos ?? []).map((eixo) => (
                <option key={eixo.id} value={eixo.id}>
                  {eixo.titulo}
                </option>
              ))}
            </select>
          </Campo>

          <Campo id="area" rotulo="Área estratégica">
            <select
              id="area"
              className={classeControle}
              value={idArea}
              onChange={(e) => definirIdArea(e.target.value)}
            >
              <option value="">Sem área</option>
              {(areas ?? []).map((area) => (
                <option key={area.id} value={area.id}>
                  {area.nome}
                </option>
              ))}
            </select>
          </Campo>

          <Campo id="prioridade" rotulo="Prioridade" obrigatorio>
            <select
              id="prioridade"
              className={classeControle}
              value={prioridade}
              onChange={(e) => definirPrioridade(e.target.value as Prioridade)}
            >
              {Prioridade.options.map((opcao) => (
                <option key={opcao} value={opcao}>
                  {RotuloPrioridade[opcao]}
                </option>
              ))}
            </select>
          </Campo>

          <Campo id="prazo" rotulo="Prazo">
            <input
              id="prazo"
              type="date"
              className={classeControle}
              value={prazo}
              onChange={(e) => definirPrazo(e.target.value)}
            />
          </Campo>

          <div className="sm:col-span-2">
            <Campo id="descricao" rotulo="Descrição">
              <textarea
                id="descricao"
                className={cn(classeControle, 'min-h-20 resize-y')}
                value={descricao}
                onChange={(e) => definirDescricao(e.target.value)}
              />
            </Campo>
          </div>

          <div className="sm:col-span-2">
            <Campo
              id="resultado-esperado"
              rotulo="Resultado esperado"
              dica="O que marca a ação como bem-sucedida quando ela for concluída."
            >
              <textarea
                id="resultado-esperado"
                className={cn(classeControle, 'min-h-16 resize-y')}
                value={resultadoEsperado}
                onChange={(e) => definirResultadoEsperado(e.target.value)}
              />
            </Campo>
          </div>

          {erroFormulario ? (
            <p role="alert" className="text-sm text-[hsl(var(--perigo))] sm:col-span-2">
              {erroFormulario}
            </p>
          ) : null}

          <div className="flex gap-2 sm:col-span-2">
            <Botao type="submit" carregando={salvando}>
              Criar ação
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
          titulo="Nenhuma ação planejada"
          descricao="Desdobre um eixo da linha narrativa na primeira ação, ou crie uma avulsa."
        />
      ) : (
        (dados ?? []).map((acao) => (
          <article
            key={acao.id}
            className="flex flex-col gap-2 rounded-[var(--raio)] border border-[hsl(var(--borda))] p-4"
          >
            <div className="flex flex-wrap items-center gap-2">
              <ListChecks className="size-4 text-[hsl(var(--acento))]" aria-hidden="true" />
              <h3 className="font-medium text-[hsl(var(--texto))]">{acao.titulo}</h3>
              <span className={cn('rounded-full px-2 py-0.5 text-xs', CLASSE_STATUS[acao.status])}>
                {RotuloStatusAcao[acao.status]}
              </span>
              <span
                className={cn('rounded-full px-2 py-0.5 text-xs', CLASSE_PRIORIDADE[acao.prioridade])}
              >
                {RotuloPrioridade[acao.prioridade]}
              </span>
            </div>

            {acao.descricao ? (
              <p className="text-sm text-[hsl(var(--texto-secundario))]">{acao.descricao}</p>
            ) : null}

            <p className="text-xs text-[hsl(var(--texto-fraco))]">
              {acao.eixo ? `Eixo: ${acao.eixo}` : 'Sem eixo vinculado'}
              {acao.area ? ` · Área: ${acao.area}` : ''}
              {acao.responsavel ? ` · Responsável: ${acao.responsavel}` : ''}
              {acao.prazo ? ` · prazo ${new Date(acao.prazo).toLocaleDateString('pt-BR')}` : ''}
              {` · ${acao.total_atividades} ${acao.total_atividades === 1 ? 'atividade' : 'atividades'}`}
            </p>

            {concluindo === acao.id ? (
              <div className="flex flex-col gap-2 rounded-[var(--raio)] border border-dashed border-[hsl(var(--acento))] bg-[hsl(var(--fundo-sutil))] p-3">
                <Campo id={`resultado-${acao.id}`} rotulo="Resultado obtido">
                  <textarea
                    id={`resultado-${acao.id}`}
                    className={cn(classeControle, 'min-h-16 resize-y')}
                    value={resultadoObtido}
                    onChange={(e) => definirResultadoObtido(e.target.value)}
                  />
                </Campo>
                <div className="flex gap-2">
                  <Botao
                    tamanho="pequeno"
                    carregando={enviandoConclusao}
                    onClick={() => void concluir(acao.id)}
                  >
                    <CheckCircle2 className="size-3.5" aria-hidden="true" />
                    Confirmar conclusão
                  </Botao>
                  <Botao
                    variante="sutil"
                    tamanho="pequeno"
                    onClick={() => {
                      definirConcluindo(null);
                      definirResultadoObtido('');
                    }}
                  >
                    Cancelar
                  </Botao>
                </div>
              </div>
            ) : (
              <div className="flex flex-wrap gap-2">
                {acao.status === 'PLANEJADA' ? (
                  <Botao
                    variante="sutil"
                    tamanho="pequeno"
                    onClick={() => void mudarStatus(acao.id, 'EM_EXECUCAO')}
                  >
                    <Play className="size-3.5" aria-hidden="true" />
                    Iniciar execução
                  </Botao>
                ) : null}
                {acao.status === 'EM_EXECUCAO' ? (
                  <Botao tamanho="pequeno" onClick={() => definirConcluindo(acao.id)}>
                    <CheckCircle2 className="size-3.5" aria-hidden="true" />
                    Concluir
                  </Botao>
                ) : null}
                {acao.status === 'PLANEJADA' || acao.status === 'EM_EXECUCAO' ? (
                  <Botao
                    variante="sutil"
                    tamanho="pequeno"
                    onClick={() => void mudarStatus(acao.id, 'CANCELADA')}
                  >
                    <Ban className="size-3.5" aria-hidden="true" />
                    Cancelar
                  </Botao>
                ) : null}
              </div>
            )}
          </article>
        ))
      )}
    </main>
  );
}
