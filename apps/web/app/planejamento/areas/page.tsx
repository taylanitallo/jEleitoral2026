'use client';

import { Plus, Target } from 'lucide-react';
import { useState } from 'react';
import { Botao, EstadoCarregando, EstadoVazio, cn } from '@jeleitoral/ui';
import {
  NaturezaArea,
  Prioridade,
  RotuloNaturezaArea,
  RotuloPrioridade,
} from '@jeleitoral/tipos';
import { Campo, classeControle } from '@/componentes/cadastro/Campo';
import { ErroDaApi, api } from '@/lib/api';
import { useListagem } from '@/lib/useListagem';
import { useSessao } from '@/lib/useSessao';

interface Area {
  id: string;
  nome: string;
  natureza: NaturezaArea;
  tema: string | null;
  prioridade: Prioridade;
  meta_votos: number | null;
  ativa: boolean;
  coordenador: string | null;
  equipe: string | null;
  total_territorios: number;
}

interface ResumoArea {
  bairros: number;
  eleitoradoBase: number;
  domiciliosMapeados: number;
  entrevistados: number;
  apoiadores: number;
  coberturaAmostral: number;
}

const CORES_PRIORIDADE: Record<Prioridade, string> = {
  ALTA: 'bg-[hsl(var(--perigo-sutil))] text-[hsl(var(--perigo))]',
  MEDIA: 'bg-[hsl(var(--atencao-sutil))] text-[hsl(var(--atencao))]',
  BAIXA: 'bg-[hsl(var(--nao-informou-sutil))] text-[hsl(var(--nao-informou))]',
};

const formatar = new Intl.NumberFormat('pt-BR');

/** Painel de indicadores de uma área, carregado sob demanda ao expandir. */
function ResumoDaArea({ idArea }: { idArea: string }): JSX.Element {
  const { dados, carregando } = useListagem<ResumoArea>(`/planejamento/areas/${idArea}/resumo`);

  if (carregando) return <EstadoCarregando />;
  if (!dados) return <></>;

  const semDenominador = dados.eleitoradoBase === 0;

  const itens = [
    { rotulo: 'Bairros', valor: formatar.format(dados.bairros) },
    {
      rotulo: 'Eleitorado',
      valor: semDenominador ? '—' : formatar.format(dados.eleitoradoBase),
    },
    { rotulo: 'Domicílios mapeados', valor: formatar.format(dados.domiciliosMapeados) },
    { rotulo: 'Entrevistados', valor: formatar.format(dados.entrevistados) },
    { rotulo: 'Apoiadores', valor: formatar.format(dados.apoiadores) },
    {
      rotulo: 'Cobertura',
      // Sem eleitorado carregado, "0%" mentiria dizendo "nada mapeado" quando o
      // certo é "não dá para saber". O traço distingue os dois casos.
      valor: semDenominador
        ? '—'
        : `${(dados.coberturaAmostral * 100).toFixed(1).replace('.', ',')}%`,
    },
  ];

  return (
    <div className="mt-2 border-t border-[hsl(var(--borda))] pt-2">
      <dl className="grid grid-cols-2 gap-x-4 gap-y-2 sm:grid-cols-3">
        {itens.map((item) => (
          <div key={item.rotulo}>
            <dt className="text-xs text-[hsl(var(--texto-fraco))]">{item.rotulo}</dt>
            <dd className="font-mono text-sm text-[hsl(var(--texto))]">{item.valor}</dd>
          </div>
        ))}
      </dl>

      {semDenominador ? (
        <p className="mt-2 text-xs text-[hsl(var(--atencao))]">
          Sem eleitorado do TSE para os bairros desta área — a cobertura não pode ser calculada.
          Rode a carga da UF antes de usar estes números.
        </p>
      ) : null}
    </div>
  );
}

/**
 * Áreas estratégicas.
 *
 * Territorial, temática e segmento vivem na mesma tabela porque divergem em
 * duas colunas anuláveis, não em estrutura — mas aqui aparecem em listas
 * separadas por natureza, e o usuário nunca vê a sobreposição.
 */
export default function PaginaAreas(): JSX.Element {
  const { idCampanha, carregando: carregandoSessao } = useSessao();

  const [aberto, definirAberto] = useState(false);
  const [expandida, definirExpandida] = useState<string | null>(null);
  const [nome, definirNome] = useState('');
  const [natureza, definirNatureza] = useState<NaturezaArea>('TERRITORIAL');
  const [tema, definirTema] = useState('');
  const [prioridade, definirPrioridade] = useState<Prioridade>('MEDIA');
  const [metaVotos, definirMetaVotos] = useState('');
  const [salvando, definirSalvando] = useState(false);
  const [erroFormulario, definirErroFormulario] = useState<string | null>(null);

  const { dados, carregando, erro, recarregar } = useListagem<Area[]>(
    idCampanha ? `/planejamento/areas?idCampanha=${idCampanha}` : null,
  );

  async function criar(evento: React.FormEvent): Promise<void> {
    evento.preventDefault();
    definirSalvando(true);
    definirErroFormulario(null);
    try {
      await api.enviar('/planejamento/areas', {
        idCampanha,
        nome,
        natureza,
        tema: natureza === 'TEMATICA' && tema ? tema : undefined,
        prioridade,
        metaVotos: metaVotos ? Number(metaVotos) : undefined,
      });
      definirNome('');
      definirTema('');
      definirMetaVotos('');
      definirAberto(false);
      recarregar();
    } catch (falha) {
      definirErroFormulario(
        falha instanceof ErroDaApi ? falha.message : 'Não foi possível criar a área.',
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

  const areas = dados ?? [];

  return (
    <main className="mx-auto flex max-w-4xl flex-col gap-4 px-4 py-6">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold text-[hsl(var(--texto))]">Áreas estratégicas</h1>
          <p className="text-sm text-[hsl(var(--texto-secundario))]">
            Como a campanha divide o mapa e as pautas entre os coordenadores.
          </p>
        </div>
        <Botao onClick={() => definirAberto((valor) => !valor)}>
          <Plus className="size-4" aria-hidden="true" />
          Nova área
        </Botao>
      </header>

      {aberto ? (
        <form
          onSubmit={(evento) => void criar(evento)}
          className="grid gap-3 rounded-[var(--raio)] border border-[hsl(var(--borda))] p-4 sm:grid-cols-2"
        >
          <Campo id="nome" rotulo="Nome" obrigatorio>
            <input
              id="nome"
              className={classeControle}
              value={nome}
              onChange={(e) => definirNome(e.target.value)}
              required
              minLength={3}
              placeholder="Zona Norte"
            />
          </Campo>

          <Campo
            id="natureza"
            rotulo="Natureza"
            obrigatorio
            dica="Territorial recorta o mapa; temática recorta a pauta."
          >
            <select
              id="natureza"
              className={classeControle}
              value={natureza}
              onChange={(e) => definirNatureza(e.target.value as NaturezaArea)}
            >
              {NaturezaArea.options.map((opcao) => (
                <option key={opcao} value={opcao}>
                  {RotuloNaturezaArea[opcao]}
                </option>
              ))}
            </select>
          </Campo>

          {natureza === 'TEMATICA' ? (
            <Campo id="tema" rotulo="Tema">
              <input
                id="tema"
                className={classeControle}
                value={tema}
                onChange={(e) => definirTema(e.target.value)}
                placeholder="Saúde"
              />
            </Campo>
          ) : null}

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

          <Campo id="meta" rotulo="Meta de votos">
            <input
              id="meta"
              className={classeControle}
              value={metaVotos}
              onChange={(e) => definirMetaVotos(e.target.value.replace(/\D+/g, ''))}
              inputMode="numeric"
            />
          </Campo>

          {erroFormulario ? (
            <p role="alert" className="text-sm text-[hsl(var(--perigo))] sm:col-span-2">
              {erroFormulario}
            </p>
          ) : null}

          <div className="flex gap-2 sm:col-span-2">
            <Botao type="submit" carregando={salvando}>
              Criar área
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
      ) : areas.length === 0 ? (
        <EstadoVazio
          titulo="Nenhuma área definida"
          descricao="A área agrupa bairros e seções sob um coordenador, e é o recorte que os indicadores usam."
        />
      ) : (
        NaturezaArea.options.map((natureza) => {
          const doGrupo = areas.filter((area) => area.natureza === natureza);
          if (doGrupo.length === 0) return null;

          return (
            <section key={natureza} className="flex flex-col gap-2">
              <h2 className="text-sm font-medium text-[hsl(var(--texto-secundario))]">
                {RotuloNaturezaArea[natureza]}
              </h2>

              {doGrupo.map((area) => (
                <article
                  key={area.id}
                  className="rounded-[var(--raio)] border border-[hsl(var(--borda))] p-3"
                >
                  <div className="flex flex-wrap items-center gap-2">
                    <button
                      type="button"
                      onClick={() =>
                        definirExpandida((atual) => (atual === area.id ? null : area.id))
                      }
                      aria-expanded={expandida === area.id}
                      className="font-medium text-[hsl(var(--texto))] underline-offset-2 hover:underline"
                    >
                      {area.nome}
                    </button>

                    <span
                      className={cn(
                        'rounded-full px-2 py-0.5 text-xs',
                        CORES_PRIORIDADE[area.prioridade],
                      )}
                    >
                      {RotuloPrioridade[area.prioridade]}
                    </span>

                    {area.tema ? (
                      <span className="text-xs text-[hsl(var(--texto-fraco))]">{area.tema}</span>
                    ) : null}

                    {area.meta_votos ? (
                      <span className="flex items-center gap-1 text-xs text-[hsl(var(--texto-secundario))]">
                        <Target className="size-3" aria-hidden="true" />
                        {formatar.format(area.meta_votos)} votos
                      </span>
                    ) : null}
                  </div>

                  <p className="mt-1 text-xs text-[hsl(var(--texto-fraco))]">
                    {area.coordenador ?? 'Sem coordenador'} ·{' '}
                    {area.total_territorios === 0
                      ? 'sem territórios definidos'
                      : `${area.total_territorios} ${
                          area.total_territorios === 1 ? 'território' : 'territórios'
                        }`}
                  </p>

                  {expandida === area.id ? <ResumoDaArea idArea={area.id} /> : null}
                </article>
              ))}
            </section>
          );
        })
      )}
    </main>
  );
}
