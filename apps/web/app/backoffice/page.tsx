'use client';

import { BarraAcoes, EstadoCarregando, EstadoErro, EstadoVazio } from '@jeleitoral/ui';
import { RotuloStatusOrganizacao, type StatusOrganizacao } from '@jeleitoral/tipos';
import { Tabela } from '@/componentes/cadastro/Tabela';
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

interface RegistroAuditoria {
  id: string;
  id_organizacao: string;
  acao: string;
  entidade: string;
  criado_em: string;
}

function formatarData(iso: string | null): string {
  return iso ? new Date(iso).toLocaleDateString('pt-BR') : '—';
}

/**
 * Backoffice do provedor.
 *
 * Mostra **contadores, nunca conteúdo**: quantos usuários, quantas entrevistas,
 * quanto de armazenamento. Nenhuma linha desta tela revela um eleitor, um
 * endereço ou uma intenção de voto — o provedor não tem acesso a dado de campo,
 * e o acesso temporário de suporte depende de autorização do administrador da
 * organização, com prazo e motivo.
 */
export default function PaginaBackoffice(): JSX.Element {
  const organizacoes = useListagem<Organizacao[]>('/provedor/organizacoes');
  const auditoria = useListagem<RegistroAuditoria[]>('/provedor/auditoria');

  return (
    <main className="mx-auto flex max-w-6xl flex-col gap-4 px-4 py-6">
      <BarraAcoes
        titulo="Backoffice do provedor"
        subtitulo={organizacoes.dados ? `${organizacoes.dados.length} organização(ões)` : undefined}
        atualizar={{
          aoAcionar: () => {
            organizacoes.recarregar();
            auditoria.recarregar();
          },
          carregando: organizacoes.carregando || auditoria.carregando,
        }}
        imprimir={{}}
      />

      <p className="rounded-[var(--raio)] border border-[hsl(var(--borda))] bg-[hsl(var(--fundo-sutil))] px-3 py-2 text-xs text-[hsl(var(--texto-secundario))]">
        Esta área expõe apenas contadores de uso. Dados de campo das organizações não são acessíveis
        daqui — o acesso de suporte exige autorização do administrador da organização, com motivo e
        prazo de expiração.
      </p>

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
              render: (linha) => RotuloStatusOrganizacao[linha.status] ?? linha.status,
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
              chave: 'armazenamento',
              rotulo: 'Armazenamento',
              numerico: true,
              render: (linha) => `${(linha.armazenamento_mb ?? 0).toLocaleString('pt-BR')} MB`,
            },
            {
              chave: 'ia',
              rotulo: 'Chamadas de IA',
              numerico: true,
              render: (linha) => (linha.chamadas_ia ?? 0).toLocaleString('pt-BR'),
            },
            {
              chave: 'atividade',
              rotulo: 'Última atividade',
              render: (linha) => formatarData(linha.ultima_atividade),
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
              { chave: 'org', rotulo: 'Organização', render: (linha) => linha.id_organizacao },
              { chave: 'acao', rotulo: 'Ação', render: (linha) => linha.acao },
              { chave: 'entidade', rotulo: 'Entidade', render: (linha) => linha.entidade },
            ]}
          />
        )}
      </section>
    </main>
  );
}
