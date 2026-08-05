'use client';

import { useEffect, useState } from 'react';
import type { FiltroGlobal } from '@jeleitoral/tipos';
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

interface Municipio {
  idIbge: number;
  nome: string;
  uf: string;
}

interface Candidato {
  id: string;
  nome_urna: string;
  numero_urna: number | null;
  cargo: string;
}

interface ComNomeENumero {
  id: string;
  numero: number;
  nome: string | null;
}

interface ComId {
  id: string;
  nome: string;
}

export interface OpcoesFiltro {
  uf: Array<{ valor: string; rotulo: string }>;
  idCargo: Array<{ valor: string; rotulo: string }>;
  idCandidato: Array<{ valor: string; rotulo: string }>;
  idMunicipio: Array<{ valor: string; rotulo: string }>;
  idZona: Array<{ valor: string; rotulo: string }>;
  idLocalVotacao: Array<{ valor: string; rotulo: string }>;
  idSecao: Array<{ valor: string; rotulo: string }>;
  idBairro: Array<{ valor: string; rotulo: string }>;
  idEquipe: Array<{ valor: string; rotulo: string }>;
}

const VAZIO: OpcoesFiltro = {
  uf: [],
  idCargo: [],
  idCandidato: [],
  idMunicipio: [],
  idZona: [],
  idLocalVotacao: [],
  idSecao: [],
  idBairro: [],
  idEquipe: [],
};

/**
 * Opções dos filtros, vindas das tabelas de referência — em cascata.
 *
 * `BarraFiltros` só desenha um `<select>` quando `opcoes[chave]` não está
 * vazio (`BarraFiltros.tsx:81`). Por isso 7 dos 9 campos nunca apareciam: só
 * `uf` e `idCargo` eram buscados, e os demais (candidato, município, zona,
 * local, seção, bairro, equipe) dependiam desta função nunca ter sido
 * completada. A cascata territorial (zona depende do município escolhido,
 * seção depende do local) evita pedir ao usuário uma seção antes de saber em
 * que município — e evita trazer as ~5.000 zonas do país de uma vez.
 */
export function useOpcoesFiltro(
  idCampanha: string | null,
  filtro: Partial<FiltroGlobal>,
): { opcoes: OpcoesFiltro; carregando: boolean } {
  const [opcoes, definirOpcoes] = useState<OpcoesFiltro>(VAZIO);
  const [carregando, definirCarregando] = useState(true);

  const uf = filtro.uf ?? null;
  const idMunicipio = filtro.idMunicipio ?? null;
  const idZona = filtro.idZona ?? null;
  const idLocalVotacao = filtro.idLocalVotacao ?? null;

  // Base: independe do recorte territorial, só da campanha.
  useEffect(() => {
    let ativo = true;
    definirCarregando(true);

    Promise.all([
      api.obter<Estado[]>('/territorio/estados').catch(() => [] as Estado[]),
      api.obter<Cargo[]>('/candidatos/cargos').catch(() => [] as Cargo[]),
      idCampanha
        ? api
            .obter<Candidato[]>(`/candidatos?idCampanha=${idCampanha}`)
            .catch(() => [] as Candidato[])
        : Promise.resolve([] as Candidato[]),
      idCampanha
        ? api
            .obter<ComId[]>(`/usuarios/equipes?idCampanha=${idCampanha}`)
            .catch(() => [] as ComId[])
        : Promise.resolve([] as ComId[]),
    ])
      .then(([estados, cargos, candidatos, equipes]) => {
        if (!ativo) return;
        definirOpcoes((anterior) => ({
          ...anterior,
          uf: estados.map((estado) => ({
            valor: estado.sigla,
            rotulo: `${estado.sigla} — ${estado.nome}`,
          })),
          idCargo: cargos.map((cargo) => ({ valor: cargo.id, rotulo: cargo.nome })),
          idCandidato: candidatos.map((candidato) => ({
            valor: candidato.id,
            rotulo: candidato.numero_urna
              ? `${candidato.nome_urna} (${candidato.numero_urna}) — ${candidato.cargo}`
              : `${candidato.nome_urna} — ${candidato.cargo}`,
          })),
          idEquipe: equipes.map((equipe) => ({ valor: equipe.id, rotulo: equipe.nome })),
        }));
      })
      .finally(() => {
        if (ativo) definirCarregando(false);
      });

    return () => {
      ativo = false;
    };
  }, [idCampanha]);

  // Município: depende da UF escolhida.
  useEffect(() => {
    if (!uf) {
      definirOpcoes((anterior) => ({ ...anterior, idMunicipio: [] }));
      return;
    }
    let ativo = true;
    api
      .obter<Municipio[]>(`/territorio/municipios?uf=${uf}`)
      .then((municipios) => {
        if (!ativo) return;
        definirOpcoes((anterior) => ({
          ...anterior,
          idMunicipio: municipios.map((municipio) => ({
            valor: String(municipio.idIbge),
            rotulo: municipio.nome,
          })),
        }));
      })
      .catch(() => undefined);
    return () => {
      ativo = false;
    };
  }, [uf]);

  // Zona e bairro: dependem do município escolhido.
  useEffect(() => {
    if (!idMunicipio) {
      definirOpcoes((anterior) => ({ ...anterior, idZona: [], idBairro: [] }));
      return;
    }
    let ativo = true;
    Promise.all([
      api.obter<ComNomeENumero[]>(`/territorio/zonas?idMunicipio=${idMunicipio}`).catch(() => []),
      idCampanha
        ? api
            .obter<ComId[]>(
              `/territorio/bairros?idCampanha=${idCampanha}&idMunicipio=${idMunicipio}`,
            )
            .catch(() => [] as ComId[])
        : Promise.resolve([] as ComId[]),
    ]).then(([zonas, bairros]) => {
      if (!ativo) return;
      definirOpcoes((anterior) => ({
        ...anterior,
        idZona: zonas.map((zona) => ({
          valor: zona.id,
          rotulo: zona.nome ? `${zona.numero} — ${zona.nome}` : String(zona.numero),
        })),
        idBairro: bairros.map((bairro) => ({ valor: bairro.id, rotulo: bairro.nome })),
      }));
    });
    return () => {
      ativo = false;
    };
  }, [idCampanha, idMunicipio]);

  // Local de votação: depende do município (e, se escolhida, da zona).
  useEffect(() => {
    if (!idMunicipio) {
      definirOpcoes((anterior) => ({ ...anterior, idLocalVotacao: [] }));
      return;
    }
    let ativo = true;
    const zonaParam = idZona ? `&idZona=${idZona}` : '';
    api
      .obter<ComNomeENumero[]>(`/territorio/locais-votacao?idMunicipio=${idMunicipio}${zonaParam}`)
      .then((locais) => {
        if (!ativo) return;
        definirOpcoes((anterior) => ({
          ...anterior,
          idLocalVotacao: locais.map((local) => ({ valor: local.id, rotulo: local.nome ?? '' })),
        }));
      })
      .catch(() => undefined);
    return () => {
      ativo = false;
    };
  }, [idMunicipio, idZona]);

  // Seção: depende do local de votação escolhido.
  useEffect(() => {
    if (!idLocalVotacao) {
      definirOpcoes((anterior) => ({ ...anterior, idSecao: [] }));
      return;
    }
    let ativo = true;
    api
      .obter<ComNomeENumero[]>(`/territorio/secoes?idLocalVotacao=${idLocalVotacao}`)
      .then((secoes) => {
        if (!ativo) return;
        definirOpcoes((anterior) => ({
          ...anterior,
          idSecao: secoes.map((secao) => ({ valor: secao.id, rotulo: String(secao.numero) })),
        }));
      })
      .catch(() => undefined);
    return () => {
      ativo = false;
    };
  }, [idLocalVotacao]);

  return { opcoes, carregando };
}
