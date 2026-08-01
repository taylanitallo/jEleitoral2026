'use client';

import { useEffect, useState } from 'react';
import { BarraAcoes, Botao, EstadoCarregando, EstadoErro, EstadoVazio } from '@jeleitoral/ui';
import {
  RotuloTipoMaterialGrafico,
  TipoMaterialGrafico,
  type TipoMaterialGrafico as TipoMaterial,
} from '@jeleitoral/tipos';
import { Campo, classeControle } from '@/componentes/cadastro/Campo';
import { Tabela } from '@/componentes/cadastro/Tabela';
import { ErroDaApi, api } from '@/lib/api';
import { useListagem } from '@/lib/useListagem';
import { useSessao } from '@/lib/useSessao';

interface Versao {
  id: string;
  versao: number;
  formato: string;
  largura: number | null;
  altura: number | null;
  tamanhoBytes: number;
}

interface Material {
  id: string;
  tipo: TipoMaterial;
  titulo: string;
  descricao: string | null;
  publicado: boolean;
  id_candidato: string | null;
  versoes: Versao[] | null;
}

interface Candidato {
  id: string;
  nome_urna: string;
}

export default function PaginaArtes(): JSX.Element {
  const { idCampanha, carregando: carregandoSessao } = useSessao();
  const { dados, carregando, erro, recarregar } = useListagem<Material[]>(
    idCampanha ? `/artes?idCampanha=${idCampanha}` : null,
  );

  const [candidatos, definirCandidatos] = useState<Candidato[]>([]);
  const [aberto, definirAberto] = useState(false);
  const [salvando, definirSalvando] = useState(false);
  const [erroSalvar, definirErroSalvar] = useState<string | null>(null);

  useEffect(() => {
    if (!idCampanha) return;
    void api
      .obter<Candidato[]>(`/candidatos?idCampanha=${idCampanha}`)
      .then(definirCandidatos)
      .catch(() => definirCandidatos([]));
  }, [idCampanha]);

  async function salvar(evento: React.FormEvent<HTMLFormElement>): Promise<void> {
    evento.preventDefault();
    if (!idCampanha) return;
    const formulario = new FormData(evento.currentTarget);

    definirSalvando(true);
    definirErroSalvar(null);
    try {
      await api.enviar('/artes/materiais', {
        idCampanha,
        tipo: String(formulario.get('tipo')),
        titulo: String(formulario.get('titulo')).trim(),
        descricao: String(formulario.get('descricao')).trim() || undefined,
        idCandidato: String(formulario.get('idCandidato')) || undefined,
      });
      definirAberto(false);
      recarregar();
    } catch (falha) {
      definirErroSalvar(
        falha instanceof ErroDaApi ? falha.corpo.mensagem : 'Não foi possível salvar.',
      );
    } finally {
      definirSalvando(false);
    }
  }

  async function baixar(idVersao: string): Promise<void> {
    // A URL é assinada e de vida curta, e o download fica registrado na
    // auditoria — arte vazada antes da hora é problema de campanha, não de TI.
    const { url } = await api.obter<{ url: string }>(`/artes/versoes/${idVersao}/download`);
    window.open(url, '_blank', 'noopener');
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
        titulo="Artes gráficas"
        subtitulo={dados ? `${dados.length} material(is)` : undefined}
        atualizar={{ aoAcionar: recarregar, carregando }}
        novo={{ aoAcionar: () => definirAberto(true), rotulo: 'Novo material' }}
        imprimir={{}}
      />

      {aberto ? (
        <form
          onSubmit={(evento) => void salvar(evento)}
          className="grid gap-3 rounded-[var(--raio)] border border-[hsl(var(--borda))] bg-[hsl(var(--superficie))] p-4 sm:grid-cols-2"
        >
          <Campo id="titulo" rotulo="Título" obrigatorio>
            <input
              id="titulo"
              name="titulo"
              required
              minLength={3}
              maxLength={120}
              className={classeControle}
            />
          </Campo>

          <Campo id="tipo" rotulo="Tipo" obrigatorio>
            <select id="tipo" name="tipo" required className={classeControle}>
              {TipoMaterialGrafico.options.map((valor: TipoMaterial) => (
                <option key={valor} value={valor}>
                  {RotuloTipoMaterialGrafico[valor]}
                </option>
              ))}
            </select>
          </Campo>

          <Campo id="idCandidato" rotulo="Candidato">
            <select id="idCandidato" name="idCandidato" className={classeControle}>
              <option value="">Material da campanha</option>
              {candidatos.map((candidato) => (
                <option key={candidato.id} value={candidato.id}>
                  {candidato.nome_urna}
                </option>
              ))}
            </select>
          </Campo>

          <Campo id="descricao" rotulo="Descrição">
            <input id="descricao" name="descricao" maxLength={500} className={classeControle} />
          </Campo>

          {erroSalvar ? (
            <p role="alert" className="text-sm text-[hsl(var(--perigo))] sm:col-span-2">
              {erroSalvar}
            </p>
          ) : null}

          <div className="flex gap-2 sm:col-span-2">
            <Botao type="submit" carregando={salvando}>
              Criar material
            </Botao>
            <Botao type="button" variante="sutil" onClick={() => definirAberto(false)}>
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
        <EstadoCarregando mensagem="Carregando materiais…" linhas={3} />
      ) : !dados || dados.length === 0 ? (
        <EstadoVazio
          titulo="Nenhum material cadastrado"
          descricao="Cadastre o material e depois envie os arquivos de cada versão."
        />
      ) : (
        <Tabela
          linhas={dados}
          chaveDe={(linha) => linha.id}
          colunas={[
            { chave: 'titulo', rotulo: 'Título', render: (linha) => linha.titulo },
            {
              chave: 'tipo',
              rotulo: 'Tipo',
              render: (linha) => RotuloTipoMaterialGrafico[linha.tipo] ?? linha.tipo,
            },
            {
              chave: 'versoes',
              rotulo: 'Versões',
              numerico: true,
              render: (linha) => linha.versoes?.length ?? 0,
            },
            {
              chave: 'publicado',
              rotulo: 'Situação',
              render: (linha) => (linha.publicado ? 'Publicado' : 'Rascunho'),
            },
            {
              chave: 'acoes',
              rotulo: 'Ações',
              render: (linha) => {
                const ultima = linha.versoes?.[0];
                return ultima ? (
                  <Botao variante="sutil" tamanho="pequeno" onClick={() => void baixar(ultima.id)}>
                    Baixar v{ultima.versao}
                  </Botao>
                ) : (
                  <span className="text-xs text-[hsl(var(--texto-fraco))]">sem arquivo</span>
                );
              },
            },
          ]}
        />
      )}
    </main>
  );
}
