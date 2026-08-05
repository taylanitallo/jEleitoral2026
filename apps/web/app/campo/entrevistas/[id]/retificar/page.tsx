'use client';

import { ArrowLeft } from 'lucide-react';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { useEffect, useMemo, useState } from 'react';
import { Botao, EstadoCarregando, EstadoErro } from '@jeleitoral/ui';
import {
  ClassificacaoEleitor,
  RotuloClassificacaoEleitor,
  type TipoIntencao,
} from '@jeleitoral/tipos';
import { Campo, classeControle } from '@/componentes/cadastro/Campo';
import {
  SeletorCandidato,
  type CandidatoDoCargo,
  type EscolhaIntencao,
} from '@/componentes/campo/SeletorCandidato';
import { ErroDaApi, api } from '@/lib/api';
import { useListagem } from '@/lib/useListagem';
import { useSessao } from '@/lib/useSessao';

interface Detalhe {
  entrevistado: { nome: string; classificacao: ClassificacaoEleitor };
  recusouResponder: boolean;
  observacoes: string | null;
  intencoes: Array<{
    idCargo: string;
    posicao: number;
    tipo: TipoIntencao;
    idCandidato: string | null;
    numeroDeclarado: string | null;
  }>;
}

interface Contexto {
  cargos: Array<{
    id: string;
    nome: string;
    quantidadeVotosPermitida: number;
    digitosNumeroUrna: number;
  }>;
  candidatos: Array<CandidatoDoCargo & { idCargo: string }>;
}

/**
 * Retificação — cria a próxima versão, não edita a atual.
 *
 * Vai direto para a API (`POST .../retificar`), nunca para a fila offline: é
 * operação de escritório, feita com rede, e a auditoria precisa da resposta
 * na hora, não de uma sincronização que pode demorar.
 */
export default function PaginaRetificarEntrevista(): JSX.Element {
  const parametros = useParams<{ id: string }>();
  const roteador = useRouter();
  const { idCampanha, carregando: carregandoSessao } = useSessao();

  const {
    dados: detalhe,
    carregando: carregandoDetalhe,
    erro,
  } = useListagem<Detalhe>(`/campo/entrevistas/${parametros.id}`);
  const { dados: contexto } = useListagem<Contexto>(
    idCampanha ? `/campo/contexto?idCampanha=${idCampanha}` : null,
  );

  const [nome, definirNome] = useState('');
  const [classificacao, definirClassificacao] = useState<ClassificacaoEleitor>('NAO_INFORMOU');
  const [recusouResponder, definirRecusou] = useState(false);
  const [observacoes, definirObservacoes] = useState('');
  const [intencoes, definirIntencoes] = useState<Record<string, Array<EscolhaIntencao | null>>>({});
  const [motivo, definirMotivo] = useState('');
  const [salvando, definirSalvando] = useState(false);
  const [erroSalvar, definirErroSalvar] = useState<string | null>(null);

  // Pré-preenche assim que o detalhe e o contexto (cargos) chegam.
  useEffect(() => {
    if (!detalhe || !contexto) return;
    definirNome(detalhe.entrevistado.nome);
    definirClassificacao(detalhe.entrevistado.classificacao);
    definirRecusou(detalhe.recusouResponder);
    definirObservacoes(detalhe.observacoes ?? '');

    const porCargo: Record<string, Array<EscolhaIntencao | null>> = {};
    for (const cargo of contexto.cargos) {
      porCargo[cargo.id] = Array<EscolhaIntencao | null>(cargo.quantidadeVotosPermitida).fill(null);
    }
    for (const intencao of detalhe.intencoes) {
      const lista = porCargo[intencao.idCargo];
      if (!lista) continue;
      const indice = intencao.posicao - 1;
      if (indice >= 0 && indice < lista.length) {
        lista[indice] = {
          idCandidato: intencao.idCandidato ?? undefined,
          numeroDeclarado: intencao.numeroDeclarado ?? undefined,
          tipo: intencao.tipo,
        };
      }
    }
    definirIntencoes(porCargo);
    // Só quando os dados chegam pela primeira vez — depois disso o formulário
    // é a fonte da verdade, e recarregar não pode apagar o que o coordenador
    // já digitou.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [detalhe, contexto]);

  const candidatosPorCargo = useMemo(() => {
    const mapa = new Map<string, CandidatoDoCargo[]>();
    for (const candidato of contexto?.candidatos ?? []) {
      const lista = mapa.get(candidato.idCargo) ?? [];
      lista.push(candidato);
      mapa.set(candidato.idCargo, lista);
    }
    return mapa;
  }, [contexto]);

  const podeSalvar = nome.trim().length >= 3 && motivo.trim().length >= 10 && !salvando;

  async function salvar(evento: React.FormEvent): Promise<void> {
    evento.preventDefault();
    if (!podeSalvar) return;
    definirSalvando(true);
    definirErroSalvar(null);
    try {
      const resposta = await api.enviar<{ idNovaVersao: string }>(
        `/campo/entrevistas/${parametros.id}/retificar`,
        {
          motivo: motivo.trim(),
          entrevistado: { nome: nome.trim(), classificacao },
          recusouResponder,
          observacoes: observacoes.trim() || undefined,
          intencoes: Object.entries(intencoes).flatMap(([idCargo, slots]) =>
            slots
              .filter((slot): slot is EscolhaIntencao => slot !== null)
              .map((slot) => ({
                idCargo,
                idCandidato: slot.idCandidato,
                numeroDeclarado: slot.numeroDeclarado,
                tipo: slot.tipo,
                grauCerteza: 3,
                votoDefinido: false,
              })),
          ),
        },
      );
      roteador.push(`/campo/entrevistas/${resposta.idNovaVersao}?aba=historico`);
    } catch (falha) {
      definirErroSalvar(
        falha instanceof ErroDaApi ? falha.corpo.mensagem : 'Não foi possível retificar.',
      );
    } finally {
      definirSalvando(false);
    }
  }

  if (carregandoSessao || (carregandoDetalhe && !detalhe)) return <EstadoCarregando />;

  if (erro || !detalhe || !contexto) {
    return (
      <main className="mx-auto max-w-2xl px-4 py-6">
        <EstadoErro
          mensagem={erro?.corpo.mensagem ?? 'Entrevista não encontrada.'}
          idCorrelacao={erro?.corpo.idCorrelacao}
          semConexao={erro?.semConexao}
        />
      </main>
    );
  }

  return (
    <main className="mx-auto flex max-w-2xl flex-col gap-4 px-4 py-6">
      <Link
        href={`/campo/entrevistas/${parametros.id}`}
        className="inline-flex w-fit items-center gap-1 text-sm text-[hsl(var(--texto-secundario))] hover:text-[hsl(var(--texto))]"
      >
        <ArrowLeft className="size-4" aria-hidden="true" />
        Cancelar e voltar
      </Link>

      <header>
        <h1 className="text-xl font-semibold text-[hsl(var(--texto))]">Retificar entrevista</h1>
        <p className="text-sm text-[hsl(var(--texto-secundario))]">
          O registro original não é alterado — esta correção vira uma nova versão, visível no
          histórico ao lado da anterior.
        </p>
      </header>

      <form onSubmit={(evento) => void salvar(evento)} className="flex flex-col gap-4">
        <Campo id="nome" rotulo="Nome do entrevistado" obrigatorio>
          <input
            id="nome"
            value={nome}
            onChange={(evento) => definirNome(evento.target.value)}
            required
            minLength={3}
            className={classeControle}
          />
        </Campo>

        <Campo id="classificacao" rotulo="Classificação">
          <select
            id="classificacao"
            value={classificacao}
            onChange={(evento) => definirClassificacao(evento.target.value as ClassificacaoEleitor)}
            className={classeControle}
          >
            {ClassificacaoEleitor.options.map((opcao) => (
              <option key={opcao} value={opcao}>
                {RotuloClassificacaoEleitor[opcao]}
              </option>
            ))}
          </select>
        </Campo>

        <label className="flex items-center gap-2 text-sm text-[hsl(var(--texto-secundario))]">
          <input
            type="checkbox"
            checked={recusouResponder}
            onChange={(evento) => definirRecusou(evento.target.checked)}
            className="size-4"
          />
          Preferiu não responder
        </label>

        {!recusouResponder ? (
          <fieldset className="flex flex-col gap-3">
            <legend className="mb-1 text-sm font-medium text-[hsl(var(--texto))]">
              Intenções de voto
            </legend>
            {contexto.cargos.map((cargo) => {
              const slots = intencoes[cargo.id] ?? [];
              const candidatosDoCargo = candidatosPorCargo.get(cargo.id) ?? [];

              function definirSlot(indice: number, escolha: EscolhaIntencao | null): void {
                definirIntencoes((atual) => {
                  const lista = [...(atual[cargo.id] ?? [])];
                  lista[indice] = escolha;
                  return { ...atual, [cargo.id]: lista };
                });
              }

              return (
                <div key={cargo.id} className="flex flex-col gap-2">
                  {slots.map((slot, indice) => (
                    <div key={indice}>
                      <label className="mb-1 block text-sm text-[hsl(var(--texto-secundario))]">
                        {cargo.nome}
                        {slots.length > 1 ? ` (${indice + 1}º voto)` : ''}
                      </label>
                      <SeletorCandidato
                        idCargo={`${cargo.id}-${indice}`}
                        candidatos={candidatosDoCargo}
                        valor={slot}
                        excluir={slots
                          .filter((_, i) => i !== indice)
                          .map((s) => s?.idCandidato)
                          .filter((v): v is string => Boolean(v))}
                        digitosNumeroUrna={cargo.digitosNumeroUrna}
                        aoEscolher={(escolha) => definirSlot(indice, escolha)}
                      />
                    </div>
                  ))}
                </div>
              );
            })}
          </fieldset>
        ) : null}

        <Campo id="observacoes" rotulo="Observações">
          <textarea
            id="observacoes"
            value={observacoes}
            onChange={(evento) => definirObservacoes(evento.target.value)}
            className={`${classeControle} min-h-20`}
          />
        </Campo>

        <Campo
          id="motivo"
          rotulo="Por que está retificando?"
          obrigatorio
          dica="Fica visível no histórico, junto com a versão anterior."
        >
          <textarea
            id="motivo"
            value={motivo}
            onChange={(evento) => definirMotivo(evento.target.value)}
            required
            minLength={10}
            maxLength={500}
            placeholder="Ex.: entrevistado corrigiu por telefone o candidato ao Senado."
            className={`${classeControle} min-h-16`}
          />
        </Campo>

        {erroSalvar ? (
          <p role="alert" className="text-sm text-[hsl(var(--perigo))]">
            {erroSalvar}
          </p>
        ) : null}

        <div className="flex gap-2">
          <Botao type="submit" carregando={salvando} disabled={!podeSalvar}>
            Salvar retificação
          </Botao>
        </div>
      </form>
    </main>
  );
}
