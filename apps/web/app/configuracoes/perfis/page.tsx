'use client';

import Link from 'next/link';
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
import { Campo, classeControle } from '@/componentes/cadastro/Campo';
import { Tabela } from '@/componentes/cadastro/Tabela';
import { ErroDaApi, api } from '@/lib/api';
import { useListagem } from '@/lib/useListagem';

interface Perfil {
  id: string;
  nome: string;
  descricao: string | null;
  sistema_padrao: boolean;
  total_usuarios: number;
}

/**
 * Perfis de acesso — a aba "Perfis de acesso" de Configurações.
 *
 * Perfis-semente (`sistema_padrao`) não podem ser excluídos — só editados —
 * e o botão de excluir some para eles em vez de aparecer e falhar depois.
 */
export default function PaginaConfiguracoesPerfis(): JSX.Element {
  const { dados, carregando, erro, recarregar } = useListagem<Perfil[]>('/perfis');
  const confirmacao = useConfirmacao<Perfil>();

  const [emEdicao, definirEmEdicao] = useState<Perfil | null>(null);
  const [formularioAberto, definirFormularioAberto] = useState(false);
  const [salvando, definirSalvando] = useState(false);
  const [erroSalvar, definirErroSalvar] = useState<string | null>(null);
  const [erroExcluir, definirErroExcluir] = useState<string | null>(null);

  function abrirNovo(): void {
    definirEmEdicao(null);
    definirErroSalvar(null);
    definirFormularioAberto(true);
  }

  function abrirEdicao(perfil: Perfil): void {
    definirEmEdicao(perfil);
    definirErroSalvar(null);
    definirFormularioAberto(true);
  }

  async function salvar(evento: React.FormEvent<HTMLFormElement>): Promise<void> {
    evento.preventDefault();
    const formulario = new FormData(evento.currentTarget);
    const corpo = {
      nome: String(formulario.get('nome')).trim(),
      descricao: String(formulario.get('descricao') ?? '').trim() || undefined,
    };

    definirSalvando(true);
    definirErroSalvar(null);
    try {
      if (emEdicao) await api.atualizar(`/perfis/${emEdicao.id}`, corpo);
      else await api.enviar('/perfis', corpo);
      definirFormularioAberto(false);
      recarregar();
    } catch (falha) {
      definirErroSalvar(
        falha instanceof ErroDaApi ? falha.corpo.mensagem : 'Não foi possível salvar.',
      );
    } finally {
      definirSalvando(false);
    }
  }

  async function excluirConfirmado(): Promise<void> {
    const perfil = confirmacao.alvo;
    if (!perfil) return;
    definirErroExcluir(null);
    try {
      await api.excluir(`/perfis/${perfil.id}`);
      confirmacao.fechar();
      recarregar();
    } catch (falha) {
      definirErroExcluir(
        falha instanceof ErroDaApi ? falha.corpo.mensagem : 'Não foi possível excluir.',
      );
    }
  }

  return (
    <main className="mx-auto flex max-w-4xl flex-col gap-4 px-4 py-6">
      <BarraAcoes
        titulo="Configurações — Perfis de acesso"
        subtitulo={dados ? `${dados.length} perfil(is)` : undefined}
        atualizar={{ aoAcionar: recarregar, carregando }}
        novo={{ aoAcionar: abrirNovo, rotulo: 'Novo perfil' }}
      />

      {formularioAberto ? (
        <form
          onSubmit={(evento) => void salvar(evento)}
          className="grid gap-3 rounded-[var(--raio)] border border-[hsl(var(--borda))] bg-[hsl(var(--superficie))] p-4 sm:grid-cols-2"
        >
          <Campo id="nome" rotulo="Nome" obrigatorio>
            <input
              id="nome"
              name="nome"
              required
              minLength={2}
              maxLength={60}
              defaultValue={emEdicao?.nome ?? ''}
              className={classeControle}
            />
          </Campo>

          <Campo id="descricao" rotulo="Descrição">
            <input
              id="descricao"
              name="descricao"
              maxLength={200}
              defaultValue={emEdicao?.descricao ?? ''}
              className={classeControle}
            />
          </Campo>

          {erroSalvar ? (
            <p role="alert" className="text-sm text-[hsl(var(--perigo))] sm:col-span-2">
              {erroSalvar}
            </p>
          ) : null}

          <div className="flex gap-2 sm:col-span-2">
            <Botao type="submit" carregando={salvando}>
              {emEdicao ? 'Salvar alterações' : 'Criar perfil'}
            </Botao>
            <Botao type="button" variante="sutil" onClick={() => definirFormularioAberto(false)}>
              Cancelar
            </Botao>
          </div>
        </form>
      ) : null}

      {erroExcluir ? (
        <p role="alert" className="text-sm text-[hsl(var(--perigo))]">
          {erroExcluir}
        </p>
      ) : null}

      {erro ? (
        <EstadoErro
          mensagem={erro.corpo.mensagem}
          idCorrelacao={erro.corpo.idCorrelacao}
          semConexao={erro.semConexao}
          aoTentarNovamente={recarregar}
        />
      ) : carregando && !dados ? (
        <EstadoCarregando mensagem="Carregando perfis…" linhas={4} />
      ) : !dados || dados.length === 0 ? (
        <EstadoVazio titulo="Nenhum perfil cadastrado" />
      ) : (
        <Tabela
          linhas={dados}
          chaveDe={(linha) => linha.id}
          colunas={[
            { chave: 'nome', rotulo: 'Nome', render: (linha) => linha.nome },
            { chave: 'descricao', rotulo: 'Descrição', render: (linha) => linha.descricao ?? '—' },
            {
              chave: 'usuarios',
              rotulo: 'Usuários',
              numerico: true,
              render: (linha) => linha.total_usuarios,
            },
            {
              chave: 'acoes',
              rotulo: 'Ações',
              render: (linha) => (
                <span className="flex gap-1">
                  <Link href={`/configuracoes/perfis/${linha.id}`}>
                    <Botao variante="sutil" tamanho="pequeno">
                      Permissões
                    </Botao>
                  </Link>
                  <Botao variante="sutil" tamanho="pequeno" onClick={() => abrirEdicao(linha)}>
                    Editar
                  </Botao>
                  {!linha.sistema_padrao ? (
                    <Botao
                      variante="sutil"
                      tamanho="pequeno"
                      onClick={() => confirmacao.solicitar(linha)}
                    >
                      Excluir
                    </Botao>
                  ) : null}
                </span>
              ),
            },
          ]}
        />
      )}

      <ModalConfirmacao
        aberto={confirmacao.aberto}
        aoMudarAbertura={(aberto) => {
          if (!aberto) confirmacao.fechar();
        }}
        titulo={`Excluir "${confirmacao.alvo?.nome ?? ''}"?`}
        descricao="A exclusão não pode ser desfeita."
        consequencia="Só é possível excluir um perfil sem nenhum usuário vinculado a ele."
        rotuloConfirmar="Excluir"
        destrutivo
        aoConfirmar={excluirConfirmado}
      />
    </main>
  );
}
