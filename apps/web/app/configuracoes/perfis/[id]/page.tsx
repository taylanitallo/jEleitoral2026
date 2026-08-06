'use client';

import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useMemo, useState } from 'react';
import { ArrowLeft } from 'lucide-react';
import { BarraAcoes, Botao, EstadoCarregando, EstadoErro } from '@jeleitoral/ui';
import {
  EscopoPermissao,
  RotuloEscopoPermissao,
  type EscopoPermissao as Escopo,
} from '@jeleitoral/tipos';
import { classeControle } from '@/componentes/cadastro/Campo';
import { ErroDaApi, api } from '@/lib/api';
import { useListagem } from '@/lib/useListagem';

interface Perfil {
  id: string;
  nome: string;
  sistema_padrao: boolean;
}

interface LinhaPermissao {
  chave: string;
  modulo: string;
  descricao: string;
  escopo: Escopo | null;
}

/**
 * Matriz de permissões de um perfil — uma linha por permissão do catálogo,
 * agrupada por módulo, um seletor de escopo por linha.
 *
 * Equivalente ao editor de atribuições do jConv, mas sobre o PERFIL: no
 * jEleitoral a permissão é do perfil, não de cada usuário — atribuir um
 * usuário a um perfil já lhe dá tudo o que o perfil concede.
 */
export default function PaginaPermissoesPerfil(): JSX.Element {
  const parametros = useParams<{ id: string }>();
  const idPerfil = parametros.id;

  const { dados: perfis } = useListagem<Perfil[]>('/perfis');
  const {
    dados: permissoes,
    carregando,
    erro,
    recarregar,
  } = useListagem<LinhaPermissao[]>(`/perfis/${idPerfil}/permissoes`);

  const [alteracoes, definirAlteracoes] = useState<Record<string, Escopo | null>>({});
  const [salvando, definirSalvando] = useState(false);
  const [erroSalvar, definirErroSalvar] = useState<string | null>(null);
  const [salvo, definirSalvo] = useState(false);

  const perfil = perfis?.find((item) => item.id === idPerfil);

  const porModulo = useMemo(() => {
    const mapa = new Map<string, LinhaPermissao[]>();
    for (const linha of permissoes ?? []) {
      const lista = mapa.get(linha.modulo) ?? [];
      lista.push(linha);
      mapa.set(linha.modulo, lista);
    }
    return mapa;
  }, [permissoes]);

  function valorAtual(linha: LinhaPermissao): Escopo | null {
    return linha.chave in alteracoes ? alteracoes[linha.chave]! : linha.escopo;
  }

  async function salvar(): Promise<void> {
    if (!permissoes) return;
    definirSalvando(true);
    definirErroSalvar(null);
    definirSalvo(false);
    try {
      const corpo = permissoes.map((linha) => ({
        chave: linha.chave,
        escopo: linha.chave in alteracoes ? alteracoes[linha.chave] : linha.escopo,
      }));
      await api.atualizar(`/perfis/${idPerfil}/permissoes`, corpo);
      definirAlteracoes({});
      definirSalvo(true);
      recarregar();
    } catch (falha) {
      definirErroSalvar(
        falha instanceof ErroDaApi ? falha.corpo.mensagem : 'Não foi possível salvar.',
      );
    } finally {
      definirSalvando(false);
    }
  }

  return (
    <main className="mx-auto flex max-w-3xl flex-col gap-4 px-4 py-6">
      <Link
        href="/configuracoes/perfis"
        className="inline-flex w-fit items-center gap-1 text-sm text-[hsl(var(--texto-secundario))] hover:text-[hsl(var(--texto))]"
      >
        <ArrowLeft className="size-4" aria-hidden="true" />
        Voltar aos perfis
      </Link>

      <BarraAcoes titulo={perfil ? `Permissões — ${perfil.nome}` : 'Permissões do perfil'} />

      {erro ? (
        <EstadoErro
          mensagem={erro.corpo.mensagem}
          idCorrelacao={erro.corpo.idCorrelacao}
          semConexao={erro.semConexao}
          aoTentarNovamente={recarregar}
        />
      ) : carregando && !permissoes ? (
        <EstadoCarregando mensagem="Carregando permissões…" linhas={6} />
      ) : (
        <>
          {Array.from(porModulo.entries()).map(([modulo, linhas]) => (
            <section
              key={modulo}
              className="flex flex-col gap-2 rounded-[var(--raio)] border border-[hsl(var(--borda))] bg-[hsl(var(--superficie))] p-3"
            >
              <h2 className="text-sm font-medium text-[hsl(var(--texto))]">{modulo}</h2>
              <ul className="flex flex-col gap-2">
                {linhas.map((linha) => (
                  <li key={linha.chave} className="flex items-center gap-3">
                    <span className="flex-1 text-sm text-[hsl(var(--texto-secundario))]">
                      {linha.descricao}
                    </span>
                    <select
                      value={valorAtual(linha) ?? ''}
                      onChange={(evento) =>
                        definirAlteracoes((atual) => ({
                          ...atual,
                          [linha.chave]: (evento.target.value || null) as Escopo | null,
                        }))
                      }
                      className={`${classeControle} w-56`}
                    >
                      <option value="">Nenhuma</option>
                      {EscopoPermissao.options.map((valor) => (
                        <option key={valor} value={valor}>
                          {RotuloEscopoPermissao[valor]}
                        </option>
                      ))}
                    </select>
                  </li>
                ))}
              </ul>
            </section>
          ))}

          {erroSalvar ? (
            <p role="alert" className="text-sm text-[hsl(var(--perigo))]">
              {erroSalvar}
            </p>
          ) : null}
          {salvo ? (
            <p role="status" className="text-sm text-[hsl(var(--apoiador))]">
              Salvo. Quem usa este perfil recebe as novas permissões já na próxima ação — a sessão é
              renovada em silêncio, sem precisar sair e entrar de novo.
            </p>
          ) : null}

          <div>
            <Botao onClick={() => void salvar()} carregando={salvando}>
              Salvar
            </Botao>
          </div>
        </>
      )}
    </main>
  );
}
