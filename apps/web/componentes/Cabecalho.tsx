'use client';

import {
  Building2,
  CalendarDays,
  ClipboardList,
  FileBarChart,
  Image,
  LayoutDashboard,
  LogOut,
  Map,
  Moon,
  Compass,
  Sun,
  Megaphone,
  Target,
  TrendingUp,
  UserSquare2,
  Users,
  Home,
  Wallet,
} from 'lucide-react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { Botao, cn, useTema } from '@jeleitoral/ui';
import { api } from '@/lib/api';

interface Sessao {
  email: string;
  perfil: string;
  permissoes: Record<string, string>;
  ehProvedor: boolean;
}

const ITENS = [
  { href: '/painel', rotulo: 'Painel', icone: LayoutDashboard, permissao: 'campo.ler' },
  {
    href: '/campo/entrevista',
    rotulo: 'Entrevista',
    icone: ClipboardList,
    permissao: 'campo.gerenciar',
  },
  {
    href: '/cadastros/campanhas',
    rotulo: 'Campanhas',
    icone: Building2,
    permissao: 'campanhas.gerenciar',
  },
  { href: '/cadastros/usuarios', rotulo: 'Equipe', icone: Users, permissao: 'usuarios.ler' },
  {
    href: '/planejamento/areas',
    rotulo: 'Áreas',
    icone: Compass,
    permissao: 'planejamento.ler',
  },
  { href: '/agenda', rotulo: 'Agenda', icone: CalendarDays, permissao: 'agenda.ler' },
  {
    href: '/mobilizacao/ativistas',
    rotulo: 'Militância',
    icone: Megaphone,
    permissao: 'mobilizacao.ler',
  },
  { href: '/mobilizacao/comites', rotulo: 'Comitês', icone: Home, permissao: 'mobilizacao.ler' },
  {
    href: '/cadastros/candidatos',
    rotulo: 'Candidatos',
    icone: UserSquare2,
    permissao: 'candidatos.ler',
  },
  {
    href: '/cadastros/territorio',
    rotulo: 'Território',
    icone: Map,
    permissao: 'territorio.gerenciar',
  },
  { href: '/cadastros/metas', rotulo: 'Metas', icone: Target, permissao: 'metas.ler' },
  { href: '/projecao', rotulo: 'Projeção', icone: TrendingUp, permissao: 'projecao.ler' },
  {
    href: '/cadastros/financeiro',
    rotulo: 'Financeiro',
    icone: Wallet,
    permissao: 'financeiro.ler',
  },
  { href: '/cadastros/artes', rotulo: 'Artes', icone: Image, permissao: 'artes.ler' },
  {
    href: '/relatorios',
    rotulo: 'Relatórios',
    icone: FileBarChart,
    permissao: 'relatorios.exportar',
  },
] as const;

/**
 * Barra de navegação das áreas autenticadas.
 *
 * O menu é montado a partir das **permissões do token**: o que o perfil não
 * pode fazer não aparece. Um item visível e depois recusado pela API é pior que
 * item ausente — ensina o usuário a esbarrar em porta trancada.
 */
export function Cabecalho(): JSX.Element | null {
  const caminho = usePathname();
  const roteador = useRouter();
  const { temaAplicado, definirPreferencia } = useTema();
  const [sessao, definirSessao] = useState<Sessao | null>(null);

  useEffect(() => {
    if (caminho.startsWith('/entrar')) return;
    api
      .obter<Sessao>('/autenticacao/sessao')
      .then(definirSessao)
      .catch(() => definirSessao(null));
  }, [caminho]);

  if (caminho.startsWith('/entrar')) return null;

  async function sair(): Promise<void> {
    await api.enviar('/autenticacao/sair', {}).catch(() => undefined);
    roteador.replace('/entrar');
  }

  const itensVisiveis = ITENS.filter(
    (item) => !sessao || Boolean(sessao.permissoes[item.permissao]),
  );

  // O backoffice não é um módulo do inquilino: não há permissão de tenant que o
  // libere, e sim o perfil de provedor. Misturá-lo em ITENS faria o menu do
  // cliente exibir um item que a API sempre recusaria.
  const ehProvedor = sessao?.ehProvedor === true;

  return (
    <header
      data-imprimir="ocultar"
      className="border-b border-[hsl(var(--borda))] bg-[hsl(var(--superficie))]"
    >
      <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-3 px-4 py-2.5">
        <Link href="/painel" className="text-sm font-semibold text-[hsl(var(--texto))]">
          jEleitoral
        </Link>

        <nav className="flex flex-wrap items-center gap-1">
          {itensVisiveis.map((item) => {
            const Icone = item.icone;
            const ativo = caminho.startsWith(item.href);
            return (
              <Link
                key={item.href}
                href={item.href}
                aria-current={ativo ? 'page' : undefined}
                className={cn(
                  'flex items-center gap-1.5 rounded-[var(--raio)] px-2.5 py-1.5 text-sm',
                  ativo
                    ? 'bg-[hsl(var(--acento-sutil))] text-[hsl(var(--acento))]'
                    : 'text-[hsl(var(--texto-secundario))] hover:bg-[hsl(var(--fundo-sutil))]',
                )}
              >
                <Icone className="size-4" aria-hidden="true" />
                {item.rotulo}
              </Link>
            );
          })}

          {ehProvedor ? (
            <Link
              href="/backoffice"
              aria-current={caminho.startsWith('/backoffice') ? 'page' : undefined}
              className={cn(
                'flex items-center gap-1.5 rounded-[var(--raio)] px-2.5 py-1.5 text-sm',
                caminho.startsWith('/backoffice')
                  ? 'bg-[hsl(var(--acento-sutil))] text-[hsl(var(--acento))]'
                  : 'text-[hsl(var(--texto-secundario))] hover:bg-[hsl(var(--fundo-sutil))]',
              )}
            >
              <Building2 className="size-4" aria-hidden="true" />
              Backoffice
            </Link>
          ) : null}
        </nav>

        <div className="ml-auto flex items-center gap-2">
          {sessao ? (
            <span className="hidden text-xs text-[hsl(var(--texto-fraco))] sm:inline">
              {sessao.email} · {sessao.perfil}
            </span>
          ) : null}

          <Botao
            variante="sutil"
            tamanho="icone"
            onClick={() => definirPreferencia(temaAplicado === 'escuro' ? 'claro' : 'escuro')}
            title={temaAplicado === 'escuro' ? 'Usar tema claro' : 'Usar tema escuro'}
            aria-label={temaAplicado === 'escuro' ? 'Usar tema claro' : 'Usar tema escuro'}
          >
            {temaAplicado === 'escuro' ? <Sun /> : <Moon />}
          </Botao>

          <Botao variante="sutil" tamanho="pequeno" onClick={() => void sair()} title="Sair">
            <LogOut />
            Sair
          </Botao>
        </div>
      </div>
    </header>
  );
}
