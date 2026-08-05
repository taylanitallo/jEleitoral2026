'use client';

import { TriangleAlert } from 'lucide-react';
import { useRouter, useSearchParams } from 'next/navigation';
import { Suspense, useMemo, useState } from 'react';
import { BarraAcoes, Botao, EstadoCarregando, EstadoErro, EstadoVazio, cn } from '@jeleitoral/ui';
import { RotuloStatusEntrevista, type PaginaDe, type StatusEntrevista } from '@jeleitoral/tipos';
import { Tabela, type Coluna } from '@/componentes/cadastro/Tabela';
import { classeControle } from '@/componentes/cadastro/Campo';
import { BarraFiltros } from '@/componentes/dashboard/BarraFiltros';
import { deParametrosUrl, paraParametrosUrl } from '@/lib/filtroGlobal';
import { useListagem } from '@/lib/useListagem';
import { useOpcoesFiltro } from '@/lib/useOpcoesFiltro';
import { useSessao } from '@/lib/useSessao';

interface LinhaEntrevista {
  id: string;
  data_hora: string;
  status: StatusEntrevista;
  versao: number;
  vigente: boolean;
  entrevistado: string;
  bairro: string | null;
  entrevistador: string;
  total_intencoes: number;
  tem_alerta: boolean;
}

const CLASSE_STATUS: Record<StatusEntrevista, string> = {
  RASCUNHO: 'bg-[hsl(var(--fundo-sutil))] text-[hsl(var(--texto-secundario))]',
  CONCLUIDA: 'bg-[hsl(var(--apoiador-sutil))] text-[hsl(var(--apoiador))]',
  VALIDADA: 'bg-[hsl(var(--informacao-sutil))] text-[hsl(var(--informacao))]',
  INVALIDADA: 'bg-[hsl(var(--perigo-sutil))] text-[hsl(var(--perigo))]',
};

/**
 * Registro de entrevistas — o pedido central: "um local onde estas
 * entrevistas sejam registradas".
 *
 * Não mostra escopo nenhum na consulta porque não precisa: a RLS de
 * `entrevistas`/`entrevistas_vigentes` já decide, linha a linha, o que este
 * usuário enxerga. ENTREVISTADOR vê só o que ele mesmo coletou; COORDENADOR,
 * a equipe; ADMINISTRADOR, a campanha inteira.
 */
function ConteudoRegistroEntrevistas(): JSX.Element {
  const { idCampanha, carregando: carregandoSessao } = useSessao();
  const roteador = useRouter();
  const buscaUrl = useSearchParams();

  const [pagina, definirPagina] = useState(1);
  const [texto, definirTexto] = useState('');
  const [textoAplicado, definirTextoAplicado] = useState('');
  const [status, definirStatus] = useState<StatusEntrevista | ''>('');
  const [comAlerta, definirComAlerta] = useState(false);

  // Só bairro, equipe e período: é o que `GET /campo/entrevistas` de fato
  // aceita. Cargo, candidato e o resto da hierarquia territorial não fazem
  // sentido para uma listagem de entrevistas — passar `opcoes` inteiro ao
  // `BarraFiltros` desenharia seletores que mudam a URL sem mudar a lista.
  const filtroTerritorial = useMemo(
    () => deParametrosUrl(new URLSearchParams(buscaUrl.toString())),
    [buscaUrl],
  );
  const { opcoes } = useOpcoesFiltro(idCampanha, filtroTerritorial);
  const opcoesSuportadas = useMemo(
    () => ({ idBairro: opcoes.idBairro, idEquipe: opcoes.idEquipe }),
    [opcoes.idBairro, opcoes.idEquipe],
  );

  const parametros = new URLSearchParams({
    idCampanha: idCampanha ?? '',
    pagina: String(pagina),
    limite: '50',
  });
  if (textoAplicado) parametros.set('texto', textoAplicado);
  if (status) parametros.set('status', status);
  if (comAlerta) parametros.set('comAlerta', 'true');
  const parametrosTerritoriais = paraParametrosUrl(filtroTerritorial);
  for (const chave of ['idBairro', 'idEquipe', 'dataInicio', 'dataFim']) {
    const valor = parametrosTerritoriais.get(chave);
    if (valor) parametros.set(chave, valor);
  }

  const { dados, carregando, erro, recarregar } = useListagem<PaginaDe<LinhaEntrevista>>(
    idCampanha ? `/campo/entrevistas?${parametros.toString()}` : null,
  );

  function buscar(evento: React.FormEvent): void {
    evento.preventDefault();
    definirPagina(1);
    definirTextoAplicado(texto.trim());
  }

  if (carregandoSessao) return <EstadoCarregando />;

  if (!idCampanha) {
    return (
      <p role="alert" className="text-sm text-[hsl(var(--perigo))]">
        Seu acesso não está vinculado a nenhuma campanha.
      </p>
    );
  }

  const colunas: Array<Coluna<LinhaEntrevista>> = [
    {
      chave: 'entrevistado',
      rotulo: 'Entrevistado',
      render: (linha) => (
        <span className="flex items-center gap-1.5">
          {linha.entrevistado}
          {linha.tem_alerta ? (
            <TriangleAlert
              className="size-3.5 shrink-0 text-[hsl(var(--atencao))]"
              aria-label="Tem alerta de qualidade pendente"
            />
          ) : null}
        </span>
      ),
    },
    { chave: 'bairro', rotulo: 'Bairro', render: (linha) => linha.bairro ?? '—' },
    { chave: 'entrevistador', rotulo: 'Entrevistador', render: (linha) => linha.entrevistador },
    {
      chave: 'data_hora',
      rotulo: 'Data',
      render: (linha) => new Date(linha.data_hora).toLocaleString('pt-BR'),
    },
    {
      chave: 'status',
      rotulo: 'Status',
      render: (linha) => (
        <span className={cn('rounded-full px-2 py-0.5 text-xs', CLASSE_STATUS[linha.status])}>
          {RotuloStatusEntrevista[linha.status]}
        </span>
      ),
    },
    {
      chave: 'versao',
      rotulo: 'Versão',
      render: (linha) =>
        linha.versao > 1 ? (
          <span
            title="Esta entrevista foi retificada"
            className="rounded-full bg-[hsl(var(--fundo-sutil))] px-2 py-0.5 text-xs text-[hsl(var(--texto-secundario))]"
          >
            v{linha.versao}
          </span>
        ) : (
          <span className="text-xs text-[hsl(var(--texto-fraco))]">v1</span>
        ),
    },
    {
      chave: 'total_intencoes',
      rotulo: 'Intenções',
      numerico: true,
      render: (linha) => linha.total_intencoes,
    },
  ];

  return (
    <>
      <BarraAcoes
        titulo="Registro de entrevistas"
        subtitulo={dados ? `${dados.total} entrevista(s)` : undefined}
        atualizar={{ aoAcionar: recarregar, carregando }}
        imprimir={{}}
      />

      <BarraFiltros idCampanha={idCampanha} opcoes={opcoesSuportadas} />

      <form
        onSubmit={buscar}
        className="flex flex-wrap items-end gap-3 rounded-[var(--raio)] border border-[hsl(var(--borda))] bg-[hsl(var(--superficie))] p-3"
      >
        <div className="min-w-[12rem] flex-1">
          <label htmlFor="texto" className="mb-1 block text-xs text-[hsl(var(--texto-secundario))]">
            Nome do entrevistado
          </label>
          <input
            id="texto"
            value={texto}
            onChange={(evento) => definirTexto(evento.target.value)}
            placeholder="Buscar por nome…"
            className={classeControle}
          />
        </div>

        <div>
          <label
            htmlFor="status"
            className="mb-1 block text-xs text-[hsl(var(--texto-secundario))]"
          >
            Status
          </label>
          <select
            id="status"
            value={status}
            onChange={(evento) => {
              definirStatus(evento.target.value as StatusEntrevista | '');
              definirPagina(1);
            }}
            className={classeControle}
          >
            <option value="">Todos</option>
            <option value="CONCLUIDA">Concluída</option>
            <option value="VALIDADA">Validada</option>
            <option value="INVALIDADA">Invalidada</option>
          </select>
        </div>

        <label className="flex items-center gap-2 pb-2 text-sm text-[hsl(var(--texto-secundario))]">
          <input
            type="checkbox"
            checked={comAlerta}
            onChange={(evento) => {
              definirComAlerta(evento.target.checked);
              definirPagina(1);
            }}
            className="size-4"
          />
          Só com alerta pendente
        </label>

        <Botao type="submit" tamanho="pequeno">
          Buscar
        </Botao>
      </form>

      {erro ? (
        <EstadoErro
          mensagem={erro.corpo.mensagem}
          idCorrelacao={erro.corpo.idCorrelacao}
          semConexao={erro.semConexao}
          aoTentarNovamente={recarregar}
        />
      ) : carregando && !dados ? (
        <EstadoCarregando mensagem="Carregando entrevistas…" linhas={5} />
      ) : !dados || dados.itens.length === 0 ? (
        <EstadoVazio
          titulo="Nenhuma entrevista encontrada"
          descricao="Ajuste a busca ou registre a primeira entrevista em campo."
          filtrado={Boolean(textoAplicado || status || comAlerta)}
        />
      ) : (
        <>
          <Tabela
            linhas={dados.itens}
            chaveDe={(linha) => linha.id}
            aoClicar={(linha) => roteador.push(`/campo/entrevistas/${linha.id}`)}
            colunas={colunas}
          />

          {dados.totalPaginas > 1 ? (
            <div className="flex items-center justify-between text-sm text-[hsl(var(--texto-secundario))]">
              <Botao
                variante="sutil"
                tamanho="pequeno"
                disabled={pagina <= 1}
                onClick={() => definirPagina((p) => Math.max(1, p - 1))}
              >
                Anterior
              </Botao>
              <span>
                Página {dados.pagina} de {dados.totalPaginas}
              </span>
              <Botao
                variante="sutil"
                tamanho="pequeno"
                disabled={pagina >= dados.totalPaginas}
                onClick={() => definirPagina((p) => Math.min(dados.totalPaginas, p + 1))}
              >
                Próxima
              </Botao>
            </div>
          ) : null}
        </>
      )}
    </>
  );
}

export default function PaginaRegistroEntrevistas(): JSX.Element {
  return (
    <main className="mx-auto flex max-w-5xl flex-col gap-4 px-4 py-6">
      {/* `useSearchParams` exige fronteira de Suspense na renderização estática. */}
      <Suspense fallback={<EstadoCarregando mensagem="Carregando registro…" />}>
        <ConteudoRegistroEntrevistas />
      </Suspense>
    </main>
  );
}
