'use client';

import type { ReactNode } from 'react';

export interface Coluna<T> {
  chave: string;
  rotulo: string;
  /** Valores numéricos recebem `data-numerico` para alinhamento e fonte tabular. */
  numerico?: boolean;
  render: (linha: T) => ReactNode;
}

/**
 * Tabela de listagem dos cadastros.
 *
 * Deliberadamente simples: cabeçalho fixo, zebra sutil e rolagem horizontal
 * própria. A rolagem é do contêiner e não da página — uma tabela larga não pode
 * empurrar o corpo do documento para o lado no celular.
 */
export function Tabela<T>({
  colunas,
  linhas,
  chaveDe,
  aoClicar,
}: {
  colunas: Array<Coluna<T>>;
  linhas: T[];
  chaveDe: (linha: T) => string;
  aoClicar?: (linha: T) => void;
}): JSX.Element {
  return (
    <div className="overflow-x-auto rounded-[var(--raio)] border border-[hsl(var(--borda))]">
      <table className="w-full border-collapse text-sm">
        <thead>
          <tr className="border-b border-[hsl(var(--borda))] bg-[hsl(var(--fundo-sutil))]">
            {colunas.map((coluna) => (
              <th
                key={coluna.chave}
                scope="col"
                className={`whitespace-nowrap px-3 py-2 font-medium text-[hsl(var(--texto-secundario))] ${
                  coluna.numerico ? 'text-right' : 'text-left'
                }`}
              >
                {coluna.rotulo}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {linhas.map((linha) => (
            <tr
              key={chaveDe(linha)}
              onClick={aoClicar ? () => aoClicar(linha) : undefined}
              className={`border-b border-[hsl(var(--borda))] last:border-0 ${
                aoClicar ? 'cursor-pointer hover:bg-[hsl(var(--fundo-sutil))]' : ''
              }`}
            >
              {colunas.map((coluna) => (
                <td
                  key={coluna.chave}
                  data-numerico={coluna.numerico ? '' : undefined}
                  className={`px-3 py-2 text-[hsl(var(--texto))] ${
                    coluna.numerico ? 'text-right' : ''
                  }`}
                >
                  {coluna.render(linha)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
