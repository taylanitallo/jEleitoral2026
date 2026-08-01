'use client';

import { useState } from 'react';
import {
  BarraAcoes,
  Botao,
  EstadoCarregando,
  EstadoErro,
  EstadoVazio,
  ModalConfirmacao,
  useConfirmacao,
} from '@jeleitoral/ui';
import { Tabela } from '@/componentes/cadastro/Tabela';
import { api } from '@/lib/api';
import { useListagem } from '@/lib/useListagem';
import { useSessao } from '@/lib/useSessao';

interface Bairro {
  id: string;
  nome: string;
  id_municipio: number;
  criado_em: string;
  cadastrado_por: string | null;
  domicilios: string;
}

interface Logradouro {
  id: string;
  nome: string;
  nome_canonico: string;
  cep: string | null;
  bairro: string;
  criado_em: string;
  cadastrado_por: string | null;
  domicilios: string;
}

interface Curadoria {
  bairros: Bairro[];
  logradouros: Logradouro[];
}

type Alvo = { id: string; nome: string; entidade: 'bairro' | 'logradouro' };

function formatarData(iso: string): string {
  return new Date(iso).toLocaleDateString('pt-BR');
}

/**
 * Curadoria do território.
 *
 * O entrevistador cadastra na rua, com pressa, no celular. "Rua São José",
 * "R. Sao Jose" e "rua sao jose" chegam como três logradouros — e três
 * logradouros significam três denominadores diferentes na projeção do bairro.
 * Esta tela é onde alguém do escritório confere e junta.
 */
export default function PaginaTerritorio(): JSX.Element {
  const { idCampanha, carregando: carregandoSessao } = useSessao();
  const { dados, carregando, erro, recarregar } = useListagem<Curadoria>(
    idCampanha ? `/territorio/curadoria?idCampanha=${idCampanha}` : null,
  );
  const confirmacao = useConfirmacao<Alvo>();

  const [mesclando, definirMesclando] = useState<Alvo | null>(null);
  const [idDestino, definirIdDestino] = useState('');

  async function validarConfirmado(): Promise<void> {
    const alvo = confirmacao.alvo;
    if (!alvo) return;
    await api.enviar('/territorio/validar', { id: alvo.id, entidade: alvo.entidade });
    confirmacao.fechar();
    recarregar();
  }

  async function mesclar(evento: React.FormEvent<HTMLFormElement>): Promise<void> {
    evento.preventDefault();
    if (!mesclando || !idDestino) return;
    await api.enviar('/territorio/mesclar', {
      idOrigem: mesclando.id,
      idDestino,
      entidade: mesclando.entidade,
    });
    definirMesclando(null);
    definirIdDestino('');
    recarregar();
  }

  if (carregandoSessao) return <EstadoCarregando mensagem="Carregando…" linhas={3} />;

  if (!idCampanha) {
    return (
      <main className="mx-auto max-w-6xl px-4 py-6">
        <EstadoVazio titulo="Nenhuma campanha vinculada" />
      </main>
    );
  }

  const pendentes = (dados?.bairros.length ?? 0) + (dados?.logradouros.length ?? 0);

  return (
    <main className="mx-auto flex max-w-6xl flex-col gap-4 px-4 py-6">
      <BarraAcoes
        titulo="Território — curadoria"
        subtitulo={dados ? `${pendentes} registro(s) aguardando conferência` : undefined}
        atualizar={{ aoAcionar: recarregar, carregando }}
        imprimir={{}}
      />

      {mesclando ? (
        <form
          onSubmit={(evento) => void mesclar(evento)}
          className="flex flex-wrap items-end gap-2 rounded-[var(--raio)] border border-[hsl(var(--borda))] bg-[hsl(var(--superficie))] p-4"
        >
          <div className="flex flex-1 flex-col gap-1">
            <label htmlFor="idDestino" className="text-sm font-medium text-[hsl(var(--texto))]">
              Absorver “{mesclando.nome}” em qual registro?
            </label>
            <input
              id="idDestino"
              value={idDestino}
              onChange={(evento) => definirIdDestino(evento.target.value)}
              placeholder="Identificador do registro que permanece"
              required
              className="w-full rounded-[var(--raio)] border border-[hsl(var(--borda))] bg-[hsl(var(--superficie))] px-2.5 py-1.5 text-sm text-[hsl(var(--texto))]"
            />
            <p className="text-xs text-[hsl(var(--texto-fraco))]">
              Os domicílios migram para o destino. A origem não é apagada — um aparelho com fila
              offline ainda pode referenciá-la.
            </p>
          </div>
          <Botao type="submit">Mesclar</Botao>
          <Botao type="button" variante="sutil" onClick={() => definirMesclando(null)}>
            Cancelar
          </Botao>
        </form>
      ) : null}

      {erro ? (
        <EstadoErro
          mensagem={erro.corpo.mensagem}
          idCorrelacao={erro.corpo.idCorrelacao}
          semConexao={erro.semConexao}
          aoTentarNovamente={recarregar}
        />
      ) : carregando && !dados ? (
        <EstadoCarregando mensagem="Carregando fila de curadoria…" linhas={4} />
      ) : pendentes === 0 ? (
        <EstadoVazio
          titulo="Nada pendente"
          descricao="Todo bairro e logradouro cadastrado em campo já foi conferido."
        />
      ) : (
        <>
          {dados && dados.bairros.length > 0 ? (
            <section className="flex flex-col gap-2">
              <h2 className="text-sm font-medium text-[hsl(var(--texto))]">
                Bairros ({dados.bairros.length})
              </h2>
              <Tabela
                linhas={dados.bairros}
                chaveDe={(linha) => linha.id}
                colunas={[
                  { chave: 'nome', rotulo: 'Nome', render: (linha) => linha.nome },
                  {
                    chave: 'municipio',
                    rotulo: 'Município (IBGE)',
                    numerico: true,
                    render: (linha) => linha.id_municipio,
                  },
                  {
                    chave: 'domicilios',
                    rotulo: 'Domicílios',
                    numerico: true,
                    render: (linha) => linha.domicilios,
                  },
                  {
                    chave: 'autor',
                    rotulo: 'Cadastrado por',
                    render: (linha) => linha.cadastrado_por ?? '—',
                  },
                  {
                    chave: 'data',
                    rotulo: 'Em',
                    render: (linha) => formatarData(linha.criado_em),
                  },
                  {
                    chave: 'acoes',
                    rotulo: 'Ações',
                    render: (linha) => (
                      <span className="flex gap-1">
                        <Botao
                          variante="sutil"
                          tamanho="pequeno"
                          onClick={() =>
                            confirmacao.solicitar({
                              id: linha.id,
                              nome: linha.nome,
                              entidade: 'bairro',
                            })
                          }
                        >
                          Validar
                        </Botao>
                        <Botao
                          variante="sutil"
                          tamanho="pequeno"
                          onClick={() =>
                            definirMesclando({
                              id: linha.id,
                              nome: linha.nome,
                              entidade: 'bairro',
                            })
                          }
                        >
                          Mesclar
                        </Botao>
                      </span>
                    ),
                  },
                ]}
              />
            </section>
          ) : null}

          {dados && dados.logradouros.length > 0 ? (
            <section className="flex flex-col gap-2">
              <h2 className="text-sm font-medium text-[hsl(var(--texto))]">
                Logradouros ({dados.logradouros.length})
              </h2>
              <Tabela
                linhas={dados.logradouros}
                chaveDe={(linha) => linha.id}
                colunas={[
                  { chave: 'nome', rotulo: 'Nome', render: (linha) => linha.nome },
                  { chave: 'bairro', rotulo: 'Bairro', render: (linha) => linha.bairro },
                  { chave: 'cep', rotulo: 'CEP', render: (linha) => linha.cep ?? '—' },
                  {
                    chave: 'domicilios',
                    rotulo: 'Domicílios',
                    numerico: true,
                    render: (linha) => linha.domicilios,
                  },
                  {
                    chave: 'autor',
                    rotulo: 'Cadastrado por',
                    render: (linha) => linha.cadastrado_por ?? '—',
                  },
                  {
                    chave: 'data',
                    rotulo: 'Em',
                    render: (linha) => formatarData(linha.criado_em),
                  },
                  {
                    chave: 'acoes',
                    rotulo: 'Ações',
                    render: (linha) => (
                      <span className="flex gap-1">
                        <Botao
                          variante="sutil"
                          tamanho="pequeno"
                          onClick={() =>
                            confirmacao.solicitar({
                              id: linha.id,
                              nome: linha.nome,
                              entidade: 'logradouro',
                            })
                          }
                        >
                          Validar
                        </Botao>
                        <Botao
                          variante="sutil"
                          tamanho="pequeno"
                          onClick={() =>
                            definirMesclando({
                              id: linha.id,
                              nome: linha.nome,
                              entidade: 'logradouro',
                            })
                          }
                        >
                          Mesclar
                        </Botao>
                      </span>
                    ),
                  },
                ]}
              />
            </section>
          ) : null}
        </>
      )}

      <ModalConfirmacao
        aberto={confirmacao.aberto}
        aoMudarAbertura={(aberto) => {
          if (!aberto) confirmacao.fechar();
        }}
        titulo={`Validar “${confirmacao.alvo?.nome ?? ''}”?`}
        descricao="O registro passa a ser considerado forma canônica e some da fila de curadoria."
        rotuloConfirmar="Validar"
        aoConfirmar={validarConfirmado}
      />
    </main>
  );
}
