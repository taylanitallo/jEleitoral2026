'use client';

import { Check, Compass, Plus, Sparkles, X } from 'lucide-react';
import { useState } from 'react';
import { Botao, EstadoCarregando, EstadoVazio, cn } from '@jeleitoral/ui';
import { Prioridade, RotuloTemaProblema, type TemaProblema } from '@jeleitoral/tipos';
import { Campo, classeControle } from '@/componentes/cadastro/Campo';
import { TarjaGeradoPorIa } from '@/componentes/ia/RevisarComIa';
import { ErroDaApi, api } from '@/lib/api';
import { useListagem } from '@/lib/useListagem';
import { useSessao } from '@/lib/useSessao';

interface Eixo {
  id: string;
  titulo: string;
  sintese: string;
  publico_alvo: string | null;
  mensagens: string[];
  provas: string[];
  riscos: string[];
  prioridade: Prioridade;
  gerado_por_ia: boolean;
  total_problemas: number;
  total_acoes: number;
}

/** O eixo como a IA devolve — ainda não gravado. */
interface EixoSugerido {
  titulo: string;
  sintese: string;
  publicoAlvo?: string | null;
  mensagensChave: string[];
  provas: string[];
  riscos: string[];
  temasRelacionados: TemaProblema[];
  prioridade: Prioridade;
}

const CLASSE_PRIORIDADE: Record<Prioridade, string> = {
  ALTA: 'bg-[hsl(var(--perigo-sutil))] text-[hsl(var(--perigo))]',
  MEDIA: 'bg-[hsl(var(--alerta-sutil))] text-[hsl(var(--alerta))]',
  BAIXA: 'bg-[hsl(var(--fundo-sutil))] text-[hsl(var(--texto-secundario))]',
};

/**
 * Um eixo sugerido, ainda fora do banco.
 *
 * Ele fica **editável antes de ser aceito**, e não só aprovável. A sugestão da
 * IA acerta o tema e erra o tom — quem conhece o município corrige o título e a
 * síntese na hora, em vez de aceitar, reabrir e editar depois.
 */
function CartaoSugestao({
  sugestao,
  aoAceitar,
  aoDescartar,
}: {
  sugestao: EixoSugerido;
  aoAceitar: (editado: EixoSugerido) => Promise<void>;
  aoDescartar: () => void;
}): JSX.Element {
  const [titulo, definirTitulo] = useState(sugestao.titulo);
  const [sintese, definirSintese] = useState(sugestao.sintese);
  const [salvando, definirSalvando] = useState(false);

  return (
    <article className="flex flex-col gap-3 rounded-[var(--raio)] border border-dashed border-[hsl(var(--acento))] bg-[hsl(var(--fundo-sutil))] p-4">
      <div className="flex flex-wrap items-center gap-2">
        <TarjaGeradoPorIa />
        <span
          className={cn('rounded-full px-2 py-0.5 text-xs', CLASSE_PRIORIDADE[sugestao.prioridade])}
        >
          {sugestao.prioridade === 'ALTA'
            ? 'Prioridade alta'
            : sugestao.prioridade === 'MEDIA'
              ? 'Prioridade média'
              : 'Prioridade baixa'}
        </span>
      </div>

      <Campo id={`titulo-${sugestao.titulo}`} rotulo="Título do eixo">
        <input
          id={`titulo-${sugestao.titulo}`}
          className={classeControle}
          value={titulo}
          onChange={(e) => definirTitulo(e.target.value)}
        />
      </Campo>

      <Campo id={`sintese-${sugestao.titulo}`} rotulo="Síntese">
        <textarea
          id={`sintese-${sugestao.titulo}`}
          className={cn(classeControle, 'min-h-24 resize-y')}
          value={sintese}
          onChange={(e) => definirSintese(e.target.value)}
        />
      </Campo>

      {sugestao.mensagensChave.length > 0 ? (
        <div>
          <h4 className="text-xs font-medium text-[hsl(var(--texto-secundario))]">
            Mensagens-chave
          </h4>
          <ul className="mt-1 list-disc pl-5 text-sm text-[hsl(var(--texto))]">
            {sugestao.mensagensChave.map((mensagem) => (
              <li key={mensagem}>{mensagem}</li>
            ))}
          </ul>
        </div>
      ) : null}

      {sugestao.riscos.length > 0 ? (
        <div>
          {/*
           * Os riscos ficam visíveis no cartão, e não escondidos atrás de um
           * "ver detalhes". É a parte da sugestão que muda a decisão de aceitar
           * ou não — "este tema expõe a candidatura à cobrança de resultado"
           * vale mais que a terceira mensagem-chave.
           */}
          <h4 className="text-xs font-medium text-[hsl(var(--texto-secundario))]">
            Riscos apontados
          </h4>
          <ul className="mt-1 list-disc pl-5 text-sm text-[hsl(var(--texto-secundario))]">
            {sugestao.riscos.map((risco) => (
              <li key={risco}>{risco}</li>
            ))}
          </ul>
        </div>
      ) : null}

      {sugestao.temasRelacionados.length > 0 ? (
        <p className="text-xs text-[hsl(var(--texto-fraco))]">
          Sai dos problemas de:{' '}
          {sugestao.temasRelacionados.map((tema) => RotuloTemaProblema[tema]).join(', ')}
        </p>
      ) : null}

      <div className="flex gap-2">
        <Botao
          tamanho="pequeno"
          carregando={salvando}
          onClick={() => {
            definirSalvando(true);
            void aoAceitar({ ...sugestao, titulo, sintese }).finally(() => definirSalvando(false));
          }}
        >
          <Check className="size-3.5" aria-hidden="true" />
          Adotar eixo
        </Botao>
        <Botao variante="sutil" tamanho="pequeno" onClick={aoDescartar}>
          <X className="size-3.5" aria-hidden="true" />
          Descartar
        </Botao>
      </div>
    </article>
  );
}

/**
 * Linha narrativa da campanha.
 *
 * Fecha a cadeia `diagnóstico → eixo → ação`: o botão de sugerir não escreve
 * nada no banco, só devolve propostas que precisam ser adotadas uma a uma. É a
 * mesma regra de `RevisarComIa` — a IA propõe, a pessoa decide —, e aqui ela
 * pesa mais, porque o que está sendo decidido é o discurso da campanha.
 */
export default function PaginaNarrativa(): JSX.Element {
  const { idCampanha, carregando: carregandoSessao } = useSessao();

  const { dados, carregando, erro, recarregar } = useListagem<Eixo[]>(
    idCampanha ? `/planejamento/eixos?idCampanha=${idCampanha}` : null,
  );

  const [sugestoes, definirSugestoes] = useState<EixoSugerido[]>([]);
  const [sugerindo, definirSugerindo] = useState(false);
  const [erroIa, definirErroIa] = useState<string | null>(null);

  const [aberto, definirAberto] = useState(false);
  const [titulo, definirTitulo] = useState('');
  const [sintese, definirSintese] = useState('');
  const [salvando, definirSalvando] = useState(false);
  const [erroFormulario, definirErroFormulario] = useState<string | null>(null);

  async function sugerir(): Promise<void> {
    definirSugerindo(true);
    definirErroIa(null);
    try {
      const resposta = await api.enviar<{ eixos: EixoSugerido[] }>('/ia/eixos-narrativos', {
        idCampanha,
      });
      definirSugestoes(resposta.eixos);
      if (resposta.eixos.length === 0) {
        definirErroIa(
          'A IA não encontrou base suficiente. Registre mais problemas no diagnóstico.',
        );
      }
    } catch (falha) {
      definirErroIa(
        falha instanceof ErroDaApi ? falha.message : 'Não foi possível gerar as sugestões.',
      );
    } finally {
      definirSugerindo(false);
    }
  }

  async function adotar(sugestao: EixoSugerido): Promise<void> {
    await api.enviar('/planejamento/eixos', {
      idCampanha,
      titulo: sugestao.titulo,
      sintese: sugestao.sintese,
      publicoAlvo: sugestao.publicoAlvo ?? undefined,
      mensagens: sugestao.mensagensChave,
      provas: sugestao.provas,
      riscos: sugestao.riscos,
      prioridade: sugestao.prioridade,
      // Marca a origem: meses depois ainda dá para separar o que veio da máquina
      // do que a coordenação escreveu.
      geradoPorIa: true,
      temasRelacionados: sugestao.temasRelacionados,
    });
    definirSugestoes((atuais) => atuais.filter((s) => s !== sugestao));
    recarregar();
  }

  async function criar(evento: React.FormEvent): Promise<void> {
    evento.preventDefault();
    definirSalvando(true);
    definirErroFormulario(null);
    try {
      await api.enviar('/planejamento/eixos', { idCampanha, titulo, sintese });
      definirTitulo('');
      definirSintese('');
      definirAberto(false);
      recarregar();
    } catch (falha) {
      definirErroFormulario(
        falha instanceof ErroDaApi ? falha.message : 'Não foi possível criar o eixo.',
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
          <h1 className="text-xl font-semibold text-[hsl(var(--texto))]">Linha narrativa</h1>
          <p className="text-sm text-[hsl(var(--texto-secundario))]">
            Os poucos temas em que a campanha fala, tirados do que se ouviu em campo.
          </p>
        </div>
        <div className="flex gap-2">
          <Botao variante="sutil" carregando={sugerindo} onClick={() => void sugerir()}>
            <Sparkles className="size-4" aria-hidden="true" />
            Sugerir eixos
          </Botao>
          <Botao onClick={() => definirAberto((valor) => !valor)}>
            <Plus className="size-4" aria-hidden="true" />
            Novo eixo
          </Botao>
        </div>
      </header>

      {erroIa ? (
        <p role="alert" className="text-sm text-[hsl(var(--perigo))]">
          {erroIa}
        </p>
      ) : null}

      {sugestoes.length > 0 ? (
        <section className="flex flex-col gap-3">
          <h2 className="text-sm font-medium text-[hsl(var(--texto))]">
            Sugestões — nenhuma foi gravada ainda
          </h2>
          {sugestoes.map((sugestao) => (
            <CartaoSugestao
              key={sugestao.titulo}
              sugestao={sugestao}
              aoAceitar={adotar}
              aoDescartar={() => definirSugestoes((atuais) => atuais.filter((s) => s !== sugestao))}
            />
          ))}
        </section>
      ) : null}

      {aberto ? (
        <form
          onSubmit={(evento) => void criar(evento)}
          className="flex flex-col gap-3 rounded-[var(--raio)] border border-[hsl(var(--borda))] p-4"
        >
          <Campo id="titulo" rotulo="Título do eixo" obrigatorio dica="Ex.: Água que não falta">
            <input
              id="titulo"
              className={classeControle}
              value={titulo}
              onChange={(e) => definirTitulo(e.target.value)}
              required
              minLength={3}
            />
          </Campo>

          <Campo id="sintese" rotulo="Síntese" obrigatorio>
            <textarea
              id="sintese"
              className={cn(classeControle, 'min-h-24 resize-y')}
              value={sintese}
              onChange={(e) => definirSintese(e.target.value)}
              required
              minLength={10}
            />
          </Campo>

          {erroFormulario ? (
            <p role="alert" className="text-sm text-[hsl(var(--perigo))]">
              {erroFormulario}
            </p>
          ) : null}

          <div className="flex gap-2">
            <Botao type="submit" carregando={salvando}>
              Criar eixo
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
          titulo="Nenhum eixo definido"
          descricao="Registre problemas no diagnóstico e peça sugestões, ou escreva o primeiro eixo à mão."
        />
      ) : (
        (dados ?? []).map((eixo) => (
          <article
            key={eixo.id}
            className="flex flex-col gap-2 rounded-[var(--raio)] border border-[hsl(var(--borda))] p-4"
          >
            <div className="flex flex-wrap items-center gap-2">
              <Compass className="size-4 text-[hsl(var(--acento))]" aria-hidden="true" />
              <h3 className="font-medium text-[hsl(var(--texto))]">{eixo.titulo}</h3>
              <span
                className={cn(
                  'rounded-full px-2 py-0.5 text-xs',
                  CLASSE_PRIORIDADE[eixo.prioridade],
                )}
              >
                {eixo.prioridade === 'ALTA'
                  ? 'Alta'
                  : eixo.prioridade === 'MEDIA'
                    ? 'Média'
                    : 'Baixa'}
              </span>
              {eixo.gerado_por_ia ? <TarjaGeradoPorIa /> : null}
            </div>

            <p className="text-sm text-[hsl(var(--texto-secundario))]">{eixo.sintese}</p>

            {eixo.mensagens.length > 0 ? (
              <ul className="list-disc pl-5 text-sm text-[hsl(var(--texto))]">
                {eixo.mensagens.map((mensagem) => (
                  <li key={mensagem}>{mensagem}</li>
                ))}
              </ul>
            ) : null}

            {/*
             * A contagem de problemas é o que separa este módulo de um mural de
             * frases: mostra que o eixo tem lastro em campo, e quantas ações
             * saíram dele.
             */}
            <p className="text-xs text-[hsl(var(--texto-fraco))]">
              {eixo.total_problemas}{' '}
              {eixo.total_problemas === 1 ? 'problema de origem' : 'problemas de origem'} ·{' '}
              {eixo.total_acoes} {eixo.total_acoes === 1 ? 'ação' : 'ações'}
              {eixo.publico_alvo ? ` · ${eixo.publico_alvo}` : ''}
            </p>
          </article>
        ))
      )}
    </main>
  );
}
