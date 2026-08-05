'use client';

import { ChevronDown, LogOut, Menu, Moon, Sun, X } from 'lucide-react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { Botao, cn, useTema } from '@jeleitoral/ui';
import { api } from '@/lib/api';
import { grupoDaRota, gruposVisiveis, ICONE_POR_ROTA } from './modulos';

const CHAVE_GRUPOS_ABERTOS = 'jeleitoral.modulos-abertos';

function gravarAbertos(grupos: string[]): void {
  try {
    window.localStorage.setItem(CHAVE_GRUPOS_ABERTOS, JSON.stringify(grupos));
  } catch {
    // Sem armazenamento a lateral segue funcionando, só não lembra.
  }
}

interface Sessao {
  email: string;
  perfil: string;
  permissoes: Record<string, string>;
  ehProvedor: boolean;
}

/**
 * Estrutura das áreas autenticadas: barra lateral + abas do grupo ativo.
 *
 * Por que abas de NAVEGAÇÃO e não `role="tablist"`: cada aba é uma tela com URL
 * própria, não um painel que troca no mesmo documento. Marcá-las como tablist
 * faria o leitor de tela anunciar "aba 2 de 3" e o usuário esperar que a seta
 * do teclado trocasse o conteúdo sem sair da página — o que não acontece. São
 * links, e `aria-current="page"` é o que diz onde se está.
 *
 * No celular a lateral vira gaveta e nasce FECHADA: quem abre o sistema na rua
 * vai para o formulário de entrevista, não para o menu.
 */
export function Estrutura({ children }: { children: React.ReactNode }): JSX.Element {
  const caminho = usePathname();
  const roteador = useRouter();
  const { temaAplicado, definirPreferencia } = useTema();
  const [sessao, definirSessao] = useState<Sessao | null>(null);
  const [gavetaAberta, definirGavetaAberta] = useState(false);
  /*
   * Quais grupos estão abertos.
   *
   * `null` enquanto a preferência não foi lida: `localStorage` não existe no
   * servidor, e ler durante a renderização daria divergência de hidratação. Até
   * carregar, vale a regra do grupo ativo — que é o que a pessoa quer ver de
   * qualquer forma.
   */
  const [abertosSalvos, definirAbertosSalvos] = useState<string[] | null>(null);

  const naTelaDeEntrada = caminho.startsWith('/entrar') || caminho.startsWith('/offline');

  useEffect(() => {
    if (naTelaDeEntrada) return;
    api
      .obter<Sessao>('/autenticacao/sessao')
      .then(definirSessao)
      .catch(() => definirSessao(null));
  }, [caminho, naTelaDeEntrada]);

  // Navegou: fecha a gaveta. Sem isto, no celular o menu cobre a tela que a
  // pessoa acabou de escolher.
  useEffect(() => definirGavetaAberta(false), [caminho]);

  const grupos = gruposVisiveis(sessao?.permissoes ?? null);
  const grupoAtivo = grupoDaRota(caminho);
  // As abas saem da lista JÁ FILTRADA por permissão, e não da árvore completa:
  // senão apareceria aba para uma tela que a API recusaria.
  const abas = grupos.find((grupo) => grupo.id === grupoAtivo?.id)?.itens ?? [];

  useEffect(() => {
    try {
      const salvo = window.localStorage.getItem(CHAVE_GRUPOS_ABERTOS);
      definirAbertosSalvos(salvo ? (JSON.parse(salvo) as string[]) : []);
    } catch {
      // Navegador com armazenamento bloqueado: a lateral funciona, só não
      // lembra do estado. Não é motivo para quebrar a tela.
      definirAbertosSalvos([]);
    }
  }, []);

  // Navegar para um grupo o abre. Sem isto, quem chega por link direto a uma
  // tela de grupo recolhido não enxerga onde está na lateral.
  useEffect(() => {
    if (!grupoAtivo) return;
    definirAbertosSalvos((atual) => {
      if (atual === null || atual.includes(grupoAtivo.id)) return atual;
      const proximo = [...atual, grupoAtivo.id];
      gravarAbertos(proximo);
      return proximo;
    });
  }, [grupoAtivo]);

  // Hooks precisam correr sempre na mesma ordem — o retorno antecipado só
  // pode vir depois de todos eles, senão a navegação client-side para/de
  // `/entrar` muda a contagem de hooks do MESMO componente montado e o React
  // derruba a tela com "Rendered fewer hooks than expected".
  if (naTelaDeEntrada) return <>{children}</>;

  async function sair(): Promise<void> {
    await api.enviar('/autenticacao/sair', {}).catch(() => undefined);
    roteador.replace('/entrar');
  }

  const estaAberto = (idGrupo: string): boolean =>
    abertosSalvos === null ? grupoAtivo?.id === idGrupo : abertosSalvos.includes(idGrupo);

  const alternarGrupo = (idGrupo: string): void => {
    definirAbertosSalvos((atual) => {
      const base = atual ?? (grupoAtivo ? [grupoAtivo.id] : []);
      const proximo = base.includes(idGrupo)
        ? base.filter((id) => id !== idGrupo)
        : [...base, idGrupo];
      gravarAbertos(proximo);
      return proximo;
    });
  };

  const lateral = (
    <nav aria-label="Módulos" className="flex flex-col gap-1 p-3">
      {grupos.map((grupo) => {
        const Icone = grupo.icone;
        const grupoAtivoAqui = grupoAtivo?.id === grupo.id;

        /*
         * Grupo de uma tela só vira link direto, sem seta.
         *
         * Recolher para revelar um item é um clique que não entrega nada, e a
         * seta prometeria conteúdo que não existe.
         */
        if (grupo.itens.length === 1) {
          const item = grupo.itens[0]!;
          const ativo = caminho === item.href || caminho.startsWith(`${item.href}/`);
          return (
            <Link
              key={grupo.id}
              href={item.href}
              aria-current={ativo ? 'page' : undefined}
              className={cn(
                'flex items-center gap-2 rounded-[var(--raio)] px-2 py-1.5 text-sm',
                ativo
                  ? 'bg-[hsl(var(--acento-sutil))] font-medium text-[hsl(var(--acento))]'
                  : 'text-[hsl(var(--texto-secundario))] hover:bg-[hsl(var(--fundo-sutil))]',
              )}
            >
              <Icone className="size-4 shrink-0" aria-hidden="true" />
              {grupo.rotulo}
            </Link>
          );
        }

        const aberto = estaAberto(grupo.id);
        const idLista = `modulos-${grupo.id}`;

        return (
          <div key={grupo.id}>
            <button
              type="button"
              onClick={() => alternarGrupo(grupo.id)}
              aria-expanded={aberto}
              aria-controls={idLista}
              className={cn(
                'flex w-full items-center gap-2 rounded-[var(--raio)] px-2 py-1.5 text-sm',
                grupoAtivoAqui
                  ? 'font-medium text-[hsl(var(--texto))]'
                  : 'text-[hsl(var(--texto-secundario))]',
                'hover:bg-[hsl(var(--fundo-sutil))]',
              )}
            >
              <Icone className="size-4 shrink-0" aria-hidden="true" />
              <span className="flex-1 text-left">{grupo.rotulo}</span>
              <ChevronDown
                className={cn('size-4 shrink-0 transition-transform', aberto ? '' : '-rotate-90')}
                aria-hidden="true"
              />
            </button>

            {aberto ? (
              <ul id={idLista} className="flex flex-col">
                {grupo.itens.map((item) => {
                  const ativo = caminho === item.href || caminho.startsWith(`${item.href}/`);
                  return (
                    <li key={item.href}>
                      <Link
                        href={item.href}
                        aria-current={ativo ? 'page' : undefined}
                        className={cn(
                          // Recuo alinhado ao rótulo do grupo, para a lista ler
                          // como filha dele e não como outro nível.
                          'block rounded-[var(--raio)] py-1.5 pl-8 pr-2 text-sm',
                          ativo
                            ? 'bg-[hsl(var(--acento-sutil))] font-medium text-[hsl(var(--acento))]'
                            : 'text-[hsl(var(--texto-secundario))] hover:bg-[hsl(var(--fundo-sutil))]',
                        )}
                      >
                        {item.rotulo}
                      </Link>
                    </li>
                  );
                })}
              </ul>
            ) : null}
          </div>
        );
      })}

      {sessao?.ehProvedor ? (
        <div>
          <p className="mb-1 px-2 text-xs font-medium uppercase tracking-wide text-[hsl(var(--texto-fraco))]">
            Provedor
          </p>
          <Link
            href="/backoffice"
            aria-current={caminho.startsWith('/backoffice') ? 'page' : undefined}
            className={cn(
              'block rounded-[var(--raio)] px-2 py-1.5 text-sm',
              caminho.startsWith('/backoffice')
                ? 'bg-[hsl(var(--acento-sutil))] font-medium text-[hsl(var(--acento))]'
                : 'text-[hsl(var(--texto-secundario))] hover:bg-[hsl(var(--fundo-sutil))]',
            )}
          >
            Backoffice
          </Link>
        </div>
      ) : null}
    </nav>
  );

  return (
    <div className="flex min-h-dvh">
      {/* Lateral fixa a partir de `lg`. */}
      <aside
        data-imprimir="ocultar"
        className="hidden w-56 shrink-0 border-r border-[hsl(var(--borda))] bg-[hsl(var(--superficie))] lg:block"
      >
        <div className="sticky top-0 flex h-dvh flex-col">
          <Link
            href="/painel"
            className="border-b border-[hsl(var(--borda))] px-4 py-3 text-sm font-semibold text-[hsl(var(--texto))]"
          >
            jEleitoral
          </Link>
          <div className="flex-1 overflow-y-auto">{lateral}</div>
          <RodapeUsuario
            sessao={sessao}
            temaEscuro={temaAplicado === 'escuro'}
            aoTrocarTema={() => definirPreferencia(temaAplicado === 'escuro' ? 'claro' : 'escuro')}
            aoSair={() => void sair()}
          />
        </div>
      </aside>

      {/* Gaveta do celular. */}
      {gavetaAberta ? (
        <div className="fixed inset-0 z-40 lg:hidden" role="dialog" aria-modal="true">
          <button
            type="button"
            aria-label="Fechar menu"
            onClick={() => definirGavetaAberta(false)}
            className="absolute inset-0 bg-black/40"
          />
          <div className="absolute inset-y-0 left-0 flex w-64 flex-col bg-[hsl(var(--superficie))] shadow-xl">
            <div className="flex items-center justify-between border-b border-[hsl(var(--borda))] px-4 py-3">
              <span className="text-sm font-semibold text-[hsl(var(--texto))]">jEleitoral</span>
              <Botao
                variante="sutil"
                tamanho="icone"
                onClick={() => definirGavetaAberta(false)}
                aria-label="Fechar menu"
              >
                <X />
              </Botao>
            </div>
            <div className="flex-1 overflow-y-auto">{lateral}</div>
            <RodapeUsuario
              sessao={sessao}
              temaEscuro={temaAplicado === 'escuro'}
              aoTrocarTema={() =>
                definirPreferencia(temaAplicado === 'escuro' ? 'claro' : 'escuro')
              }
              aoSair={() => void sair()}
            />
          </div>
        </div>
      ) : null}

      <div className="flex min-w-0 flex-1 flex-col">
        {/* Barra superior: só existe no celular, para abrir a gaveta. */}
        <header
          data-imprimir="ocultar"
          className="flex items-center gap-2 border-b border-[hsl(var(--borda))] bg-[hsl(var(--superficie))] px-3 py-2 lg:hidden"
        >
          <Botao
            variante="sutil"
            tamanho="icone"
            onClick={() => definirGavetaAberta(true)}
            aria-label="Abrir menu"
          >
            <Menu />
          </Botao>
          <span className="text-sm font-semibold text-[hsl(var(--texto))]">
            {grupoAtivo?.rotulo ?? 'jEleitoral'}
          </span>
        </header>

        {abas.length > 1 ? (
          <nav
            aria-label={`Telas de ${grupoAtivo?.rotulo ?? ''}`}
            data-imprimir="ocultar"
            className="flex gap-1 overflow-x-auto border-b border-[hsl(var(--borda))] bg-[hsl(var(--superficie))] px-3"
          >
            {abas.map((item) => {
              const ativo = caminho === item.href || caminho.startsWith(`${item.href}/`);
              const Icone = ICONE_POR_ROTA[item.href];
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  aria-current={ativo ? 'page' : undefined}
                  className={cn(
                    'flex items-center gap-1.5 whitespace-nowrap border-b-2 px-3 py-2 text-sm',
                    ativo
                      ? 'border-[hsl(var(--acento))] font-medium text-[hsl(var(--acento))]'
                      : 'border-transparent text-[hsl(var(--texto-secundario))] hover:text-[hsl(var(--texto))]',
                  )}
                >
                  {Icone ? <Icone className="size-4" aria-hidden="true" /> : null}
                  {item.rotulo}
                </Link>
              );
            })}
          </nav>
        ) : null}

        <div className="min-w-0 flex-1">{children}</div>
      </div>
    </div>
  );
}

function RodapeUsuario({
  sessao,
  temaEscuro,
  aoTrocarTema,
  aoSair,
}: {
  sessao: Sessao | null;
  temaEscuro: boolean;
  aoTrocarTema: () => void;
  aoSair: () => void;
}): JSX.Element {
  return (
    <div className="border-t border-[hsl(var(--borda))] p-3">
      {sessao ? (
        <p className="mb-2 truncate text-xs text-[hsl(var(--texto-fraco))]" title={sessao.email}>
          {sessao.email}
          <br />
          <span className="text-[hsl(var(--texto-secundario))]">{sessao.perfil}</span>
        </p>
      ) : null}

      <div className="flex gap-2">
        <Botao
          variante="sutil"
          tamanho="icone"
          onClick={aoTrocarTema}
          title={temaEscuro ? 'Usar tema claro' : 'Usar tema escuro'}
          aria-label={temaEscuro ? 'Usar tema claro' : 'Usar tema escuro'}
        >
          {temaEscuro ? <Sun /> : <Moon />}
        </Botao>
        <Botao variante="sutil" tamanho="pequeno" onClick={aoSair} title="Sair">
          <LogOut />
          Sair
        </Botao>
      </div>
    </div>
  );
}
