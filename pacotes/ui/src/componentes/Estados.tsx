'use client';

import { AlertCircle, Inbox, SearchX, WifiOff } from 'lucide-react';
import { cn } from '../utilitarios/cn';
import { Botao } from './Botao';

/**
 * Estados vazio, carregando e de erro.
 *
 * Toda listagem do sistema usa estes três. Tela branca sem explicação é
 * defeito, não "carregando" — em campo, com sinal ruim, o entrevistador
 * precisa saber se o problema é dele, da rede ou do sistema.
 */

export function EstadoCarregando({
  mensagem = 'Carregando…',
  linhas = 5,
  className,
}: {
  mensagem?: string;
  linhas?: number;
  className?: string;
}): JSX.Element {
  return (
    <div className={cn('space-y-2 py-2', className)} role="status" aria-live="polite">
      <span className="sr-only">{mensagem}</span>
      {Array.from({ length: linhas }).map((_, indice) => (
        <div
          // A lista é estática e puramente decorativa; o índice serve de chave.
          key={indice}
          className="h-10 animate-pulse rounded-[var(--raio)] bg-[hsl(var(--fundo-sutil))]"
          aria-hidden="true"
        />
      ))}
    </div>
  );
}

export function EstadoVazio({
  titulo = 'Nada por aqui ainda',
  descricao,
  rotuloAcao,
  aoAcionar,
  filtrado = false,
  className,
}: {
  titulo?: string;
  descricao?: React.ReactNode;
  rotuloAcao?: string;
  aoAcionar?: () => void;
  /** Muda a mensagem quando o vazio é consequência de filtro, não de base vazia. */
  filtrado?: boolean;
  className?: string;
}): JSX.Element {
  const Icone = filtrado ? SearchX : Inbox;
  return (
    <div
      className={cn(
        'flex flex-col items-center justify-center gap-2 rounded-[var(--raio)] border border-dashed border-[hsl(var(--borda))] px-6 py-12 text-center',
        className,
      )}
    >
      <Icone className="size-8 text-[hsl(var(--texto-fraco))]" aria-hidden="true" />
      <p className="text-sm font-medium text-[hsl(var(--texto))]">
        {filtrado ? 'Nenhum resultado para os filtros aplicados' : titulo}
      </p>
      {descricao ? (
        <p className="max-w-sm text-sm text-[hsl(var(--texto-secundario))]">{descricao}</p>
      ) : null}
      {rotuloAcao && aoAcionar ? (
        <Botao variante="primario" onClick={aoAcionar} className="mt-2">
          {rotuloAcao}
        </Botao>
      ) : null}
    </div>
  );
}

export function EstadoErro({
  titulo = 'Não foi possível carregar',
  mensagem,
  idCorrelacao,
  aoTentarNovamente,
  semConexao = false,
  className,
}: {
  titulo?: string;
  mensagem?: string;
  /** Identificador do log — permite ao suporte achar a requisição exata. */
  idCorrelacao?: string;
  aoTentarNovamente?: () => void;
  semConexao?: boolean;
  className?: string;
}): JSX.Element {
  const Icone = semConexao ? WifiOff : AlertCircle;
  return (
    <div
      role="alert"
      className={cn(
        'flex flex-col items-center justify-center gap-2 rounded-[var(--raio)] border border-[hsl(var(--perigo)/0.3)] bg-[hsl(var(--perigo-sutil))] px-6 py-10 text-center',
        className,
      )}
    >
      <Icone className="size-8 text-[hsl(var(--perigo))]" aria-hidden="true" />
      <p className="text-sm font-medium text-[hsl(var(--texto))]">
        {semConexao ? 'Sem conexão' : titulo}
      </p>
      <p className="max-w-md text-sm text-[hsl(var(--texto-secundario))]">
        {semConexao
          ? 'Os dados preenchidos ficam salvos no aparelho e sobem sozinhos quando a conexão voltar.'
          : (mensagem ?? 'Tente novamente em instantes.')}
      </p>
      {idCorrelacao ? (
        <p className="text-xs text-[hsl(var(--texto-fraco))]">
          Código para o suporte: <code className="font-mono">{idCorrelacao}</code>
        </p>
      ) : null}
      {aoTentarNovamente ? (
        <Botao variante="secundario" onClick={aoTentarNovamente} className="mt-2">
          Tentar novamente
        </Botao>
      ) : null}
    </div>
  );
}
