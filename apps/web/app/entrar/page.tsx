'use client';

import { KeyRound, LogIn, ShieldCheck } from 'lucide-react';
import { useRouter, useSearchParams } from 'next/navigation';
import { Suspense, useState } from 'react';
import { Botao, EstadoCarregando } from '@jeleitoral/ui';
import { api, ErroDaApi } from '@/lib/api';

interface RespostaLogin {
  precisaMfa: boolean;
  idFator?: string;
  idDesafio?: string;
}

function FormularioEntrada(): JSX.Element {
  const roteador = useRouter();
  const parametros = useSearchParams();
  const destino = parametros.get('destino') ?? '/painel';

  const [email, definirEmail] = useState('');
  const [senha, definirSenha] = useState('');
  const [codigo, definirCodigo] = useState('');
  const [desafio, definirDesafio] = useState<{ idFator: string; idDesafio: string } | null>(null);
  const [erro, definirErro] = useState<string | null>(null);
  const [enviando, definirEnviando] = useState(false);

  async function entrar(evento: React.FormEvent): Promise<void> {
    evento.preventDefault();
    definirEnviando(true);
    definirErro(null);
    try {
      const resposta = await api.enviar<RespostaLogin>('/autenticacao/entrar', { email, senha });
      if (resposta.precisaMfa && resposta.idFator && resposta.idDesafio) {
        definirDesafio({ idFator: resposta.idFator, idDesafio: resposta.idDesafio });
        return;
      }
      roteador.replace(destino);
    } catch (problema) {
      definirErro(
        problema instanceof ErroDaApi
          ? problema.corpo.mensagem
          : 'Não foi possível entrar. Tente novamente.',
      );
    } finally {
      definirEnviando(false);
    }
  }

  async function verificarCodigo(evento: React.FormEvent): Promise<void> {
    evento.preventDefault();
    if (!desafio) return;
    definirEnviando(true);
    definirErro(null);
    try {
      await api.enviar('/autenticacao/mfa/verificar', { ...desafio, codigo });
      roteador.replace(destino);
    } catch (problema) {
      definirErro(
        problema instanceof ErroDaApi ? problema.corpo.mensagem : 'Código inválido.',
      );
    } finally {
      definirEnviando(false);
    }
  }

  const classeCampo =
    'h-11 w-full rounded-[var(--raio)] border border-[hsl(var(--borda))] bg-[hsl(var(--superficie))] px-3 text-base text-[hsl(var(--texto))]';

  return (
    <div className="w-full max-w-sm">
      <header className="mb-6">
        <h1 className="text-2xl font-semibold text-[hsl(var(--texto))]">jEleitoral</h1>
        <p className="mt-1 text-sm text-[hsl(var(--texto-secundario))]">
          {desafio ? 'Verificação em duas etapas' : 'Entre com sua conta da campanha'}
        </p>
      </header>

      {erro ? (
        <p
          role="alert"
          className="mb-4 rounded-[var(--raio)] border border-[hsl(var(--perigo)/0.3)] bg-[hsl(var(--perigo-sutil))] px-3 py-2 text-sm text-[hsl(var(--perigo))]"
        >
          {erro}
        </p>
      ) : null}

      {desafio ? (
        <form onSubmit={(evento) => void verificarCodigo(evento)} className="flex flex-col gap-4">
          <div>
            <label htmlFor="codigo" className="mb-1 block text-sm text-[hsl(var(--texto-secundario))]">
              Código do aplicativo autenticador
            </label>
            <input
              id="codigo"
              value={codigo}
              onChange={(evento) => definirCodigo(evento.target.value.replace(/\D/g, '').slice(0, 6))}
              inputMode="numeric"
              autoComplete="one-time-code"
              autoFocus
              className={`${classeCampo} text-center tracking-[0.4em]`}
              required
            />
          </div>
          <Botao
            variante="primario"
            tamanho="grande"
            type="submit"
            carregando={enviando}
            disabled={codigo.length !== 6}
            className="w-full"
          >
            <ShieldCheck />
            Confirmar
          </Botao>
          <p className="text-xs text-[hsl(var(--texto-fraco))]">
            Perfis com acesso administrativo ou financeiro exigem verificação em duas etapas.
          </p>
        </form>
      ) : (
        <form onSubmit={(evento) => void entrar(evento)} className="flex flex-col gap-4">
          <div>
            <label htmlFor="email" className="mb-1 block text-sm text-[hsl(var(--texto-secundario))]">
              E-mail
            </label>
            <input
              id="email"
              type="email"
              value={email}
              onChange={(evento) => definirEmail(evento.target.value)}
              autoComplete="username"
              autoFocus
              className={classeCampo}
              required
            />
          </div>
          <div>
            <label htmlFor="senha" className="mb-1 block text-sm text-[hsl(var(--texto-secundario))]">
              Senha
            </label>
            <input
              id="senha"
              type="password"
              value={senha}
              onChange={(evento) => definirSenha(evento.target.value)}
              autoComplete="current-password"
              className={classeCampo}
              required
            />
          </div>
          <Botao
            variante="primario"
            tamanho="grande"
            type="submit"
            carregando={enviando}
            className="w-full"
          >
            <LogIn />
            Entrar
          </Botao>
          <p className="flex items-start gap-1.5 text-xs text-[hsl(var(--texto-fraco))]">
            <KeyRound className="mt-0.5 size-3.5 shrink-0" aria-hidden="true" />
            O acesso é criado por convite do administrador da campanha. Não há autocadastro.
          </p>
        </form>
      )}
    </div>
  );
}

export default function PaginaEntrar(): JSX.Element {
  return (
    <main className="flex min-h-dvh items-center justify-center px-4 py-10">
      <Suspense fallback={<EstadoCarregando mensagem="Carregando…" linhas={3} />}>
        <FormularioEntrada />
      </Suspense>
    </main>
  );
}
