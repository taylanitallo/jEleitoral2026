'use client';

import { Check, ChevronDown, X } from 'lucide-react';
import { useMemo, useState } from 'react';
import { cn } from '@jeleitoral/ui';
import type { TipoIntencao } from '@jeleitoral/tipos';
import { normalizarNomePessoa } from '@jeleitoral/utilitarios';

export interface CandidatoDoCargo {
  id: string;
  nomeUrna: string;
  numeroUrna: string;
  siglaPartido: string | null;
  proprio: boolean;
}

/** O que o formulário grava. `idCandidato` ausente é uma resposta explícita. */
export interface EscolhaIntencao {
  idCandidato?: string;
  numeroDeclarado?: string;
  tipo: TipoIntencao;
}

const OPCOES_FIXAS: Array<{
  tipo: Exclude<TipoIntencao, 'CANDIDATO' | 'NAO_CADASTRADO'>;
  rotulo: string;
}> = [
  { tipo: 'BRANCO', rotulo: 'Branco' },
  { tipo: 'NULO', rotulo: 'Nulo' },
  { tipo: 'INDECISO', rotulo: 'Ainda não decidiu' },
  { tipo: 'NAO_RESPONDEU', rotulo: 'Não quis dizer' },
];

function rotuloDaEscolha(
  valor: EscolhaIntencao | null,
  candidatos: readonly CandidatoDoCargo[],
): string | null {
  if (!valor) return null;
  if (valor.tipo === 'CANDIDATO' && valor.idCandidato) {
    const candidato = candidatos.find((c) => c.id === valor.idCandidato);
    return candidato ? `${candidato.numeroUrna} — ${candidato.nomeUrna}` : null;
  }
  if (valor.tipo === 'NAO_CADASTRADO') return `${valor.numeroDeclarado} (não cadastrado)`;
  return OPCOES_FIXAS.find((o) => o.tipo === valor.tipo)?.rotulo ?? null;
}

/**
 * Escolha de candidato para uma intenção de voto, por número OU por nome.
 *
 * Existe porque o formulário antigo só tinha um campo numérico livre: o
 * entrevistador digitava um número às cegas, sem nunca ver a quem ele
 * pertencia, e o número virava `numero_declarado` sem nunca virar
 * `id_candidato` — a raiz do defeito que a migration 0028 corrigiu no banco.
 * Aqui é onde a correção também aparece na tela.
 *
 * **"Outro número" é a saída de emergência**, não um atalho: mantém o
 * comportamento antigo (número livre) para quando o eleitor cita um candidato
 * que ainda não foi cadastrado. O servidor resolve isso como
 * `NAO_CADASTRADO`, preservando o número em vez de descartá-lo.
 */
export function SeletorCandidato({
  idCargo,
  candidatos,
  valor,
  excluir = [],
  digitosNumeroUrna,
  aoEscolher,
}: {
  idCargo: string;
  candidatos: readonly CandidatoDoCargo[];
  valor: EscolhaIntencao | null;
  excluir?: readonly string[];
  digitosNumeroUrna: number;
  aoEscolher: (escolha: EscolhaIntencao | null) => void;
}): JSX.Element {
  const [aberto, definirAberto] = useState(false);
  const [busca, definirBusca] = useState('');
  const [outroNumero, definirOutroNumero] = useState('');

  const disponiveis = useMemo(
    () => candidatos.filter((c) => !excluir.includes(c.id)),
    [candidatos, excluir],
  );

  const filtrados = useMemo(() => {
    const termo = busca.trim();
    if (!termo) return disponiveis;
    if (/^\d+$/.test(termo)) {
      return disponiveis.filter((c) => c.numeroUrna.startsWith(termo));
    }
    const termoNormalizado = normalizarNomePessoa(termo);
    return disponiveis.filter((c) => normalizarNomePessoa(c.nomeUrna).includes(termoNormalizado));
  }, [disponiveis, busca]);

  const rotulo = rotuloDaEscolha(valor, candidatos);

  function escolher(escolha: EscolhaIntencao | null): void {
    aoEscolher(escolha);
    definirAberto(false);
    definirBusca('');
    definirOutroNumero('');
  }

  return (
    <div className="relative">
      <button
        type="button"
        id={`cargo-${idCargo}`}
        onClick={() => definirAberto((v) => !v)}
        className={cn(
          'flex h-11 w-full items-center justify-between rounded-[var(--raio)] border px-3 text-left text-base',
          'border-[hsl(var(--borda))] bg-[hsl(var(--superficie))] text-[hsl(var(--texto))]',
          !rotulo && 'text-[hsl(var(--texto-fraco))]',
        )}
        aria-haspopup="listbox"
        aria-expanded={aberto}
      >
        <span className="truncate">{rotulo ?? 'Escolher…'}</span>
        <span className="flex items-center gap-1">
          {valor ? (
            <span
              role="button"
              tabIndex={0}
              onClick={(evento) => {
                evento.stopPropagation();
                escolher(null);
              }}
              onKeyDown={(evento) => {
                if (evento.key === 'Enter' || evento.key === ' ') {
                  evento.stopPropagation();
                  escolher(null);
                }
              }}
              aria-label="Limpar escolha"
              className="rounded p-0.5 text-[hsl(var(--texto-fraco))] hover:text-[hsl(var(--texto))]"
            >
              <X className="size-4" aria-hidden="true" />
            </span>
          ) : null}
          <ChevronDown
            className="size-4 shrink-0 text-[hsl(var(--texto-fraco))]"
            aria-hidden="true"
          />
        </span>
      </button>

      {aberto ? (
        <div
          role="listbox"
          className="absolute z-20 mt-1 w-full overflow-hidden rounded-[var(--raio)] border border-[hsl(var(--borda))] bg-[hsl(var(--superficie))] shadow-[var(--sombra-media)]"
        >
          <input
            autoFocus
            value={busca}
            onChange={(evento) => definirBusca(evento.target.value)}
            placeholder="Número ou nome"
            inputMode="search"
            className="h-11 w-full border-b border-[hsl(var(--borda))] bg-transparent px-3 text-base text-[hsl(var(--texto))] outline-none"
          />

          <div className="max-h-64 overflow-y-auto">
            {filtrados.length === 0 ? (
              <p className="px-3 py-2 text-sm text-[hsl(var(--texto-fraco))]">
                Nenhum candidato encontrado.
              </p>
            ) : (
              filtrados.map((candidato) => (
                <button
                  key={candidato.id}
                  type="button"
                  role="option"
                  aria-selected={valor?.idCandidato === candidato.id}
                  onClick={() => escolher({ idCandidato: candidato.id, tipo: 'CANDIDATO' })}
                  className={cn(
                    'flex w-full items-center gap-2 px-3 py-2 text-left text-sm hover:bg-[hsl(var(--fundo-sutil))]',
                    valor?.idCandidato === candidato.id && 'bg-[hsl(var(--acento-sutil))]',
                  )}
                >
                  <span className="w-14 shrink-0 font-medium tabular-nums text-[hsl(var(--texto))]">
                    {candidato.numeroUrna}
                  </span>
                  <span className="flex-1 truncate text-[hsl(var(--texto))]">
                    {candidato.nomeUrna}
                  </span>
                  {candidato.siglaPartido ? (
                    <span className="shrink-0 text-xs text-[hsl(var(--texto-fraco))]">
                      {candidato.siglaPartido}
                    </span>
                  ) : null}
                  {candidato.proprio ? (
                    <span className="shrink-0 rounded-full bg-[hsl(var(--acento-sutil))] px-1.5 py-0.5 text-[10px] font-medium text-[hsl(var(--acento))]">
                      nosso
                    </span>
                  ) : null}
                  {valor?.idCandidato === candidato.id ? (
                    <Check
                      className="size-4 shrink-0 text-[hsl(var(--acento))]"
                      aria-hidden="true"
                    />
                  ) : null}
                </button>
              ))
            )}
          </div>

          <div className="border-t border-[hsl(var(--borda))]">
            {OPCOES_FIXAS.map((opcao) => (
              <button
                key={opcao.tipo}
                type="button"
                role="option"
                aria-selected={valor?.tipo === opcao.tipo}
                onClick={() => escolher({ tipo: opcao.tipo })}
                className="flex w-full items-center px-3 py-2 text-left text-sm text-[hsl(var(--texto-secundario))] hover:bg-[hsl(var(--fundo-sutil))]"
              >
                {opcao.rotulo}
              </button>
            ))}

            {/*
             * A saída de emergência: eleitor citou um número que não está na
             * lista. Vira NAO_CADASTRADO no servidor, com o número preservado
             * — sinal de concorrente a cadastrar, não erro a descartar.
             */}
            <div className="flex items-center gap-2 px-3 py-2">
              <input
                value={outroNumero}
                onChange={(evento) =>
                  definirOutroNumero(
                    evento.target.value.replace(/\D+/g, '').slice(0, digitosNumeroUrna),
                  )
                }
                placeholder="Outro número"
                inputMode="numeric"
                className="h-9 flex-1 rounded border border-[hsl(var(--borda))] bg-[hsl(var(--fundo))] px-2 text-sm text-[hsl(var(--texto))]"
              />
              <button
                type="button"
                disabled={outroNumero.length === 0}
                onClick={() => escolher({ numeroDeclarado: outroNumero, tipo: 'NAO_CADASTRADO' })}
                className="h-9 shrink-0 rounded bg-[hsl(var(--acento))] px-3 text-sm text-[hsl(var(--acento-contraste))] disabled:opacity-50"
              >
                Usar
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
