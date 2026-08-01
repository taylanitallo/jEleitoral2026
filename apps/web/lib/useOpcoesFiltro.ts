'use client';

import { useEffect, useState } from 'react';
import { api } from './api';

interface Estado {
  idIbge: number;
  sigla: string;
  nome: string;
  regiao: string;
  municipios: number;
}

interface Cargo {
  id: string;
  codigoTse: number;
  nome: string;
  abrangencia: string;
}

export interface OpcoesFiltro {
  uf: Array<{ valor: string; rotulo: string }>;
  idCargo: Array<{ valor: string; rotulo: string }>;
}

const VAZIO: OpcoesFiltro = { uf: [], idCargo: [] };

/**
 * Opções dos filtros, vindas das tabelas de referência.
 *
 * Antes as listas eram literais no código — e como a demonstração só trazia São
 * Paulo, o filtro exibia uma única UF, o que se lê como "o sistema só atende SP".
 * Não era: as tabelas estavam vazias.
 *
 * Se as listas vierem vazias, é carga de referência faltando (`pnpm
 * ibge:sincronizar` na API). A tela deve dizer isso em vez de fingir opções, para
 * que ninguém filtre por um estado que o banco não conhece.
 */
export function useOpcoesFiltro(): { opcoes: OpcoesFiltro; carregando: boolean } {
  const [opcoes, definirOpcoes] = useState<OpcoesFiltro>(VAZIO);
  const [carregando, definirCarregando] = useState(true);

  useEffect(() => {
    let ativo = true;

    Promise.all([
      api.obter<Estado[]>('/territorio/estados').catch(() => [] as Estado[]),
      api.obter<Cargo[]>('/candidatos/cargos').catch(() => [] as Cargo[]),
    ])
      .then(([estados, cargos]) => {
        if (!ativo) return;
        definirOpcoes({
          uf: estados.map((estado) => ({
            valor: estado.sigla,
            rotulo: `${estado.sigla} — ${estado.nome}`,
          })),
          idCargo: cargos.map((cargo) => ({ valor: cargo.id, rotulo: cargo.nome })),
        });
      })
      .finally(() => {
        if (ativo) definirCarregando(false);
      });

    return () => {
      ativo = false;
    };
  }, []);

  return { opcoes, carregando };
}
