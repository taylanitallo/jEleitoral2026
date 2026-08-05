'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import {
  BarraAcoes,
  Botao,
  EstadoCarregando,
  EstadoErro,
  EstadoVazio,
  ModalConfirmacao,
  useConfirmacao,
} from '@jeleitoral/ui';
import { RotuloAbrangenciaCampanha, type AbrangenciaCampanha } from '@jeleitoral/tipos';
import { Campo, classeControle } from '@/componentes/cadastro/Campo';
import { Tabela } from '@/componentes/cadastro/Tabela';
import { ErroDaApi, api } from '@/lib/api';
import { useListagem } from '@/lib/useListagem';
import { useOpcoesFiltro } from '@/lib/useOpcoesFiltro';

interface Campanha {
  id: string;
  nome: string;
  abrangencia: AbrangenciaCampanha;
  uf: string | null;
  id_municipio_base: number | null;
  nome_municipio: string | null;
  ano_pleito: number;
  ativa: boolean;
}

interface Municipio {
  idIbge: number;
  nome: string;
  uf: string;
}

interface Pagina {
  itens: Campanha[];
  total: number;
}

const ABRANGENCIAS: AbrangenciaCampanha[] = ['FEDERAL', 'ESTADUAL', 'MUNICIPAL'];

export default function PaginaCampanhas(): JSX.Element {
  const { dados, carregando, erro, recarregar } = useListagem<Pagina>('/campanhas?limite=100');
  const { opcoes } = useOpcoesFiltro();
  const confirmacao = useConfirmacao<Campanha>();

  const [emEdicao, definirEmEdicao] = useState<Campanha | null>(null);
  const [formularioAberto, definirFormularioAberto] = useState(false);
  const [salvando, definirSalvando] = useState(false);
  const [erroSalvar, definirErroSalvar] = useState<string | null>(null);
  // Fora do FormData porque o município depende da UF escolhida — o select de
  // município é alimentado sob demanda, e não dá para ler `defaultValue` de um
  // <select> cujas opções ainda não chegaram.
  const [ufFormulario, definirUfFormulario] = useState('');
  const [idMunicipio, definirIdMunicipio] = useState('');

  const { dados: municipios } = useListagem<Municipio[]>(
    ufFormulario ? `/territorio/municipios?uf=${ufFormulario}` : null,
  );

  function abrirNova(): void {
    definirEmEdicao(null);
    definirErroSalvar(null);
    definirUfFormulario('');
    definirIdMunicipio('');
    definirFormularioAberto(true);
  }

  function abrirEdicao(campanha: Campanha): void {
    definirEmEdicao(campanha);
    definirErroSalvar(null);
    definirUfFormulario(campanha.uf ?? '');
    definirIdMunicipio(campanha.id_municipio_base ? String(campanha.id_municipio_base) : '');
    definirFormularioAberto(true);
  }

  async function salvar(evento: React.FormEvent<HTMLFormElement>): Promise<void> {
    evento.preventDefault();
    const formulario = new FormData(evento.currentTarget);
    const abrangencia = String(formulario.get('abrangencia')) as AbrangenciaCampanha;

    const corpo = {
      nome: String(formulario.get('nome')).trim(),
      abrangencia,
      // UF só faz sentido fora do âmbito federal; enviar sempre gravaria um
      // estado numa campanha presidencial e bagunçaria os recortes do painel.
      uf: abrangencia === 'FEDERAL' ? undefined : String(formulario.get('uf')) || undefined,
      // Idem para município: só existe dentro de uma UF escolhida.
      idMunicipioBase: abrangencia === 'FEDERAL' || !idMunicipio ? undefined : Number(idMunicipio),
      anoPleito: Number(formulario.get('anoPleito')),
    };

    definirSalvando(true);
    definirErroSalvar(null);
    try {
      if (emEdicao) await api.atualizar(`/campanhas/${emEdicao.id}`, corpo);
      else await api.enviar('/campanhas', corpo);
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

  async function desativarConfirmado(): Promise<void> {
    const campanha = confirmacao.alvo;
    if (!campanha) return;
    await api.excluir(`/campanhas/${campanha.id}`);
    confirmacao.fechar();
    recarregar();
  }

  return (
    <main className="mx-auto flex max-w-6xl flex-col gap-4 px-4 py-6">
      <BarraAcoes
        titulo="Campanhas"
        subtitulo={dados ? `${dados.total} cadastrada(s)` : undefined}
        atualizar={{ aoAcionar: recarregar, carregando }}
        novo={{ aoAcionar: abrirNova, rotulo: 'Nova campanha' }}
        imprimir={{}}
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
              minLength={3}
              maxLength={120}
              defaultValue={emEdicao?.nome ?? ''}
              className={classeControle}
            />
          </Campo>

          <Campo id="anoPleito" rotulo="Ano do pleito" obrigatorio>
            <input
              id="anoPleito"
              name="anoPleito"
              type="number"
              required
              min={2024}
              max={2100}
              defaultValue={emEdicao?.ano_pleito ?? 2026}
              className={classeControle}
            />
          </Campo>

          <Campo id="abrangencia" rotulo="Abrangência" obrigatorio>
            <select
              id="abrangencia"
              name="abrangencia"
              required
              defaultValue={emEdicao?.abrangencia ?? 'ESTADUAL'}
              className={classeControle}
            >
              {ABRANGENCIAS.map((valor) => (
                <option key={valor} value={valor}>
                  {RotuloAbrangenciaCampanha[valor]}
                </option>
              ))}
            </select>
          </Campo>

          <Campo id="uf" rotulo="UF" dica="Deixe em branco para campanha federal.">
            <select
              id="uf"
              name="uf"
              value={ufFormulario}
              onChange={(evento) => {
                definirUfFormulario(evento.target.value);
                // Trocar de UF invalida o município escolhido — um município
                // do Ceará não existe na lista da Bahia.
                definirIdMunicipio('');
              }}
              className={classeControle}
            >
              <option value="">—</option>
              {opcoes.uf.map((opcao) => (
                <option key={opcao.valor} value={opcao.valor}>
                  {opcao.rotulo}
                </option>
              ))}
            </select>
          </Campo>

          <Campo
            id="idMunicipio"
            rotulo="Município"
            dica="A campanha É o município — é o que orienta o formulário de campo e os filtros."
          >
            <select
              id="idMunicipio"
              value={idMunicipio}
              onChange={(evento) => definirIdMunicipio(evento.target.value)}
              disabled={!ufFormulario}
              className={classeControle}
            >
              <option value="">{ufFormulario ? 'Selecione…' : 'Escolha a UF primeiro'}</option>
              {(municipios ?? []).map((municipio) => (
                <option key={municipio.idIbge} value={municipio.idIbge}>
                  {municipio.nome}
                </option>
              ))}
            </select>
          </Campo>

          {erroSalvar ? (
            <p role="alert" className="text-sm text-[hsl(var(--perigo))] sm:col-span-2">
              {erroSalvar}
            </p>
          ) : null}

          <div className="flex gap-2 sm:col-span-2">
            <Botao type="submit" carregando={salvando}>
              {emEdicao ? 'Salvar alterações' : 'Criar campanha'}
            </Botao>
            <Botao
              type="button"
              variante="sutil"
              onClick={() => {
                definirFormularioAberto(false);
                definirUfFormulario('');
                definirIdMunicipio('');
              }}
            >
              Cancelar
            </Botao>
          </div>
        </form>
      ) : null}

      {erro ? (
        <EstadoErro
          mensagem={erro.corpo.mensagem}
          idCorrelacao={erro.corpo.idCorrelacao}
          semConexao={erro.semConexao}
          aoTentarNovamente={recarregar}
        />
      ) : carregando && !dados ? (
        <EstadoCarregando mensagem="Carregando campanhas…" linhas={3} />
      ) : !dados || dados.itens.length === 0 ? (
        <EstadoVazio
          titulo="Nenhuma campanha cadastrada"
          descricao="Crie a primeira campanha para liberar as telas de campo, metas e projeção."
        />
      ) : (
        <Tabela
          linhas={dados.itens}
          chaveDe={(linha) => linha.id}
          colunas={[
            { chave: 'nome', rotulo: 'Nome', render: (linha) => linha.nome },
            {
              chave: 'abrangencia',
              rotulo: 'Abrangência',
              render: (linha) => RotuloAbrangenciaCampanha[linha.abrangencia] ?? linha.abrangencia,
            },
            { chave: 'uf', rotulo: 'UF', render: (linha) => linha.uf ?? '—' },
            {
              chave: 'municipio',
              rotulo: 'Município',
              render: (linha) => linha.nome_municipio ?? '—',
            },
            { chave: 'ano', rotulo: 'Pleito', numerico: true, render: (linha) => linha.ano_pleito },
            {
              chave: 'ativa',
              rotulo: 'Situação',
              render: (linha) => (linha.ativa ? 'Ativa' : 'Desativada'),
            },
            {
              chave: 'acoes',
              rotulo: 'Ações',
              render: (linha) => (
                <span className="flex gap-1">
                  <Botao variante="sutil" tamanho="pequeno" onClick={() => abrirEdicao(linha)}>
                    Editar
                  </Botao>
                  <Link href={`/cadastros/campanhas/${linha.id}/cargos`}>
                    <Botao variante="sutil" tamanho="pequeno">
                      Cargos
                    </Botao>
                  </Link>
                  {linha.ativa ? (
                    <Botao
                      variante="sutil"
                      tamanho="pequeno"
                      onClick={() => confirmacao.solicitar(linha)}
                    >
                      Desativar
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
        titulo={`Desativar "${confirmacao.alvo?.nome ?? ''}"?`}
        descricao="A campanha deixa de aparecer nas telas de campo."
        consequencia="Os dados já coletados permanecem e o histórico de auditoria não é apagado. A campanha pode ser reativada depois."
        rotuloConfirmar="Desativar"
        destrutivo
        aoConfirmar={desativarConfirmado}
      />
    </main>
  );
}
