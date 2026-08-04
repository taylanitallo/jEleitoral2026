'use client';

import { MapPin, Pencil } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Botao, EstadoCarregando } from '@jeleitoral/ui';
import { FormularioEntrevista } from '@/componentes/campo/FormularioEntrevista';
import { IndicadorFilaOffline } from '@/componentes/IndicadorFilaOffline';
import { Campo, classeControle } from '@/componentes/cadastro/Campo';
import { ErroDaApi, api } from '@/lib/api';
import { useListagem } from '@/lib/useListagem';
import { useSessao } from '@/lib/useSessao';

interface Contexto {
  campanha: { id: string; nome: string; uf: string | null; anoPleito: number };
  cargos: Array<{ id: string; nome: string; quantidadeVotosPermitida: number }>;
  consentimento: { id: string; versao: string; texto: string } | null;
}

interface Municipio {
  idIbge: number;
  nome: string;
  uf: string;
}

interface DomicilioResolvido {
  id: string;
  enderecoResumido: string;
  criado: boolean;
}

/**
 * Tela de entrevista em campo.
 *
 * Antes, os cargos, o domicílio e a versão do consentimento eram constantes no
 * código, com UUID de demonstração. Isso funcionava numa demonstração e em
 * nenhum outro lugar: a entrevista gravava contra identificadores que não
 * pertenciam à organização, e o gatilho de consentimento recusava a conclusão
 * com uma mensagem que parecia defeito do formulário.
 *
 * O fluxo agora é o da porta da casa: o entrevistador diz onde está, e só
 * depois começa a entrevistar. O endereço fica fixo no topo enquanto ele
 * atende a casa inteira — trocar de morador não pode significar redigitar a rua.
 */
export default function PaginaEntrevista(): JSX.Element {
  const { idCampanha, carregando: carregandoSessao } = useSessao();

  const { dados: contexto, carregando } = useListagem<Contexto>(
    idCampanha ? `/campo/contexto?idCampanha=${idCampanha}` : null,
  );

  const uf = contexto?.campanha.uf ?? null;
  const { dados: municipios } = useListagem<Municipio[]>(
    uf ? `/territorio/municipios?uf=${uf}` : null,
  );

  const [idMunicipio, definirIdMunicipio] = useState('');
  const [bairro, definirBairro] = useState('');
  const [logradouro, definirLogradouro] = useState('');
  const [numero, definirNumero] = useState('');
  const [complemento, definirComplemento] = useState('');
  const [resolvendo, definirResolvendo] = useState(false);
  const [erro, definirErro] = useState<string | null>(null);
  const [domicilio, definirDomicilio] = useState<DomicilioResolvido | null>(null);

  // Município único na UF é raro, mas quando a campanha é municipal a lista vem
  // com um só — obrigar a escolher o óbvio é atrito puro em tela de celular.
  useEffect(() => {
    if (municipios?.length === 1 && !idMunicipio) {
      definirIdMunicipio(String(municipios[0]!.idIbge));
    }
  }, [municipios, idMunicipio]);

  async function resolverEndereco(evento: React.FormEvent): Promise<void> {
    evento.preventDefault();
    definirResolvendo(true);
    definirErro(null);
    try {
      const resolvido = await api.enviar<DomicilioResolvido>('/campo/domicilios', {
        idCampanha,
        idMunicipio: Number(idMunicipio),
        bairro,
        logradouro,
        numero: numero || 'SN',
        complemento: complemento || undefined,
      });
      definirDomicilio(resolvido);
    } catch (falha) {
      definirErro(
        falha instanceof ErroDaApi ? falha.message : 'Não foi possível registrar o endereço.',
      );
    } finally {
      definirResolvendo(false);
    }
  }

  if (carregandoSessao || carregando) return <EstadoCarregando />;

  if (!idCampanha) {
    return (
      <main className="mx-auto max-w-2xl px-4 py-6">
        <p role="alert" className="text-sm text-[hsl(var(--perigo))]">
          Seu acesso não está vinculado a nenhuma campanha. Peça ao administrador para incluí-lo.
        </p>
      </main>
    );
  }

  if (!contexto?.consentimento) {
    // Sem termo vigente não se coleta: o gatilho do banco recusaria a conclusão
    // de qualquer forma, e descobrir isso depois de vinte entrevistas seria
    // perder as vinte.
    return (
      <main className="mx-auto max-w-2xl px-4 py-6">
        <p role="alert" className="text-sm text-[hsl(var(--perigo))]">
          Nenhum termo de consentimento vigente nesta organização. A coleta não pode começar sem
          ele — fale com o coordenador.
        </p>
      </main>
    );
  }

  return (
    <main className="mx-auto flex max-w-2xl flex-col gap-4 px-4 py-6">
      <header>
        <h1 className="text-xl font-semibold text-[hsl(var(--texto))]">Nova entrevista</h1>
        <p className="text-sm text-[hsl(var(--texto-secundario))]">{contexto.campanha.nome}</p>
      </header>

      <IndicadorFilaOffline />

      {domicilio ? (
        <div className="flex items-center gap-2 rounded-[var(--raio)] border border-[hsl(var(--borda))] bg-[hsl(var(--fundo-sutil))] px-3 py-2">
          <MapPin className="size-4 shrink-0 text-[hsl(var(--acento))]" aria-hidden="true" />
          <span className="min-w-0 flex-1 text-sm text-[hsl(var(--texto))]">
            {domicilio.enderecoResumido}
          </span>
          <Botao variante="sutil" tamanho="pequeno" onClick={() => definirDomicilio(null)}>
            <Pencil className="size-3.5" aria-hidden="true" />
            Trocar
          </Botao>
        </div>
      ) : (
        <form
          onSubmit={(evento) => void resolverEndereco(evento)}
          className="flex flex-col gap-3 rounded-[var(--raio)] border border-[hsl(var(--borda))] p-4"
        >
          <p className="text-sm font-medium text-[hsl(var(--texto))]">Onde você está?</p>

          <Campo id="municipio" rotulo="Município" obrigatorio>
            <select
              id="municipio"
              className={classeControle}
              value={idMunicipio}
              onChange={(e) => definirIdMunicipio(e.target.value)}
              required
            >
              <option value="">Selecione…</option>
              {(municipios ?? []).map((municipio) => (
                <option key={municipio.idIbge} value={municipio.idIbge}>
                  {municipio.nome}
                </option>
              ))}
            </select>
          </Campo>

          <Campo id="bairro" rotulo="Bairro" obrigatorio>
            <input
              id="bairro"
              className={classeControle}
              value={bairro}
              onChange={(e) => definirBairro(e.target.value)}
              required
              minLength={2}
              autoComplete="off"
            />
          </Campo>

          <Campo
            id="logradouro"
            rotulo="Rua"
            obrigatorio
            dica="Pode abreviar: R., Av., Trav. — o sistema entende."
          >
            <input
              id="logradouro"
              className={classeControle}
              value={logradouro}
              onChange={(e) => definirLogradouro(e.target.value)}
              required
              minLength={3}
              autoComplete="off"
            />
          </Campo>

          <div className="grid grid-cols-2 gap-3">
            <Campo id="numero" rotulo="Número" dica="Vazio vira SN.">
              <input
                id="numero"
                className={classeControle}
                value={numero}
                onChange={(e) => definirNumero(e.target.value)}
                inputMode="numeric"
                autoComplete="off"
              />
            </Campo>
            <Campo id="complemento" rotulo="Complemento">
              <input
                id="complemento"
                className={classeControle}
                value={complemento}
                onChange={(e) => definirComplemento(e.target.value)}
                autoComplete="off"
              />
            </Campo>
          </div>

          {erro ? (
            <p role="alert" className="text-sm text-[hsl(var(--perigo))]">
              {erro}
            </p>
          ) : null}

          <Botao type="submit" carregando={resolvendo}>
            Começar entrevista
          </Botao>
        </form>
      )}

      {domicilio ? (
        <FormularioEntrevista
          idCampanha={idCampanha}
          idDomicilio={domicilio.id}
          enderecoResumido={domicilio.enderecoResumido}
          cargos={contexto.cargos}
          idVersaoConsentimento={contexto.consentimento.id}
          textoConsentimento={contexto.consentimento.texto}
        />
      ) : null}
    </main>
  );
}
