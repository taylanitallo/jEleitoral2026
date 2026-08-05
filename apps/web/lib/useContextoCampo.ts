'use client';

import { useEffect, useState } from 'react';
import { api, ErroDaApi } from './api';
import { filaOffline } from './filaOffline';

export interface CargoContexto {
  id: string;
  nome: string;
  quantidadeVotosPermitida: number;
  digitosNumeroUrna: number;
}

export interface CandidatoContexto {
  id: string;
  idCargo: string;
  nomeUrna: string;
  numeroUrna: string;
  siglaPartido: string | null;
  proprio: boolean;
}

export interface ContextoCampo {
  idCampanha: string;
  campanha: {
    id: string;
    nome: string;
    uf: string | null;
    idMunicipio: number | null;
    anoPleito: number;
  };
  cargos: CargoContexto[];
  candidatos: CandidatoContexto[];
  consentimento: { id: string; versao: string; texto: string } | null;
  atualizadoEm: string;
}

const JANELA_DESATUALIZADO_MS = 48 * 60 * 60 * 1000;

/**
 * Contexto de campo (cargos, candidatos, consentimento), com queda para o
 * cache do aparelho quando não há rede.
 *
 * Existe porque escolher candidato pelo nome (em vez de digitar o número às
 * cegas) só funciona se a lista já estiver no aparelho ANTES de faltar sinal —
 * numa casa sem cobertura não dá para buscar a lista na hora. Rede primeiro,
 * sempre: o cache é a queda, não a fonte.
 *
 * Sem rede e sem cache (aparelho novo, primeira porta do dia, já sem sinal), o
 * chamador recebe `contexto: null` e o formulário cai para o número livre de
 * antes — degradação, não bloqueio. Entrevista perdida é pior que número
 * solto, e o trigger de resolução no banco resolve o número depois.
 */
export function useContextoCampo(idCampanha: string | null): {
  contexto: ContextoCampo | null;
  origem: 'rede' | 'cache' | null;
  desatualizadoEm: number | null;
  carregando: boolean;
} {
  const [contexto, definirContexto] = useState<ContextoCampo | null>(null);
  const [origem, definirOrigem] = useState<'rede' | 'cache' | null>(null);
  const [carregando, definirCarregando] = useState(true);

  useEffect(() => {
    if (!idCampanha) {
      definirContexto(null);
      definirOrigem(null);
      definirCarregando(false);
      return;
    }

    let ativo = true;
    definirCarregando(true);

    async function carregar(): Promise<void> {
      try {
        const resposta = await api.obter<Omit<ContextoCampo, 'idCampanha'>>(
          `/campo/contexto?idCampanha=${idCampanha}`,
        );
        if (!ativo) return;
        const item: ContextoCampo = { idCampanha: idCampanha as string, ...resposta };
        definirContexto(item);
        definirOrigem('rede');
        // Não aguarda: gravar o cache não pode atrasar a tela.
        void filaOffline.gravarContexto(item);
      } catch (falha) {
        if (!ativo) return;
        if (!(falha instanceof ErroDaApi)) throw falha;

        const doCache = await filaOffline.lerContexto<ContextoCampo>(idCampanha as string);
        if (!ativo) return;
        if (doCache) {
          definirContexto(doCache);
          definirOrigem('cache');
        } else {
          definirContexto(null);
          definirOrigem(null);
        }
      } finally {
        if (ativo) definirCarregando(false);
      }
    }

    void carregar();
    return () => {
      ativo = false;
    };
  }, [idCampanha]);

  const desatualizadoEm =
    origem === 'cache' && contexto ? Date.now() - new Date(contexto.atualizadoEm).getTime() : null;

  return {
    contexto,
    origem,
    desatualizadoEm:
      desatualizadoEm !== null && desatualizadoEm > JANELA_DESATUALIZADO_MS
        ? desatualizadoEm
        : null,
    carregando,
  };
}
