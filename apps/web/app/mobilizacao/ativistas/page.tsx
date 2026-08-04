'use client';

import { UserPlus } from 'lucide-react';
import { useState } from 'react';
import { Botao, EstadoCarregando, EstadoVazio, cn } from '@jeleitoral/ui';
import {
  PapelAtivista,
  RotuloPapelAtivista,
  type PaginaDe,
} from '@jeleitoral/tipos';
import { Campo, classeControle } from '@/componentes/cadastro/Campo';
import { Tabela, type Coluna } from '@/componentes/cadastro/Tabela';
import { ErroDaApi, api } from '@/lib/api';
import { useListagem } from '@/lib/useListagem';
import { useSessao } from '@/lib/useSessao';

interface Ativista {
  id: string;
  nome: string;
  apelido: string | null;
  telefone: string | null;
  papel: PapelAtivista;
  nivel_engajamento: number;
  ativo: boolean;
  bairro: string | null;
  comite: string | null;
}

interface Comite {
  id: string;
  nome: string;
}

/**
 * Cadastro da militância.
 *
 * Ativista **não é usuário do sistema** e não tem login. Cabo eleitoral que
 * distribui santinho no bairro não precisa de conta, e exigir uma travaria o
 * cadastro da militância no gargalo do administrador — que é justamente o que
 * este módulo existe para eliminar.
 *
 * O que o coordenador vê aqui não é a militância inteira da campanha: a política
 * do banco aplica o escopo do perfil, então o mobilizador enxerga só quem ele
 * arregimentou ou quem está no território dele. Isso é deliberado — a lista com
 * telefone de toda a militância é o ativo mais fácil de levar embora.
 */
export default function PaginaAtivistas(): JSX.Element {
  const { idCampanha, carregando: carregandoSessao } = useSessao();

  const [busca, definirBusca] = useState('');
  const [aberto, definirAberto] = useState(false);
  const [nome, definirNome] = useState('');
  const [telefone, definirTelefone] = useState('');
  const [papel, definirPapel] = useState<PapelAtivista>('MULTIPLICADOR');
  const [idComite, definirIdComite] = useState('');
  const [nivel, definirNivel] = useState('3');
  const [salvando, definirSalvando] = useState(false);
  const [erroFormulario, definirErroFormulario] = useState<string | null>(null);

  const consulta = new URLSearchParams({ idCampanha: idCampanha ?? '' });
  if (busca.length >= 2) consulta.set('busca', busca);

  const { dados, carregando, erro, recarregar } = useListagem<PaginaDe<Ativista>>(
    idCampanha ? `/mobilizacao/ativistas?${consulta.toString()}` : null,
  );

  const { dados: comites } = useListagem<PaginaDe<Comite>>(
    idCampanha ? `/mobilizacao/comites?idCampanha=${idCampanha}` : null,
  );

  async function cadastrar(evento: React.FormEvent): Promise<void> {
    evento.preventDefault();
    definirSalvando(true);
    definirErroFormulario(null);
    try {
      await api.enviar('/mobilizacao/ativistas', {
        idCampanha,
        nome,
        telefone: telefone || undefined,
        papel,
        idComite: idComite || undefined,
        nivelEngajamento: Number(nivel),
      });
      definirNome('');
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

  async function alternarAtivo(ativista: Ativista): Promise<void> {
    await api.atualizar(`/mobilizacao/ativistas/${ativista.id}`, { ativo: !ativista.ativo });
    recarregar();
  }

  const colunas: Array<Coluna<Ativista>> = [
    {
      chave: 'nome',
      rotulo: 'Nome',
      render: (a) => (
        <div>
          <div className="font-medium text-[hsl(var(--texto))]">{a.nome}</div>
          {a.telefone ? (
            <div className="text-xs text-[hsl(var(--texto-fraco))]">{a.telefone}</div>
          ) : null}
        </div>
      ),
    },
    { chave: 'papel', rotulo: 'Papel', render: (a) => RotuloPapelAtivista[a.papel] ?? a.papel },
    { chave: 'comite', rotulo: 'Comitê', render: (a) => a.comite ?? '—' },
    { chave: 'bairro', rotulo: 'Bairro', render: (a) => a.bairro ?? '—' },
    {
      chave: 'engajamento',
      rotulo: 'Engajamento',
      numerico: true,
      render: (a) => (
        // Escala 1-5 como texto e não só como cor: quem não distingue cor
        // precisa da informação do mesmo jeito.
        <span title={`Nível ${a.nivel_engajamento} de 5`}>{a.nivel_engajamento}/5</span>
      ),
    },
    {
      chave: 'acoes',
      rotulo: 'Ações',
      render: (a) => (
        <Botao variante="sutil" tamanho="pequeno" onClick={() => void alternarAtivo(a)}>
          {a.ativo ? 'Desativar' : 'Reativar'}
        </Botao>
      ),
    },
  ];

  if (carregandoSessao) return <EstadoCarregando />;

  if (!idCampanha) {
    return (
      <main className="mx-auto max-w-4xl px-4 py-6">
        <p role="alert" className="text-sm text-[hsl(var(--perigo))]">
          Seu acesso não está vinculado a nenhuma campanha.
        </p>
      </main>
    );
  }

  return (
    <main className="mx-auto flex max-w-5xl flex-col gap-4 px-4 py-6">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold text-[hsl(var(--texto))]">Militância</h1>
          <p className="text-sm text-[hsl(var(--texto-secundario))]">
            Multiplicadores, lideranças e voluntários. Não precisam de acesso ao sistema.
          </p>
        </div>
        <Botao onClick={() => definirAberto((valor) => !valor)}>
          <UserPlus className="size-4" aria-hidden="true" />
          Cadastrar
        </Botao>
      </header>

      <input
        className={cn(classeControle, 'max-w-sm')}
        placeholder="Buscar por nome…"
        value={busca}
        onChange={(e) => definirBusca(e.target.value)}
        aria-label="Buscar ativista por nome"
      />

      {aberto ? (
        <form
          onSubmit={(evento) => void cadastrar(evento)}
          className="grid gap-3 rounded-[var(--raio)] border border-[hsl(var(--borda))] p-4 sm:grid-cols-2"
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

          <Campo id="telefone" rotulo="Telefone" dica="Como a coordenação vai chamar para as ações.">
            <input
              id="telefone"
              className={classeControle}
              value={telefone}
              onChange={(e) => definirTelefone(e.target.value)}
              inputMode="tel"
            />
          </Campo>

          <Campo id="papel" rotulo="Papel" obrigatorio>
            <select
              id="papel"
              className={classeControle}
              value={papel}
              onChange={(e) => definirPapel(e.target.value as PapelAtivista)}
            >
              {PapelAtivista.options.map((opcao) => (
                <option key={opcao} value={opcao}>
                  {RotuloPapelAtivista[opcao]}
                </option>
              ))}
            </select>
          </Campo>

          <Campo id="comite" rotulo="Comitê">
            <select
              id="comite"
              className={classeControle}
              value={idComite}
              onChange={(e) => definirIdComite(e.target.value)}
            >
              <option value="">Sem comitê</option>
              {(comites?.itens ?? []).map((comite) => (
                <option key={comite.id} value={comite.id}>
                  {comite.nome}
                </option>
              ))}
            </select>
          </Campo>

          <Campo id="nivel" rotulo="Engajamento" dica="1 = ocasional, 5 = presente todo dia.">
            <select
              id="nivel"
              className={classeControle}
              value={nivel}
              onChange={(e) => definirNivel(e.target.value)}
            >
              {[1, 2, 3, 4, 5].map((n) => (
                <option key={n} value={n}>
                  {n}
                </option>
              ))}
            </select>
          </Campo>

          {erroFormulario ? (
            <p role="alert" className="text-sm text-[hsl(var(--perigo))] sm:col-span-2">
              {erroFormulario}
            </p>
          ) : null}

          <div className="flex gap-2 sm:col-span-2">
            <Botao type="submit" carregando={salvando}>
              Cadastrar
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
      ) : (dados?.itens ?? []).length === 0 ? (
        <EstadoVazio
          titulo="Nenhum ativista cadastrado"
          descricao="Cadastre os multiplicadores para poder convocá-los às atividades."
        />
      ) : (
        <>
          <Tabela colunas={colunas} linhas={dados?.itens ?? []} chaveDe={(a) => a.id} />
          <p className="text-xs text-[hsl(var(--texto-fraco))]">
            {dados?.total} {dados?.total === 1 ? 'pessoa' : 'pessoas'} no seu escopo.
          </p>
        </>
      )}
    </main>
  );
}
