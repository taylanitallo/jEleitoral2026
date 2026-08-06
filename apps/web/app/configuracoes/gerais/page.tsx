'use client';

import { useEffect, useState } from 'react';
import { BarraAcoes, Botao, EstadoCarregando, EstadoErro } from '@jeleitoral/ui';
import { RotuloStatusOrganizacao, type StatusOrganizacao } from '@jeleitoral/tipos';
import { Campo, classeControle } from '@/componentes/cadastro/Campo';
import { ErroDaApi, api } from '@/lib/api';
import { useListagem } from '@/lib/useListagem';

interface Organizacao {
  nome: string;
  razaoSocial: string | null;
  cnpj: string | null;
  corAcento: string | null;
  logoUrl: string | null;
  status: StatusOrganizacao;
  plano: string;
  contratadoEm: string;
  expiraEm: string | null;
}

/**
 * Dados gerais da organização — a aba "Gerais" de Configurações.
 *
 * Situação, plano e vigência aparecem só como leitura: mudam apenas pelo
 * backoffice do provedor. Editar aqui é o que a organização controla sobre
 * si mesma — identidade e a cor que a marca em todo o sistema.
 */
export default function PaginaConfiguracoesGerais(): JSX.Element {
  const { dados, carregando, erro, recarregar } = useListagem<Organizacao>('/organizacao');

  const [nome, definirNome] = useState('');
  const [razaoSocial, definirRazaoSocial] = useState('');
  const [cnpj, definirCnpj] = useState('');
  const [corAcento, definirCorAcento] = useState('');
  const [logoUrl, definirLogoUrl] = useState('');
  const [salvando, definirSalvando] = useState(false);
  const [erroSalvar, definirErroSalvar] = useState<string | null>(null);
  const [sucesso, definirSucesso] = useState(false);

  useEffect(() => {
    if (!dados) return;
    definirNome(dados.nome);
    definirRazaoSocial(dados.razaoSocial ?? '');
    definirCnpj(dados.cnpj ?? '');
    definirCorAcento(dados.corAcento ?? '');
    definirLogoUrl(dados.logoUrl ?? '');
  }, [dados]);

  async function salvar(evento: React.FormEvent): Promise<void> {
    evento.preventDefault();
    definirSalvando(true);
    definirErroSalvar(null);
    definirSucesso(false);
    try {
      await api.enviar('/organizacao', {
        nome: nome.trim(),
        razaoSocial: razaoSocial.trim() || undefined,
        cnpj: cnpj.trim() || undefined,
        corAcento: corAcento.trim() || undefined,
        logoUrl: logoUrl.trim() || undefined,
      });
      definirSucesso(true);
      recarregar();
    } catch (falha) {
      definirErroSalvar(
        falha instanceof ErroDaApi ? falha.corpo.mensagem : 'Não foi possível salvar.',
      );
    } finally {
      definirSalvando(false);
    }
  }

  return (
    <main className="mx-auto flex max-w-xl flex-col gap-4 px-4 py-6">
      <BarraAcoes titulo="Configurações — Gerais" />

      {erro ? (
        <EstadoErro
          mensagem={erro.corpo.mensagem}
          idCorrelacao={erro.corpo.idCorrelacao}
          semConexao={erro.semConexao}
          aoTentarNovamente={recarregar}
        />
      ) : carregando && !dados ? (
        <EstadoCarregando mensagem="Carregando…" linhas={4} />
      ) : (
        <>
          {dados ? (
            <dl className="grid grid-cols-2 gap-2 rounded-[var(--raio)] border border-[hsl(var(--borda))] bg-[hsl(var(--fundo-sutil))] p-3 text-sm">
              <dt className="text-[hsl(var(--texto-secundario))]">Situação</dt>
              <dd className="text-[hsl(var(--texto))]">{RotuloStatusOrganizacao[dados.status]}</dd>
              <dt className="text-[hsl(var(--texto-secundario))]">Plano</dt>
              <dd className="text-[hsl(var(--texto))]">{dados.plano}</dd>
              <dt className="text-[hsl(var(--texto-secundario))]">Contratado em</dt>
              <dd className="text-[hsl(var(--texto))]">
                {new Date(dados.contratadoEm).toLocaleDateString('pt-BR')}
              </dd>
              <dt className="text-[hsl(var(--texto-secundario))]">Expira em</dt>
              <dd className="text-[hsl(var(--texto))]">
                {dados.expiraEm ? new Date(dados.expiraEm).toLocaleDateString('pt-BR') : '—'}
              </dd>
            </dl>
          ) : null}
          <p className="text-xs text-[hsl(var(--texto-fraco))]">
            Situação, plano e vigência são administrados pelo provedor do sistema.
          </p>

          <form onSubmit={salvar} className="flex flex-col gap-3">
            <Campo id="nome" rotulo="Nome" obrigatorio>
              <input
                id="nome"
                value={nome}
                onChange={(evento) => definirNome(evento.target.value)}
                required
                minLength={2}
                className={classeControle}
              />
            </Campo>

            <Campo id="razaoSocial" rotulo="Razão social">
              <input
                id="razaoSocial"
                value={razaoSocial}
                onChange={(evento) => definirRazaoSocial(evento.target.value)}
                className={classeControle}
              />
            </Campo>

            <Campo id="cnpj" rotulo="CNPJ" dica="Guardado cifrado — nunca em texto claro.">
              <input
                id="cnpj"
                value={cnpj}
                onChange={(evento) => definirCnpj(evento.target.value)}
                placeholder="00.000.000/0000-00"
                className={classeControle}
              />
            </Campo>

            <Campo
              id="corAcento"
              rotulo="Cor de acento"
              dica='Formato HSL sem a função, ex.: "221 83% 45%".'
            >
              <input
                id="corAcento"
                value={corAcento}
                onChange={(evento) => definirCorAcento(evento.target.value)}
                placeholder="221 83% 45%"
                className={classeControle}
              />
            </Campo>

            <Campo id="logoUrl" rotulo="URL do logo">
              <input
                id="logoUrl"
                type="url"
                value={logoUrl}
                onChange={(evento) => definirLogoUrl(evento.target.value)}
                placeholder="https://…"
                className={classeControle}
              />
            </Campo>

            {erroSalvar ? (
              <p role="alert" className="text-sm text-[hsl(var(--perigo))]">
                {erroSalvar}
              </p>
            ) : null}
            {sucesso ? (
              <p role="status" className="text-sm text-[hsl(var(--apoiador))]">
                Salvo.
              </p>
            ) : null}

            <Botao type="submit" carregando={salvando} className="self-start">
              Salvar
            </Botao>
          </form>
        </>
      )}
    </main>
  );
}
