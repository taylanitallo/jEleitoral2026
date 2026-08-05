'use client';

import { useParams } from 'next/navigation';
import { useEffect, useMemo, useState } from 'react';
import { BarraAcoes, Botao, EstadoCarregando, EstadoErro } from '@jeleitoral/ui';
import { ErroDaApi, api } from '@/lib/api';
import { useListagem } from '@/lib/useListagem';

interface CargoGeral {
  id: string;
  codigoTse: number;
  nome: string;
  quantidadeVotosPermitida: number;
}

interface CargoDeclarado {
  idCargo: string;
  nome: string;
  disputa: boolean;
  ordem: number;
}

interface LinhaCargo {
  idCargo: string;
  nome: string;
  disputa: boolean;
  ordem: number;
}

/**
 * Cargos que a campanha disputa.
 *
 * `disputa=false` não some do formulário de campo — a campanha continua
 * perguntando sobre o cargo, só não marca que tem candidato próprio nele. É
 * a diferença entre "não nos interessa" e "não temos candidato, mas queremos
 * saber o que o eleitor pensa do palanque".
 */
export default function PaginaCargosCampanha(): JSX.Element {
  const parametros = useParams<{ id: string }>();
  const idCampanha = parametros.id;

  const { dados: todosOsCargos, carregando: carregandoCargos } =
    useListagem<CargoGeral[]>('/candidatos/cargos');
  const {
    dados: declarados,
    carregando: carregandoDeclarados,
    erro,
  } = useListagem<CargoDeclarado[]>(`/campanhas/${idCampanha}/cargos`);

  const [linhas, definirLinhas] = useState<LinhaCargo[] | null>(null);
  const [salvando, definirSalvando] = useState(false);
  const [erroSalvar, definirErroSalvar] = useState<string | null>(null);
  const [salvo, definirSalvo] = useState(false);

  // Junta a lista fechada de cargos com o que a campanha já declarou. Cargo
  // ainda não declarado entra com disputa=false — não presumir candidato só
  // porque o cargo existe.
  useEffect(() => {
    if (!todosOsCargos || !declarados) return;
    const porId = new Map(declarados.map((linha) => [linha.idCargo, linha]));
    definirLinhas(
      todosOsCargos
        .map((cargo, indice) => {
          const existente = porId.get(cargo.id);
          return {
            idCargo: cargo.id,
            nome: cargo.nome,
            disputa: existente?.disputa ?? false,
            ordem: existente?.ordem ?? indice,
          };
        })
        .sort((a, b) => a.ordem - b.ordem),
    );
  }, [todosOsCargos, declarados]);

  const carregando = carregandoCargos || carregandoDeclarados || !linhas;

  async function salvar(): Promise<void> {
    if (!linhas) return;
    definirSalvando(true);
    definirErroSalvar(null);
    definirSalvo(false);
    try {
      await api.atualizar(`/campanhas/${idCampanha}/cargos`, linhas);
      definirSalvo(true);
    } catch (falha) {
      definirErroSalvar(
        falha instanceof ErroDaApi ? falha.corpo.mensagem : 'Não foi possível salvar.',
      );
    } finally {
      definirSalvando(false);
    }
  }

  const totalDisputa = useMemo(() => linhas?.filter((l) => l.disputa).length ?? 0, [linhas]);

  return (
    <main className="mx-auto flex max-w-2xl flex-col gap-4 px-4 py-6">
      <BarraAcoes
        titulo="Cargos da campanha"
        subtitulo={linhas ? `${totalDisputa} de ${linhas.length} com candidato próprio` : undefined}
      />

      {erro ? (
        <EstadoErro
          mensagem={erro.corpo.mensagem}
          idCorrelacao={erro.corpo.idCorrelacao}
          semConexao={erro.semConexao}
        />
      ) : carregando ? (
        <EstadoCarregando mensagem="Carregando cargos…" linhas={5} />
      ) : (
        <>
          <p className="text-sm text-[hsl(var(--texto-secundario))]">
            Todo cargo aqui aparece no formulário de campo. Marque{' '}
            <strong>&quot;temos candidato&quot;</strong> nos cargos da sua chapa — os demais
            continuam perguntados, só não entram como candidatura própria.
          </p>

          <ul className="flex flex-col gap-2">
            {linhas!.map((linha, indice) => (
              <li
                key={linha.idCargo}
                className="flex items-center gap-3 rounded-[var(--raio)] border border-[hsl(var(--borda))] bg-[hsl(var(--superficie))] px-3 py-2"
              >
                <span className="flex-1 text-sm text-[hsl(var(--texto))]">{linha.nome}</span>
                <label className="flex items-center gap-2 text-sm text-[hsl(var(--texto-secundario))]">
                  <input
                    type="checkbox"
                    checked={linha.disputa}
                    onChange={(evento) =>
                      definirLinhas((atual) =>
                        atual!.map((item, i) =>
                          i === indice ? { ...item, disputa: evento.target.checked } : item,
                        ),
                      )
                    }
                    className="size-4"
                  />
                  Temos candidato
                </label>
              </li>
            ))}
          </ul>

          {erroSalvar ? (
            <p role="alert" className="text-sm text-[hsl(var(--perigo))]">
              {erroSalvar}
            </p>
          ) : null}
          {salvo ? (
            <p role="status" className="text-sm text-[hsl(var(--sucesso))]">
              Salvo. O formulário de campo usa esta lista a partir da próxima entrevista.
            </p>
          ) : null}

          <div>
            <Botao onClick={() => void salvar()} carregando={salvando}>
              Salvar
            </Botao>
          </div>
        </>
      )}
    </main>
  );
}
