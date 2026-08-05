'use client';

import { ArrowLeft, MapPin, ShieldCheck, TriangleAlert } from 'lucide-react';
import Link from 'next/link';
import { useParams, useRouter, useSearchParams } from 'next/navigation';
import { Botao, EstadoCarregando, EstadoErro, EtiquetaClassificacao, cn } from '@jeleitoral/ui';
import {
  RotuloStatusEntrevista,
  type ClassificacaoEleitor,
  type StatusEntrevista,
} from '@jeleitoral/tipos';
import { useListagem } from '@/lib/useListagem';
import { useSessao } from '@/lib/useSessao';

interface Intencao {
  idCargo: string;
  nomeCargo: string;
  posicao: number;
  tipo: string;
  rotulo: string;
}

interface Alerta {
  tipo: string;
  gravidade: number;
  detalhe: { mensagem?: string } | null;
  criado_em: string;
  revisado_em: string | null;
  procedente: boolean | null;
}

interface Detalhe {
  id: string;
  dataHora: string;
  status: StatusEntrevista;
  versao: number;
  vigente: boolean;
  duracaoSegundos: number | null;
  dispositivo: string | null;
  observacoes: string | null;
  recusouResponder: boolean;
  motivoRetificacao: string | null;
  entrevistado: { nome: string; apelido: string | null; classificacao: ClassificacaoEleitor };
  entrevistador: string;
  retificador: string | null;
  endereco: { logradouro: string; numero: string | null; bairro: string } | null;
  consentimento: { canal: string; aceitoEm: string; versao: string } | null;
  intencoes: Intencao[];
  alertas: Alerta[];
}

interface CampoAlterado {
  campo: string;
  rotulo: string;
  antes: string | null;
  depois: string | null;
  natureza: string;
}

interface VersaoHistorico {
  id: string;
  versao: number;
  vigente: boolean;
  status: StatusEntrevista;
  criadoEm: string;
  motivoRetificacao: string | null;
  usuarioRetificador: string | null;
  diferencas: CampoAlterado[];
}

/**
 * Detalhe da entrevista — somente leitura — com a aba de histórico ao lado.
 *
 * Duas abas de VERDADE (`role="tablist"`), e não abas de navegação como as do
 * grupo lateral: aqui é um painel que troca no mesmo documento, sem sair da
 * página. O estado fica em `?aba=`, seguindo a mesma doutrina de
 * `filtroGlobal.ts` — link copiável direto para a aba de histórico.
 */
export default function PaginaDetalheEntrevista(): JSX.Element {
  const parametros = useParams<{ id: string }>();
  const buscaUrl = useSearchParams();
  const roteador = useRouter();
  const { carregando: carregandoSessao } = useSessao();

  const abaAtiva = buscaUrl.get('aba') === 'historico' ? 'historico' : 'entrevista';

  const {
    dados: detalhe,
    carregando,
    erro,
  } = useListagem<Detalhe>(`/campo/entrevistas/${parametros.id}`);
  const { dados: historico, carregando: carregandoHistorico } = useListagem<{
    versoes: VersaoHistorico[];
  }>(abaAtiva === 'historico' ? `/campo/entrevistas/${parametros.id}/historico` : null);

  function irPara(aba: 'entrevista' | 'historico'): void {
    const parametrosUrl = new URLSearchParams(buscaUrl.toString());
    if (aba === 'entrevista') parametrosUrl.delete('aba');
    else parametrosUrl.set('aba', aba);
    roteador.push(`?${parametrosUrl.toString()}`, { scroll: false });
  }

  if (carregandoSessao || (carregando && !detalhe)) return <EstadoCarregando />;

  if (erro || !detalhe) {
    return (
      <main className="mx-auto max-w-3xl px-4 py-6">
        <EstadoErro
          mensagem={erro?.corpo.mensagem ?? 'Entrevista não encontrada.'}
          idCorrelacao={erro?.corpo.idCorrelacao}
          semConexao={erro?.semConexao}
        />
      </main>
    );
  }

  return (
    <main className="mx-auto flex max-w-3xl flex-col gap-4 px-4 py-6">
      <Link
        href="/campo/entrevistas"
        className="inline-flex w-fit items-center gap-1 text-sm text-[hsl(var(--texto-secundario))] hover:text-[hsl(var(--texto))]"
      >
        <ArrowLeft className="size-4" aria-hidden="true" />
        Voltar ao registro
      </Link>

      <header className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-xl font-semibold text-[hsl(var(--texto))]">
              {detalhe.entrevistado.nome}
            </h1>
            <EtiquetaClassificacao classificacao={detalhe.entrevistado.classificacao} compacta />
          </div>
          <p className="text-sm text-[hsl(var(--texto-secundario))]">
            {new Date(detalhe.dataHora).toLocaleString('pt-BR')} · v{detalhe.versao}
            {!detalhe.vigente ? ' · versão superada' : ''}
          </p>
        </div>
        {!detalhe.vigente ? (
          <Botao variante="sutil" tamanho="pequeno" onClick={() => irPara('historico')}>
            Ver na aba Histórico
          </Botao>
        ) : (
          <Link href={`/campo/entrevistas/${parametros.id}/retificar`}>
            <Botao tamanho="pequeno">Retificar</Botao>
          </Link>
        )}
      </header>

      {/* Abas de VERDADE: painel que troca no mesmo documento. */}
      <div
        role="tablist"
        aria-label="Seções da entrevista"
        className="flex gap-1 border-b border-[hsl(var(--borda))]"
      >
        <button
          type="button"
          role="tab"
          aria-selected={abaAtiva === 'entrevista'}
          onClick={() => irPara('entrevista')}
          className={cn(
            'border-b-2 px-3 py-2 text-sm',
            abaAtiva === 'entrevista'
              ? 'border-[hsl(var(--acento))] font-medium text-[hsl(var(--acento))]'
              : 'border-transparent text-[hsl(var(--texto-secundario))] hover:text-[hsl(var(--texto))]',
          )}
        >
          Entrevista
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={abaAtiva === 'historico'}
          onClick={() => irPara('historico')}
          className={cn(
            'flex items-center gap-1.5 border-b-2 px-3 py-2 text-sm',
            abaAtiva === 'historico'
              ? 'border-[hsl(var(--acento))] font-medium text-[hsl(var(--acento))]'
              : 'border-transparent text-[hsl(var(--texto-secundario))] hover:text-[hsl(var(--texto))]',
          )}
        >
          Histórico
          {detalhe.versao > 1 ? (
            <span className="rounded-full bg-[hsl(var(--fundo-sutil))] px-1.5 text-xs">
              v{detalhe.versao}
            </span>
          ) : null}
        </button>
      </div>

      {abaAtiva === 'entrevista' ? (
        <div role="tabpanel" className="flex flex-col gap-4">
          <section className="flex flex-wrap gap-2">
            <span
              className={cn(
                'rounded-full px-2 py-0.5 text-xs',
                detalhe.status === 'INVALIDADA'
                  ? 'bg-[hsl(var(--perigo-sutil))] text-[hsl(var(--perigo))]'
                  : 'bg-[hsl(var(--apoiador-sutil))] text-[hsl(var(--apoiador))]',
              )}
            >
              {RotuloStatusEntrevista[detalhe.status]}
            </span>
            {detalhe.consentimento ? (
              <span className="inline-flex items-center gap-1 rounded-full bg-[hsl(var(--informacao-sutil))] px-2 py-0.5 text-xs text-[hsl(var(--informacao))]">
                <ShieldCheck className="size-3.5" aria-hidden="true" />
                Consentimento vigente (v{detalhe.consentimento.versao})
              </span>
            ) : (
              <span className="inline-flex items-center gap-1 rounded-full bg-[hsl(var(--perigo-sutil))] px-2 py-0.5 text-xs text-[hsl(var(--perigo))]">
                <TriangleAlert className="size-3.5" aria-hidden="true" />
                Sem consentimento vigente
              </span>
            )}
          </section>

          {detalhe.endereco ? (
            <p className="flex items-center gap-1.5 text-sm text-[hsl(var(--texto-secundario))]">
              <MapPin className="size-4 shrink-0" aria-hidden="true" />
              {detalhe.endereco.logradouro}, {detalhe.endereco.numero ?? 'SN'} —{' '}
              {detalhe.endereco.bairro}
            </p>
          ) : null}

          <section className="rounded-[var(--raio)] border border-[hsl(var(--borda))] p-4">
            <h2 className="mb-2 text-sm font-medium text-[hsl(var(--texto))]">Intenções de voto</h2>
            {detalhe.recusouResponder ? (
              <p className="text-sm text-[hsl(var(--texto-secundario))]">
                O entrevistado preferiu não responder.
              </p>
            ) : detalhe.intencoes.length === 0 ? (
              <p className="text-sm text-[hsl(var(--texto-fraco))]">Nenhuma intenção registrada.</p>
            ) : (
              <ul className="flex flex-col gap-1.5">
                {detalhe.intencoes.map((intencao) => (
                  <li
                    key={`${intencao.idCargo}-${intencao.posicao}`}
                    className="flex items-baseline justify-between text-sm"
                  >
                    <span className="text-[hsl(var(--texto-secundario))]">
                      {intencao.nomeCargo}
                      {intencao.posicao > 1 ? ` (${intencao.posicao}º voto)` : ''}
                    </span>
                    <span className="font-medium text-[hsl(var(--texto))]">{intencao.rotulo}</span>
                  </li>
                ))}
              </ul>
            )}
          </section>

          {detalhe.observacoes ? (
            <section>
              <h2 className="mb-1 text-sm font-medium text-[hsl(var(--texto))]">Observações</h2>
              <p className="whitespace-pre-wrap text-sm text-[hsl(var(--texto-secundario))]">
                {detalhe.observacoes}
              </p>
            </section>
          ) : null}

          {detalhe.alertas.length > 0 ? (
            <section className="rounded-[var(--raio)] border border-[hsl(var(--atencao))] bg-[hsl(var(--atencao-sutil))] p-3">
              <h2 className="mb-1 flex items-center gap-1.5 text-sm font-medium text-[hsl(var(--atencao))]">
                <TriangleAlert className="size-4" aria-hidden="true" />
                Alertas de qualidade
              </h2>
              <ul className="flex flex-col gap-1 text-sm text-[hsl(var(--texto))]">
                {detalhe.alertas.map((alerta, indice) => (
                  <li key={indice}>
                    {alerta.detalhe?.mensagem ?? alerta.tipo}
                    {alerta.revisado_em
                      ? ` — revisado (${alerta.procedente ? 'procedente' : 'improcedente'})`
                      : ' — pendente de revisão'}
                  </li>
                ))}
              </ul>
            </section>
          ) : null}

          <p className="text-xs text-[hsl(var(--texto-fraco))]">
            Coletado por {detalhe.entrevistador}
            {detalhe.duracaoSegundos !== null ? ` · ${detalhe.duracaoSegundos}s` : ''}
          </p>
        </div>
      ) : (
        <div role="tabpanel" className="flex flex-col gap-3">
          {carregandoHistorico && !historico ? (
            <EstadoCarregando mensagem="Carregando histórico…" linhas={3} />
          ) : (
            (historico?.versoes ?? [])
              .slice()
              .reverse()
              .map((versao) => (
                <article
                  key={versao.id}
                  className={cn(
                    'rounded-[var(--raio)] border p-3',
                    versao.vigente
                      ? 'border-[hsl(var(--acento))] bg-[hsl(var(--acento-sutil))]'
                      : 'border-[hsl(var(--borda))]',
                  )}
                >
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-sm font-medium text-[hsl(var(--texto))]">
                      Versão {versao.versao}
                    </span>
                    {versao.vigente ? (
                      <span className="rounded-full bg-[hsl(var(--acento))] px-2 py-0.5 text-xs text-[hsl(var(--acento-contraste))]">
                        vigente
                      </span>
                    ) : null}
                    <span className="text-xs text-[hsl(var(--texto-fraco))]">
                      {new Date(versao.criadoEm).toLocaleString('pt-BR')}
                    </span>
                    {versao.usuarioRetificador ? (
                      <span className="text-xs text-[hsl(var(--texto-fraco))]">
                        · retificado por {versao.usuarioRetificador}
                      </span>
                    ) : null}
                  </div>

                  {versao.motivoRetificacao ? (
                    <p className="mt-1 text-sm italic text-[hsl(var(--texto-secundario))]">
                      &quot;{versao.motivoRetificacao}&quot;
                    </p>
                  ) : null}

                  {versao.diferencas.length > 0 ? (
                    <ul className="mt-2 flex flex-col gap-1 border-t border-[hsl(var(--borda))] pt-2 text-sm">
                      {versao.diferencas.map((diferenca) => (
                        <li key={diferenca.campo} className="flex flex-wrap items-baseline gap-1.5">
                          <span className="font-medium text-[hsl(var(--texto))]">
                            {diferenca.rotulo}:
                          </span>
                          <span className="text-[hsl(var(--perigo))] line-through">
                            {diferenca.antes ?? '(vazio)'}
                          </span>
                          <span className="text-[hsl(var(--texto-fraco))]">→</span>
                          <span className="text-[hsl(var(--apoiador))]">
                            {diferenca.depois ?? '(vazio)'}
                          </span>
                        </li>
                      ))}
                    </ul>
                  ) : versao.versao === 1 ? (
                    <p className="mt-1 text-xs text-[hsl(var(--texto-fraco))]">
                      Registro original.
                    </p>
                  ) : null}
                </article>
              ))
          )}
        </div>
      )}
    </main>
  );
}
