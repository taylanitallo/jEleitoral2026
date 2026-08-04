'use client';

import { Plus } from 'lucide-react';
import { useState } from 'react';
import { Botao, EstadoCarregando, EstadoVazio } from '@jeleitoral/ui';
import { RotuloTipoComite, TipoComite, type PaginaDe } from '@jeleitoral/tipos';
import { Campo, classeControle } from '@/componentes/cadastro/Campo';
import { Tabela, type Coluna } from '@/componentes/cadastro/Tabela';
import { ErroDaApi, api } from '@/lib/api';
import { useListagem } from '@/lib/useListagem';
import { useSessao } from '@/lib/useSessao';

interface Comite {
  id: string;
  nome: string;
  tipo: TipoComite;
  ativo: boolean;
  bairro: string | null;
  coordenador: string | null;
  total_membros: number;
}

/**
 * Comitês de campanha.
 *
 * Ao contrário da militância, o comitê é visível a toda a campanha: quem
 * trabalha num bairro precisa saber a quem recorrer noutro, e esconder a rede
 * de comitês por escopo só produziria telefonema para a coordenação central.
 */
export default function PaginaComites(): JSX.Element {
  const { idCampanha, carregando: carregandoSessao } = useSessao();

  const [aberto, definirAberto] = useState(false);
  const [nome, definirNome] = useState('');
  const [tipo, definirTipo] = useState<TipoComite>('BAIRRO');
  const [telefone, definirTelefone] = useState('');
  const [horario, definirHorario] = useState('');
  const [salvando, definirSalvando] = useState(false);
  const [erroFormulario, definirErroFormulario] = useState<string | null>(null);

  const { dados, carregando, erro, recarregar } = useListagem<PaginaDe<Comite>>(
    idCampanha ? `/mobilizacao/comites?idCampanha=${idCampanha}` : null,
  );

  async function cadastrar(evento: React.FormEvent): Promise<void> {
    evento.preventDefault();
    definirSalvando(true);
    definirErroFormulario(null);
    try {
      await api.enviar('/mobilizacao/comites', {
        idCampanha,
        nome,
        tipo,
        telefoneContato: telefone || undefined,
        horarioFuncionamento: horario || undefined,
      });
      definirNome('');
      definirTelefone('');
      definirHorario('');
      definirAberto(false);
      recarregar();
    } catch (falha) {
      definirErroFormulario(
        falha instanceof ErroDaApi ? falha.message : 'Não foi possível cadastrar o comitê.',
      );
    } finally {
      definirSalvando(false);
    }
  }

  const colunas: Array<Coluna<Comite>> = [
    { chave: 'nome', rotulo: 'Comitê', render: (c) => c.nome },
    { chave: 'tipo', rotulo: 'Tipo', render: (c) => RotuloTipoComite[c.tipo] ?? c.tipo },
    { chave: 'bairro', rotulo: 'Bairro', render: (c) => c.bairro ?? '—' },
    { chave: 'coordenador', rotulo: 'Coordenador', render: (c) => c.coordenador ?? '—' },
    { chave: 'membros', rotulo: 'Membros', numerico: true, render: (c) => c.total_membros },
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
          <h1 className="text-xl font-semibold text-[hsl(var(--texto))]">Comitês</h1>
          <p className="text-sm text-[hsl(var(--texto-secundario))]">
            Onde a campanha se organiza no território.
          </p>
        </div>
        <Botao onClick={() => definirAberto((valor) => !valor)}>
          <Plus className="size-4" aria-hidden="true" />
          Novo comitê
        </Botao>
      </header>

      {aberto ? (
        <form
          onSubmit={(evento) => void cadastrar(evento)}
          className="grid gap-3 rounded-[var(--raio)] border border-[hsl(var(--borda))] p-4 sm:grid-cols-2"
        >
          <Campo id="nome" rotulo="Nome" obrigatorio>
            <input
              id="nome"
              className={classeControle}
              value={nome}
              onChange={(e) => definirNome(e.target.value)}
              required
              minLength={3}
            />
          </Campo>

          <Campo id="tipo" rotulo="Tipo" obrigatorio>
            <select
              id="tipo"
              className={classeControle}
              value={tipo}
              onChange={(e) => definirTipo(e.target.value as TipoComite)}
            >
              {TipoComite.options.map((opcao) => (
                <option key={opcao} value={opcao}>
                  {RotuloTipoComite[opcao]}
                </option>
              ))}
            </select>
          </Campo>

          <Campo id="telefone" rotulo="Telefone de contato">
            <input
              id="telefone"
              className={classeControle}
              value={telefone}
              onChange={(e) => definirTelefone(e.target.value)}
              inputMode="tel"
            />
          </Campo>

          <Campo id="horario" rotulo="Horário de funcionamento">
            <input
              id="horario"
              className={classeControle}
              value={horario}
              onChange={(e) => definirHorario(e.target.value)}
              placeholder="Seg a sex, 9h às 18h"
            />
          </Campo>

          {erroFormulario ? (
            <p role="alert" className="text-sm text-[hsl(var(--perigo))] sm:col-span-2">
              {erroFormulario}
            </p>
          ) : null}

          <div className="flex gap-2 sm:col-span-2">
            <Botao type="submit" carregando={salvando}>
              Criar comitê
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
          titulo="Nenhum comitê cadastrado"
          descricao="O comitê organiza a militância por território e vira o local das atividades."
        />
      ) : (
        <Tabela colunas={colunas} linhas={dados?.itens ?? []} chaveDe={(c) => c.id} />
      )}
    </main>
  );
}
