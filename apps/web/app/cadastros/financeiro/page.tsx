'use client';

import { useState } from 'react';
import {
  AvisoNaoSubstitui,
  BarraAcoes,
  Botao,
  EstadoCarregando,
  EstadoErro,
  EstadoVazio,
} from '@jeleitoral/ui';
import {
  FormaPagamento,
  NivelTerritorial,
  RotuloNivelTerritorial,
  StatusLancamento,
  TipoLancamento,
  type NivelTerritorial as Nivel,
} from '@jeleitoral/tipos';
import { Campo, classeControle } from '@/componentes/cadastro/Campo';
import { CartaoIndicador } from '@/componentes/dashboard/CartaoIndicador';
import { Tabela } from '@/componentes/cadastro/Tabela';
import { ErroDaApi, api } from '@/lib/api';
import { useListagem } from '@/lib/useListagem';
import { useSessao } from '@/lib/useSessao';

interface Resumo {
  totalReceita: number;
  totalDespesa: number;
  saldo: number;
  queimaDiaria: number;
  diasDeCaixa: number | null;
  diasFaltandoParaOPleito: number;
  alerta: string | null;
}

interface CustoTerritorio {
  nivel: string;
  idTerritorio: string;
  nome?: string;
  total: number;
  eleitoresMapeados?: number;
  custoPorEleitor?: number | null;
}

const reais = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });

export default function PaginaFinanceiro(): JSX.Element {
  const { idCampanha, carregando: carregandoSessao } = useSessao();

  const resumo = useListagem<Resumo>(
    idCampanha ? `/financeiro/resumo?idCampanha=${idCampanha}` : null,
  );
  const custos = useListagem<CustoTerritorio[]>(
    idCampanha ? `/financeiro/custo-por-territorio?idCampanha=${idCampanha}` : null,
  );

  const [aberto, definirAberto] = useState(false);
  const [salvando, definirSalvando] = useState(false);
  const [erroSalvar, definirErroSalvar] = useState<string | null>(null);

  async function lancar(evento: React.FormEvent<HTMLFormElement>): Promise<void> {
    evento.preventDefault();
    if (!idCampanha) return;
    const formulario = new FormData(evento.currentTarget);
    const nivel = String(formulario.get('nivelTerritorio'));

    definirSalvando(true);
    definirErroSalvar(null);
    try {
      await api.enviar('/financeiro/lancamentos', {
        idCampanha,
        tipo: String(formulario.get('tipo')),
        descricao: String(formulario.get('descricao')).trim(),
        valor: Number(formulario.get('valor')),
        dataCompetencia: String(formulario.get('dataCompetencia')),
        dataPagamento: String(formulario.get('dataPagamento')) || undefined,
        formaPagamento: String(formulario.get('formaPagamento')) || undefined,
        status: String(formulario.get('status')),
        // Território é opcional, mas ou vão os dois campos ou nenhum: um nível
        // sem identificador produz um custo que nenhuma tela consegue somar.
        nivelTerritorio: nivel || undefined,
        idTerritorio: nivel ? String(formulario.get('idTerritorio')).trim() || undefined : undefined,
      });
      definirAberto(false);
      resumo.recarregar();
      custos.recarregar();
    } catch (falha) {
      definirErroSalvar(
        falha instanceof ErroDaApi ? falha.corpo.mensagem : 'Não foi possível lançar.',
      );
    } finally {
      definirSalvando(false);
    }
  }

  if (carregandoSessao) return <EstadoCarregando mensagem="Carregando…" linhas={3} />;

  if (!idCampanha) {
    return (
      <main className="mx-auto max-w-6xl px-4 py-6">
        <EstadoVazio titulo="Nenhuma campanha vinculada" />
      </main>
    );
  }

  return (
    <main className="mx-auto flex max-w-6xl flex-col gap-4 px-4 py-6">
      <BarraAcoes
        titulo="Financeiro"
        subtitulo="Controle gerencial da campanha"
        atualizar={{
          aoAcionar: () => {
            resumo.recarregar();
            custos.recarregar();
          },
          carregando: resumo.carregando || custos.carregando,
        }}
        novo={{ aoAcionar: () => definirAberto(true), rotulo: 'Novo lançamento' }}
        imprimir={{}}
      />

      <AvisoNaoSubstitui contexto="financeiro" />

      {aberto ? (
        <form
          onSubmit={(evento) => void lancar(evento)}
          className="grid gap-3 rounded-[var(--raio)] border border-[hsl(var(--borda))] bg-[hsl(var(--superficie))] p-4 sm:grid-cols-3"
        >
          <Campo id="tipo" rotulo="Tipo" obrigatorio>
            <select id="tipo" name="tipo" required className={classeControle}>
              {TipoLancamento.options.map((valor) => (
                <option key={valor} value={valor}>
                  {valor === 'RECEITA' ? 'Receita' : 'Despesa'}
                </option>
              ))}
            </select>
          </Campo>

          <Campo id="valor" rotulo="Valor (R$)" obrigatorio>
            <input
              id="valor"
              name="valor"
              type="number"
              step="0.01"
              min="0.01"
              required
              className={classeControle}
            />
          </Campo>

          <Campo id="status" rotulo="Situação" obrigatorio>
            <select id="status" name="status" required defaultValue="PREVISTO" className={classeControle}>
              {StatusLancamento.options.map((valor) => (
                <option key={valor} value={valor}>
                  {valor.charAt(0) + valor.slice(1).toLowerCase()}
                </option>
              ))}
            </select>
          </Campo>

          <Campo id="descricao" rotulo="Descrição" obrigatorio>
            <input
              id="descricao"
              name="descricao"
              required
              minLength={3}
              maxLength={300}
              className={classeControle}
            />
          </Campo>

          <Campo id="dataCompetencia" rotulo="Competência" obrigatorio>
            <input
              id="dataCompetencia"
              name="dataCompetencia"
              type="date"
              required
              className={classeControle}
            />
          </Campo>

          <Campo id="dataPagamento" rotulo="Pagamento">
            <input id="dataPagamento" name="dataPagamento" type="date" className={classeControle} />
          </Campo>

          <Campo id="formaPagamento" rotulo="Forma de pagamento">
            <select id="formaPagamento" name="formaPagamento" className={classeControle}>
              <option value="">—</option>
              {FormaPagamento.options.map((valor) => (
                <option key={valor} value={valor}>
                  {valor.charAt(0) + valor.slice(1).toLowerCase()}
                </option>
              ))}
            </select>
          </Campo>

          <Campo id="nivelTerritorio" rotulo="Nível do território">
            <select id="nivelTerritorio" name="nivelTerritorio" className={classeControle}>
              <option value="">—</option>
              {NivelTerritorial.options.map((valor: Nivel) => (
                <option key={valor} value={valor}>
                  {RotuloNivelTerritorial[valor]}
                </option>
              ))}
            </select>
          </Campo>

          <Campo id="idTerritorio" rotulo="Território" dica="Código do município, bairro ou seção.">
            <input id="idTerritorio" name="idTerritorio" className={classeControle} />
          </Campo>

          {erroSalvar ? (
            <p role="alert" className="text-sm text-[hsl(var(--perigo))] sm:col-span-3">
              {erroSalvar}
            </p>
          ) : null}

          <div className="flex gap-2 sm:col-span-3">
            <Botao type="submit" carregando={salvando}>
              Lançar
            </Botao>
            <Botao type="button" variante="sutil" onClick={() => definirAberto(false)}>
              Cancelar
            </Botao>
          </div>
        </form>
      ) : null}

      {resumo.erro ? (
        <EstadoErro
          mensagem={resumo.erro.corpo.mensagem}
          idCorrelacao={resumo.erro.corpo.idCorrelacao}
          semConexao={resumo.erro.semConexao}
          aoTentarNovamente={resumo.recarregar}
        />
      ) : resumo.carregando && !resumo.dados ? (
        <EstadoCarregando mensagem="Calculando indicadores…" linhas={2} />
      ) : resumo.dados ? (
        <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <CartaoIndicador rotulo="Receitas" valor={reais.format(resumo.dados.totalReceita)} />
          <CartaoIndicador rotulo="Despesas" valor={reais.format(resumo.dados.totalDespesa)} />
          <CartaoIndicador
            rotulo="Saldo"
            valor={reais.format(resumo.dados.saldo)}
            detalhe={`Queima de ${reais.format(resumo.dados.queimaDiaria)}/dia`}
          />
          <CartaoIndicador
            rotulo="Fôlego de caixa"
            valor={
              resumo.dados.diasDeCaixa === null ? '—' : `${resumo.dados.diasDeCaixa} dias`
            }
            detalhe={`Faltam ${resumo.dados.diasFaltandoParaOPleito} dias para o pleito`}
            advertencia={resumo.dados.alerta}
          />
        </section>
      ) : null}

      <section className="flex flex-col gap-2">
        <h2 className="text-sm font-medium text-[hsl(var(--texto))]">Custo por território</h2>
        {custos.carregando && !custos.dados ? (
          <EstadoCarregando linhas={2} />
        ) : !custos.dados || custos.dados.length === 0 ? (
          <EstadoVazio
            titulo="Nenhum gasto territorializado"
            descricao="Informe o território ao lançar a despesa para acompanhar o custo por eleitor mapeado."
          />
        ) : (
          <Tabela
            linhas={custos.dados}
            chaveDe={(linha) => `${linha.nivel}:${linha.idTerritorio}`}
            colunas={[
              {
                chave: 'nivel',
                rotulo: 'Nível',
                render: (linha) => RotuloNivelTerritorial[linha.nivel as Nivel] ?? linha.nivel,
              },
              {
                chave: 'territorio',
                rotulo: 'Território',
                render: (linha) => linha.nome ?? linha.idTerritorio,
              },
              {
                chave: 'total',
                rotulo: 'Gasto',
                numerico: true,
                render: (linha) => reais.format(linha.total),
              },
              {
                chave: 'eleitores',
                rotulo: 'Eleitores mapeados',
                numerico: true,
                render: (linha) => linha.eleitoresMapeados?.toLocaleString('pt-BR') ?? '—',
              },
              {
                chave: 'custoEleitor',
                rotulo: 'Custo por eleitor',
                numerico: true,
                render: (linha) =>
                  linha.custoPorEleitor == null ? '—' : reais.format(linha.custoPorEleitor),
              },
            ]}
          />
        )}
      </section>
    </main>
  );
}
