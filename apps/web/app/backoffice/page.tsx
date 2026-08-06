'use client';

import { Copy, PlusCircle } from 'lucide-react';
import { useState } from 'react';
import { BarraAcoes, Botao, EstadoCarregando, EstadoErro, EstadoVazio, cn } from '@jeleitoral/ui';
import { RotuloStatusOrganizacao, type StatusOrganizacao } from '@jeleitoral/tipos';
import { Campo, classeControle } from '@/componentes/cadastro/Campo';
import { Tabela } from '@/componentes/cadastro/Tabela';
import { ErroDaApi, api } from '@/lib/api';
import { useListagem } from '@/lib/useListagem';

interface Organizacao {
  id: string;
  nome: string;
  status: StatusOrganizacao;
  contratado_em: string;
  expira_em: string | null;
  plano: string;
  limite_usuarios: number;
  limite_entrevistas_mes: number;
  usuarios_ativos: number | null;
  entrevistas_no_mes: number | null;
  armazenamento_mb: number | null;
  chamadas_ia: number | null;
  custo_ia: number | null;
  ultima_atividade: string | null;
}

interface Plano {
  id: string;
  nome: string;
  limite_usuarios: number;
  limite_entrevistas_mes: number;
  valor_mensal: string;
}

interface RegistroAuditoria {
  id: string;
  id_organizacao: string;
  nome_organizacao: string;
  acao: string;
  entidade: string;
  criado_em: string;
}

function formatarData(iso: string | null): string {
  return iso ? new Date(iso).toLocaleDateString('pt-BR') : '—';
}

const CLASSE_STATUS: Record<StatusOrganizacao, string> = {
  ATIVA: 'bg-[hsl(var(--apoiador-sutil))] text-[hsl(var(--apoiador))]',
  SUSPENSA: 'bg-[hsl(var(--atencao-sutil))] text-[hsl(var(--atencao))]',
  CANCELADA: 'bg-[hsl(var(--nao-informou-sutil))] text-[hsl(var(--nao-informou))]',
};

/**
 * Backoffice do provedor.
 *
 * A parte de leitura mostra **contadores, nunca conteúdo**: quantos usuários,
 * quantas entrevistas, quanto de armazenamento. Nenhuma linha desta tela
 * revela um eleitor, um endereço ou uma intenção de voto — o provedor não tem
 * acesso a dado de campo, e o acesso temporário de suporte depende de
 * autorização do administrador da organização, com prazo e motivo.
 *
 * A parte de gestão comercial (criar organização, ativar/suspender/cancelar,
 * trocar de plano) fica dentro da mesma fronteira: tudo aqui é metadado
 * comercial. Redefinir senha de um usuário do cliente e backup/restore de
 * dados ficaram de fora de propósito — o primeiro é papel da própria
 * organização (tela de Equipe), o segundo tensionaria o princípio acima.
 */
export default function PaginaBackoffice(): JSX.Element {
  const organizacoes = useListagem<Organizacao[]>('/provedor/organizacoes');
  const auditoria = useListagem<RegistroAuditoria[]>('/provedor/auditoria');
  const { dados: planos } = useListagem<Plano[]>('/provedor/planos');

  const [formularioAberto, definirFormularioAberto] = useState(false);
  const [nome, definirNome] = useState('');
  const [razaoSocial, definirRazaoSocial] = useState('');
  const [idPlano, definirIdPlano] = useState('');
  const [corAcento, definirCorAcento] = useState('');
  const [nomeAdmin, definirNomeAdmin] = useState('');
  const [emailAdmin, definirEmailAdmin] = useState('');
  const [salvando, definirSalvando] = useState(false);
  const [erroFormulario, definirErroFormulario] = useState<string | null>(null);
  const [credencial, definirCredencial] = useState<{ email: string; senha: string } | null>(null);

  const [editandoPlano, definirEditandoPlano] = useState<Organizacao | null>(null);
  const [novoPlano, definirNovoPlano] = useState('');
  const [erroAcao, definirErroAcao] = useState<string | null>(null);

  function recarregarTudo(): void {
    organizacoes.recarregar();
    auditoria.recarregar();
  }

  async function criarOrganizacao(evento: React.FormEvent): Promise<void> {
    evento.preventDefault();
    definirSalvando(true);
    definirErroFormulario(null);
    try {
      const criado = await api.enviar<{ idOrganizacao: string; senhaInicial: string }>(
        '/provedor/organizacoes',
        {
          nome,
          razaoSocial: razaoSocial.trim() || undefined,
          idPlano,
          corAcento: corAcento.trim() || undefined,
          administrador: { nome: nomeAdmin, email: emailAdmin },
        },
      );
      definirCredencial({ email: emailAdmin, senha: criado.senhaInicial });
      definirNome('');
      definirRazaoSocial('');
      definirIdPlano('');
      definirCorAcento('');
      definirNomeAdmin('');
      definirEmailAdmin('');
      definirFormularioAberto(false);
      recarregarTudo();
    } catch (falha) {
      definirErroFormulario(
        falha instanceof ErroDaApi ? falha.corpo.mensagem : 'Não foi possível criar a organização.',
      );
    } finally {
      definirSalvando(false);
    }
  }

  async function mudarStatus(organizacao: Organizacao, status: StatusOrganizacao): Promise<void> {
    definirErroAcao(null);
    try {
      await api.atualizar(`/provedor/organizacoes/${organizacao.id}/status`, { status });
      recarregarTudo();
    } catch (falha) {
      definirErroAcao(
        falha instanceof ErroDaApi ? falha.corpo.mensagem : 'Não foi possível mudar a situação.',
      );
    }
  }

  function abrirEdicaoPlano(organizacao: Organizacao): void {
    definirEditandoPlano(organizacao);
    definirNovoPlano(planos?.find((p) => p.nome === organizacao.plano)?.id ?? '');
    definirErroAcao(null);
  }

  async function salvarPlano(evento: React.FormEvent): Promise<void> {
    evento.preventDefault();
    if (!editandoPlano) return;
    definirErroAcao(null);
    try {
      await api.atualizar(`/provedor/organizacoes/${editandoPlano.id}/plano`, {
        idPlano: novoPlano,
      });
      definirEditandoPlano(null);
      recarregarTudo();
    } catch (falha) {
      definirErroAcao(
        falha instanceof ErroDaApi ? falha.corpo.mensagem : 'Não foi possível trocar o plano.',
      );
    }
  }

  return (
    <main className="mx-auto flex max-w-6xl flex-col gap-4 px-4 py-6">
      <BarraAcoes
        titulo="Backoffice do provedor"
        subtitulo={organizacoes.dados ? `${organizacoes.dados.length} organização(ões)` : undefined}
        atualizar={{
          aoAcionar: recarregarTudo,
          carregando: organizacoes.carregando || auditoria.carregando,
        }}
        novo={{ aoAcionar: () => definirFormularioAberto((v) => !v), rotulo: 'Nova organização' }}
        imprimir={{}}
      />

      <p className="rounded-[var(--raio)] border border-[hsl(var(--borda))] bg-[hsl(var(--fundo-sutil))] px-3 py-2 text-xs text-[hsl(var(--texto-secundario))]">
        Esta área expõe apenas contadores de uso e dados comerciais (situação, plano, vigência).
        Dados de campo das organizações não são acessíveis daqui — o acesso de suporte exige
        autorização do administrador da organização, com motivo e prazo de expiração.
      </p>

      {credencial ? (
        <div
          role="status"
          className="flex flex-col gap-2 rounded-[var(--raio)] border border-[hsl(var(--sucesso)/0.4)] bg-[hsl(var(--sucesso-sutil))] p-3"
        >
          <p className="text-sm font-medium text-[hsl(var(--sucesso))]">
            Organização criada. Anote a senha do administrador agora — ela não será exibida de novo.
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

      {formularioAberto ? (
        <form
          onSubmit={(evento) => void criarOrganizacao(evento)}
          className="grid gap-3 rounded-[var(--raio)] border border-[hsl(var(--borda))] bg-[hsl(var(--superficie))] p-4 sm:grid-cols-2"
        >
          <Campo id="nome" rotulo="Nome da organização" obrigatorio>
            <input
              id="nome"
              value={nome}
              onChange={(e) => definirNome(e.target.value)}
              required
              minLength={2}
              className={classeControle}
            />
          </Campo>

          <Campo id="razaoSocial" rotulo="Razão social">
            <input
              id="razaoSocial"
              value={razaoSocial}
              onChange={(e) => definirRazaoSocial(e.target.value)}
              className={classeControle}
            />
          </Campo>

          <Campo id="idPlano" rotulo="Plano" obrigatorio>
            <select
              id="idPlano"
              value={idPlano}
              onChange={(e) => definirIdPlano(e.target.value)}
              required
              className={classeControle}
            >
              <option value="">Selecione…</option>
              {(planos ?? []).map((plano) => (
                <option key={plano.id} value={plano.id}>
                  {plano.nome} — {plano.limite_usuarios} usuários, R$ {plano.valor_mensal}/mês
                </option>
              ))}
            </select>
          </Campo>

          <Campo
            id="corAcento"
            rotulo="Cor de acento"
            dica='Formato HSL sem a função, ex.: "221 83% 45%". Opcional.'
          >
            <input
              id="corAcento"
              value={corAcento}
              onChange={(e) => definirCorAcento(e.target.value)}
              placeholder="221 83% 45%"
              className={classeControle}
            />
          </Campo>

          <Campo id="nomeAdmin" rotulo="Nome do administrador" obrigatorio>
            <input
              id="nomeAdmin"
              value={nomeAdmin}
              onChange={(e) => definirNomeAdmin(e.target.value)}
              required
              minLength={3}
              className={classeControle}
            />
          </Campo>

          <Campo id="emailAdmin" rotulo="E-mail do administrador" obrigatorio dica="Será o login.">
            <input
              id="emailAdmin"
              type="email"
              value={emailAdmin}
              onChange={(e) => definirEmailAdmin(e.target.value)}
              required
              className={classeControle}
            />
          </Campo>

          {erroFormulario ? (
            <p role="alert" className="text-sm text-[hsl(var(--perigo))] sm:col-span-2">
              {erroFormulario}
            </p>
          ) : null}

          <div className="flex gap-2 sm:col-span-2">
            <Botao type="submit" carregando={salvando}>
              <PlusCircle className="size-4" aria-hidden="true" />
              Criar organização
            </Botao>
            <Botao type="button" variante="sutil" onClick={() => definirFormularioAberto(false)}>
              Cancelar
            </Botao>
          </div>
        </form>
      ) : null}

      {editandoPlano ? (
        <form
          onSubmit={(evento) => void salvarPlano(evento)}
          className="flex flex-wrap items-end gap-3 rounded-[var(--raio)] border border-[hsl(var(--borda))] bg-[hsl(var(--superficie))] p-4"
        >
          <Campo id="novoPlano" rotulo={`Novo plano para "${editandoPlano.nome}"`} obrigatorio>
            <select
              id="novoPlano"
              value={novoPlano}
              onChange={(e) => definirNovoPlano(e.target.value)}
              required
              className={classeControle}
            >
              <option value="">Selecione…</option>
              {(planos ?? []).map((plano) => (
                <option key={plano.id} value={plano.id}>
                  {plano.nome} — {plano.limite_usuarios} usuários
                </option>
              ))}
            </select>
          </Campo>
          <Botao type="submit">Salvar</Botao>
          <Botao type="button" variante="sutil" onClick={() => definirEditandoPlano(null)}>
            Cancelar
          </Botao>
        </form>
      ) : null}

      {erroAcao ? (
        <p role="alert" className="text-sm text-[hsl(var(--perigo))]">
          {erroAcao}
        </p>
      ) : null}

      {organizacoes.erro ? (
        <EstadoErro
          mensagem={organizacoes.erro.corpo.mensagem}
          idCorrelacao={organizacoes.erro.corpo.idCorrelacao}
          semConexao={organizacoes.erro.semConexao}
          aoTentarNovamente={organizacoes.recarregar}
        />
      ) : organizacoes.carregando && !organizacoes.dados ? (
        <EstadoCarregando mensagem="Carregando organizações…" linhas={4} />
      ) : !organizacoes.dados || organizacoes.dados.length === 0 ? (
        <EstadoVazio titulo="Nenhuma organização" />
      ) : (
        <Tabela
          linhas={organizacoes.dados}
          chaveDe={(linha) => linha.id}
          colunas={[
            { chave: 'nome', rotulo: 'Organização', render: (linha) => linha.nome },
            {
              chave: 'status',
              rotulo: 'Situação',
              render: (linha) => (
                <span
                  className={cn('rounded-full px-2 py-0.5 text-xs', CLASSE_STATUS[linha.status])}
                >
                  {RotuloStatusOrganizacao[linha.status] ?? linha.status}
                </span>
              ),
            },
            { chave: 'plano', rotulo: 'Plano', render: (linha) => linha.plano },
            {
              chave: 'usuarios',
              rotulo: 'Usuários',
              numerico: true,
              render: (linha) => `${linha.usuarios_ativos ?? 0} / ${linha.limite_usuarios}`,
            },
            {
              chave: 'entrevistas',
              rotulo: 'Entrevistas no mês',
              numerico: true,
              render: (linha) =>
                `${(linha.entrevistas_no_mes ?? 0).toLocaleString('pt-BR')} / ${linha.limite_entrevistas_mes.toLocaleString('pt-BR')}`,
            },
            {
              chave: 'atividade',
              rotulo: 'Última atividade',
              render: (linha) => formatarData(linha.ultima_atividade),
            },
            {
              chave: 'acoes',
              rotulo: 'Ações',
              render: (linha) => (
                <div className="flex flex-wrap gap-1">
                  <Botao variante="sutil" tamanho="pequeno" onClick={() => abrirEdicaoPlano(linha)}>
                    Editar plano
                  </Botao>
                  {linha.status !== 'ATIVA' ? (
                    <Botao
                      variante="sutil"
                      tamanho="pequeno"
                      onClick={() => void mudarStatus(linha, 'ATIVA')}
                    >
                      Ativar
                    </Botao>
                  ) : (
                    <Botao
                      variante="sutil"
                      tamanho="pequeno"
                      onClick={() => void mudarStatus(linha, 'SUSPENSA')}
                    >
                      Suspender
                    </Botao>
                  )}
                  {linha.status !== 'CANCELADA' ? (
                    <Botao
                      variante="sutil"
                      tamanho="pequeno"
                      onClick={() => void mudarStatus(linha, 'CANCELADA')}
                    >
                      Cancelar
                    </Botao>
                  ) : null}
                </div>
              ),
            },
          ]}
        />
      )}

      <section className="flex flex-col gap-2">
        <h2 className="text-sm font-medium text-[hsl(var(--texto))]">
          Auditoria de metadados (200 mais recentes)
        </h2>
        {auditoria.carregando && !auditoria.dados ? (
          <EstadoCarregando linhas={3} />
        ) : !auditoria.dados || auditoria.dados.length === 0 ? (
          <EstadoVazio titulo="Sem registros" />
        ) : (
          <Tabela
            linhas={auditoria.dados}
            chaveDe={(linha) => linha.id}
            colunas={[
              {
                chave: 'data',
                rotulo: 'Quando',
                render: (linha) => new Date(linha.criado_em).toLocaleString('pt-BR'),
              },
              { chave: 'org', rotulo: 'Organização', render: (linha) => linha.nome_organizacao },
              { chave: 'acao', rotulo: 'Ação', render: (linha) => linha.acao },
              { chave: 'entidade', rotulo: 'Entidade', render: (linha) => linha.entidade },
            ]}
          />
        )}
      </section>
    </main>
  );
}
