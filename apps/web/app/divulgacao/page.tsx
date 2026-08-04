'use client';

import { Check, ExternalLink, Megaphone, Plus, Sparkles } from 'lucide-react';
import { useState } from 'react';
import { Botao, EstadoCarregando, EstadoVazio, cn } from '@jeleitoral/ui';
import {
  RedeSocial,
  RotuloRedeSocial,
  RotuloStatusPublicacao,
  StatusPublicacao,
} from '@jeleitoral/tipos';
import { Campo, classeControle } from '@/componentes/cadastro/Campo';
import { TarjaGeradoPorIa } from '@/componentes/ia/RevisarComIa';
import { ErroDaApi, api } from '@/lib/api';
import { useListagem } from '@/lib/useListagem';
import { useSessao } from '@/lib/useSessao';

interface Publicacao {
  id: string;
  rede: RedeSocial;
  titulo: string;
  texto: string | null;
  status: StatusPublicacao;
  agendada_para: string | null;
  publicada_em: string | null;
  url_publicacao: string | null;
  impulsionada: boolean;
  gerado_por_ia: boolean;
  eixo: string | null;
  criador: string | null;
  ultima_metrica: {
    alcance: number | null;
    curtidas: number | null;
    comentarios: number | null;
    compartilhamentos: number | null;
    aferida_em: string;
  } | null;
}

interface EixoResumo {
  id: string;
  titulo: string;
  prioridade: 'ALTA' | 'MEDIA' | 'BAIXA';
  problemas_de_origem: number;
  publicadas: number;
  na_fila: number;
}

interface Legenda {
  texto: string;
  tom: 'DIRETO' | 'PROXIMO' | 'FIRME';
  chamadaAcao: string;
  sugestaoHashtags: string[];
}

const CLASSE_STATUS: Record<StatusPublicacao, string> = {
  RASCUNHO: 'bg-[hsl(var(--fundo-sutil))] text-[hsl(var(--texto-secundario))]',
  EM_APROVACAO: 'bg-[hsl(var(--alerta-sutil))] text-[hsl(var(--alerta))]',
  APROVADA: 'bg-[hsl(var(--informacao-sutil))] text-[hsl(var(--informacao))]',
  PUBLICADA: 'bg-[hsl(var(--sucesso-sutil))] text-[hsl(var(--sucesso))]',
  CANCELADA: 'bg-[hsl(var(--fundo-sutil))] text-[hsl(var(--texto-fraco))]',
};

const ROTULO_TOM: Record<Legenda['tom'], string> = {
  DIRETO: 'Direto',
  PROXIMO: 'Próximo',
  FIRME: 'Firme',
};

/**
 * Cobertura da narrativa nas redes.
 *
 * Fica no topo porque é a única leitura do módulo que muda decisão. Um eixo com
 * doze problemas de origem e zero publicações é um diagnóstico que a campanha
 * pagou para fazer e não usou — e é o tipo de coisa que ninguém percebe olhando
 * uma lista de posts em ordem cronológica.
 */
function Cobertura({ idCampanha }: { idCampanha: string }): JSX.Element {
  const { dados, carregando } = useListagem<EixoResumo[]>(
    `/divulgacao/cobertura-narrativa?idCampanha=${idCampanha}`,
  );

  if (carregando) return <EstadoCarregando />;
  if ((dados ?? []).length === 0) {
    return (
      <p className="text-xs text-[hsl(var(--texto-fraco))]">
        Defina eixos na linha narrativa para acompanhar a cobertura.
      </p>
    );
  }

  return (
    <ul className="flex flex-col gap-2">
      {(dados ?? []).map((eixo) => {
        const descoberto = eixo.publicadas === 0 && eixo.problemas_de_origem > 0;
        return (
          <li key={eixo.id} className="flex flex-wrap items-baseline gap-2 text-sm">
            <span
              className={cn(
                'font-medium',
                descoberto ? 'text-[hsl(var(--perigo))]' : 'text-[hsl(var(--texto))]',
              )}
            >
              {eixo.titulo}
            </span>
            <span className="text-xs text-[hsl(var(--texto-fraco))]">
              {eixo.problemas_de_origem}{' '}
              {eixo.problemas_de_origem === 1 ? 'problema' : 'problemas'} de origem ·{' '}
              {eixo.publicadas} {eixo.publicadas === 1 ? 'peça publicada' : 'peças publicadas'}
              {eixo.na_fila > 0 ? ` · ${eixo.na_fila} na fila` : ''}
            </span>
            {descoberto ? (
              <span className="rounded-full bg-[hsl(var(--perigo-sutil))] px-2 py-0.5 text-xs text-[hsl(var(--perigo))]">
                Sem divulgação
              </span>
            ) : null}
          </li>
        );
      })}
    </ul>
  );
}

/**
 * Calendário de conteúdo.
 *
 * O sistema **não publica** — planeja, aprova e recebe as métricas de volta.
 * Publicar de fato exigiria OAuth e revisão de aplicativo da Meta, que não sai
 * a tempo do pleito. Quem posta é a pessoa, na conta dela, e cola o link aqui.
 */
export default function PaginaDivulgacao(): JSX.Element {
  const { idCampanha, carregando: carregandoSessao } = useSessao();

  const { dados, carregando, erro, recarregar } = useListagem<Publicacao[]>(
    idCampanha ? `/divulgacao/publicacoes?idCampanha=${idCampanha}` : null,
  );
  const { dados: eixos } = useListagem<EixoResumo[]>(
    idCampanha ? `/divulgacao/cobertura-narrativa?idCampanha=${idCampanha}` : null,
  );

  const [aberto, definirAberto] = useState(false);
  const [rede, definirRede] = useState<RedeSocial>('INSTAGRAM');
  const [titulo, definirTitulo] = useState('');
  const [texto, definirTexto] = useState('');
  const [idEixo, definirIdEixo] = useState('');
  const [agendadaPara, definirAgendadaPara] = useState('');
  const [salvando, definirSalvando] = useState(false);
  const [erroFormulario, definirErroFormulario] = useState<string | null>(null);

  const [legendas, definirLegendas] = useState<Legenda[]>([]);
  const [gerando, definirGerando] = useState(false);
  const [veioDaIa, definirVeioDaIa] = useState(false);

  async function gerarLegendas(): Promise<void> {
    if (!idEixo) {
      definirErroFormulario('Escolha o eixo narrativo antes de pedir legendas.');
      return;
    }
    definirGerando(true);
    definirErroFormulario(null);
    try {
      const resposta = await api.enviar<{ legendas: Legenda[] }>('/ia/legendas', {
        idEixo,
        rede,
      });
      definirLegendas(resposta.legendas);
    } catch (falha) {
      definirErroFormulario(
        falha instanceof ErroDaApi ? falha.message : 'Não foi possível gerar as legendas.',
      );
    } finally {
      definirGerando(false);
    }
  }

  async function criar(evento: React.FormEvent): Promise<void> {
    evento.preventDefault();
    definirSalvando(true);
    definirErroFormulario(null);
    try {
      await api.enviar('/divulgacao/publicacoes', {
        idCampanha,
        rede,
        titulo,
        texto: texto || undefined,
        idEixo: idEixo || undefined,
        agendadaPara: agendadaPara ? new Date(agendadaPara).toISOString() : undefined,
        geradoPorIa: veioDaIa,
      });
      definirTitulo('');
      definirTexto('');
      definirLegendas([]);
      definirVeioDaIa(false);
      definirAberto(false);
      recarregar();
    } catch (falha) {
      definirErroFormulario(
        falha instanceof ErroDaApi ? falha.message : 'Não foi possível criar a publicação.',
      );
    } finally {
      definirSalvando(false);
    }
  }

  async function mudarStatus(id: string, status: StatusPublicacao): Promise<void> {
    await api.atualizar(`/divulgacao/publicacoes/${id}`, { status });
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

  return (
    <main className="mx-auto flex max-w-4xl flex-col gap-4 px-4 py-6">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold text-[hsl(var(--texto))]">Divulgação</h1>
          <p className="text-sm text-[hsl(var(--texto-secundario))]">
            O calendário de conteúdo. O sistema planeja e aprova; quem publica é você.
          </p>
        </div>
        <Botao onClick={() => definirAberto((valor) => !valor)}>
          <Plus className="size-4" aria-hidden="true" />
          Nova peça
        </Botao>
      </header>

      <section className="rounded-[var(--raio)] border border-[hsl(var(--borda))] p-4">
        <h2 className="mb-2 text-sm font-medium text-[hsl(var(--texto))]">
          A campanha está falando do que ouviu?
        </h2>
        <Cobertura idCampanha={idCampanha} />
      </section>

      {aberto ? (
        <form
          onSubmit={(evento) => void criar(evento)}
          className="grid gap-3 rounded-[var(--raio)] border border-[hsl(var(--borda))] p-4 sm:grid-cols-2"
        >
          <Campo id="rede" rotulo="Rede" obrigatorio>
            <select
              id="rede"
              className={classeControle}
              value={rede}
              onChange={(e) => definirRede(e.target.value as RedeSocial)}
            >
              {RedeSocial.options.map((opcao) => (
                <option key={opcao} value={opcao}>
                  {RotuloRedeSocial[opcao]}
                </option>
              ))}
            </select>
          </Campo>

          <Campo id="eixo" rotulo="Eixo narrativo" dica="É o que prende a peça ao diagnóstico.">
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

          <div className="sm:col-span-2">
            <Campo id="titulo" rotulo="Título interno" obrigatorio>
              <input
                id="titulo"
                className={classeControle}
                value={titulo}
                onChange={(e) => definirTitulo(e.target.value)}
                required
                minLength={3}
                placeholder="Carrossel sobre saneamento — Zona Norte"
              />
            </Campo>
          </div>

          <div className="sm:col-span-2">
            <Campo id="texto" rotulo="Legenda">
              <textarea
                id="texto"
                className={cn(classeControle, 'min-h-28 resize-y')}
                value={texto}
                onChange={(e) => {
                  definirTexto(e.target.value);
                  // Editar à mão deixa de ser conteúdo de IA. A tarja precisa
                  // dizer a verdade, senão vira decoração.
                  if (veioDaIa) definirVeioDaIa(false);
                }}
              />
            </Campo>
            <div className="mt-1 flex items-center gap-2">
              <Botao
                variante="sutil"
                tamanho="pequeno"
                carregando={gerando}
                onClick={() => void gerarLegendas()}
              >
                <Sparkles className="size-3.5" aria-hidden="true" />
                Gerar do eixo
              </Botao>
              {veioDaIa ? <TarjaGeradoPorIa /> : null}
            </div>
          </div>

          {legendas.length > 0 ? (
            <div className="flex flex-col gap-2 sm:col-span-2">
              {legendas.map((legenda) => (
                <article
                  key={legenda.texto}
                  className="rounded-[var(--raio)] border border-dashed border-[hsl(var(--acento))] bg-[hsl(var(--fundo-sutil))] p-3"
                >
                  <div className="mb-1 flex items-center gap-2">
                    <span className="text-xs font-medium text-[hsl(var(--texto-secundario))]">
                      Tom {ROTULO_TOM[legenda.tom].toLowerCase()}
                    </span>
                    <span className="text-xs text-[hsl(var(--texto-fraco))]">
                      {legenda.texto.length} caracteres
                    </span>
                  </div>
                  <p className="whitespace-pre-wrap text-sm text-[hsl(var(--texto))]">
                    {legenda.texto}
                  </p>
                  {legenda.sugestaoHashtags.length > 0 ? (
                    <p className="mt-1 text-xs text-[hsl(var(--texto-fraco))]">
                      {legenda.sugestaoHashtags.join(' ')}
                    </p>
                  ) : null}
                  <Botao
                    variante="sutil"
                    tamanho="pequeno"
                    className="mt-2"
                    onClick={() => {
                      definirTexto(legenda.texto);
                      definirVeioDaIa(true);
                      definirLegendas([]);
                    }}
                  >
                    <Check className="size-3.5" aria-hidden="true" />
                    Usar esta
                  </Botao>
                </article>
              ))}
            </div>
          ) : null}

          <Campo id="agenda" rotulo="Agendar para" dica="Quando a peça deve ir ao ar.">
            <input
              id="agenda"
              type="datetime-local"
              className={classeControle}
              value={agendadaPara}
              onChange={(e) => definirAgendadaPara(e.target.value)}
            />
          </Campo>

          {erroFormulario ? (
            <p role="alert" className="text-sm text-[hsl(var(--perigo))] sm:col-span-2">
              {erroFormulario}
            </p>
          ) : null}

          <div className="flex gap-2 sm:col-span-2">
            <Botao type="submit" carregando={salvando}>
              Criar peça
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
          titulo="Nenhuma peça no calendário"
          descricao="Crie a primeira peça a partir de um eixo da linha narrativa."
        />
      ) : (
        (dados ?? []).map((publicacao) => (
          <article
            key={publicacao.id}
            className="flex flex-col gap-2 rounded-[var(--raio)] border border-[hsl(var(--borda))] p-4"
          >
            <div className="flex flex-wrap items-center gap-2">
              <Megaphone className="size-4 text-[hsl(var(--acento))]" aria-hidden="true" />
              <h3 className="font-medium text-[hsl(var(--texto))]">{publicacao.titulo}</h3>
              <span className="text-xs text-[hsl(var(--texto-fraco))]">
                {RotuloRedeSocial[publicacao.rede]}
              </span>
              <span
                className={cn(
                  'rounded-full px-2 py-0.5 text-xs',
                  CLASSE_STATUS[publicacao.status],
                )}
              >
                {RotuloStatusPublicacao[publicacao.status]}
              </span>
              {publicacao.gerado_por_ia ? <TarjaGeradoPorIa /> : null}
            </div>

            {publicacao.texto ? (
              <p className="whitespace-pre-wrap text-sm text-[hsl(var(--texto-secundario))]">
                {publicacao.texto}
              </p>
            ) : null}

            <p className="text-xs text-[hsl(var(--texto-fraco))]">
              {publicacao.eixo ? `Eixo: ${publicacao.eixo}` : 'Sem eixo vinculado'}
              {publicacao.agendada_para
                ? ` · agendada para ${new Date(publicacao.agendada_para).toLocaleString('pt-BR')}`
                : ''}
              {publicacao.ultima_metrica?.alcance != null
                ? ` · alcance ${publicacao.ultima_metrica.alcance.toLocaleString('pt-BR')}`
                : ''}
            </p>

            <div className="flex flex-wrap gap-2">
              {publicacao.status === 'RASCUNHO' ? (
                <Botao
                  variante="sutil"
                  tamanho="pequeno"
                  onClick={() => void mudarStatus(publicacao.id, 'EM_APROVACAO')}
                >
                  Enviar para aprovação
                </Botao>
              ) : null}
              {publicacao.status === 'EM_APROVACAO' ? (
                <Botao
                  tamanho="pequeno"
                  onClick={() => void mudarStatus(publicacao.id, 'APROVADA')}
                >
                  <Check className="size-3.5" aria-hidden="true" />
                  Aprovar
                </Botao>
              ) : null}
              {publicacao.status === 'APROVADA' ? (
                <Botao
                  tamanho="pequeno"
                  onClick={() => void mudarStatus(publicacao.id, 'PUBLICADA')}
                >
                  Marcar como publicada
                </Botao>
              ) : null}
              {publicacao.url_publicacao ? (
                <a
                  href={publicacao.url_publicacao}
                  target="_blank"
                  rel="noreferrer noopener"
                  className="inline-flex items-center gap-1 text-xs text-[hsl(var(--acento))] hover:underline"
                >
                  <ExternalLink className="size-3.5" aria-hidden="true" />
                  Ver no ar
                </a>
              ) : null}
            </div>
          </article>
        ))
      )}
    </main>
  );
}
