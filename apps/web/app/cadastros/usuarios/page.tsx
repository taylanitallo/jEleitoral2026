'use client';

import { Copy, KeyRound, UserPlus } from 'lucide-react';
import { useState } from 'react';
import { Botao, EstadoCarregando, cn } from '@jeleitoral/ui';
import type { PaginaDe } from '@jeleitoral/tipos';
import { Campo, classeControle } from '@/componentes/cadastro/Campo';
import { Tabela, type Coluna } from '@/componentes/cadastro/Tabela';
import { ErroDaApi, api } from '@/lib/api';
import { useListagem } from '@/lib/useListagem';

interface Usuario {
  id: string;
  nome: string;
  email: string;
  telefone: string | null;
  perfil: string;
  id_perfil: string;
  ativo: boolean;
  ultimo_acesso: string | null;
}

interface Perfil {
  id: string;
  nome: string;
  descricao: string | null;
}

/**
 * Cadastro da equipe da campanha.
 *
 * A tela existe porque, sem ela, a única porta para criar usuário era o script
 * de bootstrap com a chave de serviço — ou seja, o coordenador dependia de
 * alguém com acesso ao terminal para pôr cada entrevistador no sistema. Numa
 * campanha que monta equipe em dias, isso é um gargalo real.
 *
 * A senha aparece **uma vez**, na tela, logo após o cadastro. Não há e-mail de
 * convite porque não há serviço de envio configurado, e o limite padrão do
 * Supabase é de dois e-mails por hora — cadastrar vinte entrevistadores por
 * e-mail levaria dez horas. O coordenador copia e repassa.
 */
export default function PaginaUsuarios(): JSX.Element {
  const { dados, carregando, erro, recarregar } = useListagem<PaginaDe<Usuario>>('/usuarios');
  const { dados: perfis } = useListagem<Perfil[]>('/usuarios/perfis');

  const [aberto, definirAberto] = useState(false);
  const [nome, definirNome] = useState('');
  const [email, definirEmail] = useState('');
  const [telefone, definirTelefone] = useState('');
  const [idPerfil, definirIdPerfil] = useState('');
  const [salvando, definirSalvando] = useState(false);
  const [erroFormulario, definirErroFormulario] = useState<string | null>(null);
  const [credencial, definirCredencial] = useState<{
    nome: string;
    email: string;
    senha: string;
  } | null>(null);

  async function cadastrar(evento: React.FormEvent): Promise<void> {
    evento.preventDefault();
    definirSalvando(true);
    definirErroFormulario(null);
    try {
      const criado = await api.enviar<{ nome: string; email: string; senhaInicial: string }>(
        '/usuarios',
        {
          nome,
          email,
          telefone: telefone || undefined,
          idPerfil,
          campanhas: [],
        },
      );
      definirCredencial({
        nome: criado.nome,
        email: criado.email,
        senha: criado.senhaInicial,
      });
      definirNome('');
      definirEmail('');
      definirTelefone('');
      definirAberto(false);
      recarregar();
    } catch (falha) {
      definirErroFormulario(
        falha instanceof ErroDaApi ? falha.message : 'Não foi possível cadastrar.',
      );
    } finally {
      definirSalvando(false);
    }
  }

  async function alternarAtivo(usuario: Usuario): Promise<void> {
    await api.atualizar(`/usuarios/${usuario.id}`, { ativo: !usuario.ativo });
    recarregar();
  }

  async function redefinirSenha(usuario: Usuario): Promise<void> {
    const resposta = await api.enviar<{ senhaInicial: string }>(
      `/usuarios/${usuario.id}/redefinir-senha`,
      {},
    );
    definirCredencial({
      nome: usuario.nome,
      email: usuario.email,
      senha: resposta.senhaInicial,
    });
  }

  const colunas: Array<Coluna<Usuario>> = [
    { chave: 'nome', rotulo: 'Nome', render: (u) => u.nome },
    { chave: 'email', rotulo: 'E-mail', render: (u) => u.email },
    { chave: 'perfil', rotulo: 'Perfil', render: (u) => u.perfil },
    {
      chave: 'ativo',
      rotulo: 'Situação',
      render: (u) => (
        <span
          className={cn(
            'rounded-full px-2 py-0.5 text-xs',
            u.ativo
              ? 'bg-[hsl(var(--sucesso-sutil))] text-[hsl(var(--sucesso))]'
              : 'bg-[hsl(var(--nao-informou-sutil))] text-[hsl(var(--nao-informou))]',
          )}
        >
          {u.ativo ? 'Ativo' : 'Inativo'}
        </span>
      ),
    },
    {
      chave: 'acoes',
      rotulo: 'Ações',
      render: (u) => (
        <div className="flex gap-1">
          <Botao variante="sutil" tamanho="pequeno" onClick={() => void redefinirSenha(u)}>
            <KeyRound className="size-3.5" aria-hidden="true" />
            Nova senha
          </Botao>
          <Botao variante="sutil" tamanho="pequeno" onClick={() => void alternarAtivo(u)}>
            {u.ativo ? 'Desativar' : 'Reativar'}
          </Botao>
        </div>
      ),
    },
  ];

  return (
    <main className="mx-auto flex max-w-4xl flex-col gap-4 px-4 py-6">
      <header className="flex items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold text-[hsl(var(--texto))]">Equipe</h1>
          <p className="text-sm text-[hsl(var(--texto-secundario))]">
            Quem tem acesso ao sistema nesta organização.
          </p>
        </div>
        <Botao onClick={() => definirAberto((valor) => !valor)}>
          <UserPlus className="size-4" aria-hidden="true" />
          Cadastrar
        </Botao>
      </header>

      {/*
        A credencial fica numa faixa persistente, e não num alerta que some.
        Ela aparece uma única vez: se o coordenador piscar e ela desaparecer, a
        única saída é gerar outra senha — e ele vai achar que o sistema falhou.
      */}
      {credencial ? (
        <div
          role="status"
          className="flex flex-col gap-2 rounded-[var(--raio)] border border-[hsl(var(--sucesso)/0.4)] bg-[hsl(var(--sucesso-sutil))] p-3"
        >
          <p className="text-sm font-medium text-[hsl(var(--sucesso))]">
            Acesso criado para {credencial.nome}. Anote agora — esta senha não será exibida de novo.
          </p>
          <div className="flex flex-wrap items-center gap-2 font-mono text-sm">
            <span className="rounded bg-[hsl(var(--superficie))] px-2 py-1">
              {credencial.email}
            </span>
            <span className="rounded bg-[hsl(var(--superficie))] px-2 py-1">
              {credencial.senha}
            </span>
            <Botao
              variante="sutil"
              tamanho="pequeno"
              onClick={() =>
                void navigator.clipboard.writeText(`${credencial.email} / ${credencial.senha}`)
              }
            >
              <Copy className="size-3.5" aria-hidden="true" />
              Copiar
            </Botao>
          </div>
          <Botao variante="sutil" tamanho="pequeno" onClick={() => definirCredencial(null)}>
            Já anotei
          </Botao>
        </div>
      ) : null}

      {aberto ? (
        <form
          onSubmit={(evento) => void cadastrar(evento)}
          className="flex flex-col gap-3 rounded-[var(--raio)] border border-[hsl(var(--borda))] p-4"
        >
          <Campo id="nome" rotulo="Nome completo" obrigatorio>
            <input
              id="nome"
              className={classeControle}
              value={nome}
              onChange={(e) => definirNome(e.target.value)}
              required
              minLength={3}
            />
          </Campo>

          <Campo id="email" rotulo="E-mail" obrigatorio dica="Será o login da pessoa.">
            <input
              id="email"
              type="email"
              className={classeControle}
              value={email}
              onChange={(e) => definirEmail(e.target.value)}
              required
            />
          </Campo>

          <Campo id="telefone" rotulo="Telefone">
            <input
              id="telefone"
              className={classeControle}
              value={telefone}
              onChange={(e) => definirTelefone(e.target.value)}
            />
          </Campo>

          <Campo
            id="perfil"
            rotulo="Perfil"
            obrigatorio
            dica="Define o que a pessoa enxerga e pode fazer."
          >
            <select
              id="perfil"
              className={classeControle}
              value={idPerfil}
              onChange={(e) => definirIdPerfil(e.target.value)}
              required
            >
              <option value="">Selecione…</option>
              {(perfis ?? []).map((perfil) => (
                <option key={perfil.id} value={perfil.id}>
                  {perfil.nome}
                </option>
              ))}
            </select>
          </Campo>

          {erroFormulario ? (
            <p role="alert" className="text-sm text-[hsl(var(--perigo))]">
              {erroFormulario}
            </p>
          ) : null}

          <div className="flex gap-2">
            <Botao type="submit" carregando={salvando}>
              Criar acesso
            </Botao>
            <Botao variante="sutil" onClick={() => definirAberto(false)}>
              Cancelar
            </Botao>
          </div>
        </form>
      ) : null}

      {carregando ? (
        <EstadoCarregando />
      ) : erro ? (
        <p role="alert" className="text-sm text-[hsl(var(--perigo))]">
          {erro.message}
        </p>
      ) : (
        <Tabela colunas={colunas} linhas={dados?.itens ?? []} chaveDe={(u) => u.id} />
      )}
    </main>
  );
}
