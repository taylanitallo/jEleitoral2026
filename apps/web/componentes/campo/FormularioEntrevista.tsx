'use client';

import { CheckCircle2, MapPin, ShieldCheck, TriangleAlert, UserRound } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import {
  Botao,
  EtiquetaClassificacao,
  TarjaUsoInterno,
  cn,
} from '@jeleitoral/ui';
import {
  ClassificacaoEleitor,
  RotuloClassificacaoEleitor,
  type EntradaEntrevista,
} from '@jeleitoral/tipos';
import { mascararTelefone, normalizarNomePessoa } from '@jeleitoral/utilitarios';
import { api, ErroDaApi } from '@/lib/api';
import { filaOffline } from '@/lib/filaOffline';
import { useGeolocalizacao } from '@/lib/useGeolocalizacao';

interface CargoDisponivel {
  id: string;
  nome: string;
  quantidadeVotosPermitida: number;
}

interface Sugestao {
  id: string;
  nome: string;
  apelido: string | null;
  mesmoDomicilio: boolean;
  similaridade: number;
}

export interface PropriedadesFormularioEntrevista {
  idCampanha: string;
  idDomicilio: string;
  enderecoResumido: string;
  cargos: CargoDisponivel[];
  idVersaoConsentimento: string;
  textoConsentimento: string;
  aoConcluir?: () => void;
}

const CLASSIFICACOES = ClassificacaoEleitor.options;

/**
 * Formulário de entrevista em campo.
 *
 * Três coisas o distinguem de um formulário comum, e todas vêm da realidade de
 * quem bate na porta:
 *
 *  1. **Grava na fila local, não na rede.** O botão "Salvar entrevista" escreve
 *     no IndexedDB e retorna. Nada depende de conexão para o entrevistador
 *     seguir para a próxima casa.
 *  2. **O consentimento é bloqueante.** Convicção política é dado sensível
 *     (LGPD, art. 5º, II). Sem o aceite registrado, o botão não habilita — e
 *     mesmo que habilitasse, o gatilho do banco recusaria a conclusão.
 *  3. **A checagem de duplicidade é oportunista.** Só roda com conexão; sem
 *     rede o formulário segue normalmente. Impedir o cadastro por falta de
 *     verificação seria trocar um problema pequeno (duplicata corrigível) por
 *     um grande (entrevista perdida).
 */
export function FormularioEntrevista({
  idCampanha,
  idDomicilio,
  enderecoResumido,
  cargos,
  idVersaoConsentimento,
  textoConsentimento,
  aoConcluir,
}: PropriedadesFormularioEntrevista): JSX.Element {
  const [nome, definirNome] = useState('');
  const [apelido, definirApelido] = useState('');
  const [telefone, definirTelefone] = useState('');
  const [classificacao, definirClassificacao] = useState<ClassificacaoEleitor>('NAO_INFORMOU');
  const [intencoes, definirIntencoes] = useState<Record<string, string>>({});
  const [observacoes, definirObservacoes] = useState('');
  const [recusouResponder, definirRecusou] = useState(false);
  const [consentiu, definirConsentiu] = useState(false);
  const [sugestoes, definirSugestoes] = useState<Sugestao[]>([]);
  const [salvando, definirSalvando] = useState(false);
  const [confirmacao, definirConfirmacao] = useState<string | null>(null);
  const [iniciadoEm] = useState(() => Date.now());

  const { posicao, estado: estadoGps, solicitar: solicitarGps } = useGeolocalizacao();

  // --- Duplicidade -----------------------------------------------------------
  const verificarDuplicidade = useCallback(
    async (valor: string) => {
      if (normalizarNomePessoa(valor).length < 4 || !navigator.onLine) {
        definirSugestoes([]);
        return;
      }
      try {
        const encontradas = await api.obter<Sugestao[]>(
          `/campo/entrevistados/duplicidade?idCampanha=${idCampanha}` +
            `&idDomicilio=${idDomicilio}&nome=${encodeURIComponent(valor)}`,
        );
        definirSugestoes(encontradas);
      } catch (erro) {
        // Sem rede ou API fora: o formulário continua. A duplicidade será
        // resolvida na curadoria, que é justamente para isso.
        if (!(erro instanceof ErroDaApi)) throw erro;
        definirSugestoes([]);
      }
    },
    [idCampanha, idDomicilio],
  );

  useEffect(() => {
    // Espera o entrevistador parar de digitar antes de consultar — em rede
    // fraca, uma requisição por tecla trava o aparelho.
    const temporizador = window.setTimeout(() => void verificarDuplicidade(nome), 600);
    return () => window.clearTimeout(temporizador);
  }, [nome, verificarDuplicidade]);

  // --- Validação -------------------------------------------------------------
  const temConteudo = recusouResponder || Object.values(intencoes).some((valor) => valor !== '');
  const podeSalvar =
    normalizarNomePessoa(nome).length >= 3 && consentiu && temConteudo && !salvando;

  async function salvar(): Promise<void> {
    if (!podeSalvar) return;
    definirSalvando(true);
    try {
      const agora = new Date();
      const entrevista: EntradaEntrevista = {
        idDomicilio,
        entrevistado: {
          nome: nome.trim(),
          apelido: apelido.trim() || undefined,
          telefone: telefone.replace(/\D+/g, '') || undefined,
          classificacao,
        },
        consentimento: {
          idVersaoConsentimento,
          canal: 'VERBAL_REGISTRADO',
          aceitoEm: agora,
          ...(posicao
            ? { latitude: posicao.latitude, longitude: posicao.longitude }
            : {}),
        },
        natureza: 'LEVANTAMENTO_INTERNO',
        dataHora: agora,
        duracaoSegundos: Math.round((Date.now() - iniciadoEm) / 1000),
        ...(posicao
          ? {
              latitude: posicao.latitude,
              longitude: posicao.longitude,
              precisaoGpsMetros: posicao.precisaoMetros,
            }
          : {}),
        dispositivo: navigator.userAgent.slice(0, 120),
        recusouResponder,
        observacoes: observacoes.trim() || undefined,
        intencoes: Object.entries(intencoes)
          .filter(([, numero]) => numero !== '')
          .map(([idCargo, numero]) => ({
            idCargo,
            numeroDeclarado: numero,
            grauCerteza: 3,
            votoDefinido: false,
          })),
        votosDomicilio: [],
        status: 'CONCLUIDA',
      } as EntradaEntrevista;

      await filaOffline.enfileirar(idCampanha, entrevista);

      definirConfirmacao(
        navigator.onLine
          ? 'Entrevista salva. Está subindo para o servidor.'
          : 'Entrevista salva no aparelho. Sobe sozinha quando o sinal voltar.',
      );
      limpar();
      aoConcluir?.();
    } finally {
      definirSalvando(false);
    }
  }

  function limpar(): void {
    definirNome('');
    definirApelido('');
    definirTelefone('');
    definirClassificacao('NAO_INFORMOU');
    definirIntencoes({});
    definirObservacoes('');
    definirRecusou(false);
    definirConsentiu(false);
    definirSugestoes([]);
  }

  const classeCampo =
    'h-11 w-full rounded-[var(--raio)] border border-[hsl(var(--borda))] bg-[hsl(var(--superficie))] px-3 text-base text-[hsl(var(--texto))]';

  return (
    <form
      className="flex flex-col gap-5"
      onSubmit={(evento) => {
        evento.preventDefault();
        void salvar();
      }}
    >
      <TarjaUsoInterno natureza="LEVANTAMENTO_INTERNO" />

      <p className="text-sm text-[hsl(var(--texto-secundario))]">
        <MapPin className="mr-1 inline size-4" aria-hidden="true" />
        {enderecoResumido}
      </p>

      {confirmacao ? (
        <p
          role="status"
          className="flex items-center gap-2 rounded-[var(--raio)] bg-[hsl(var(--apoiador-sutil))] px-3 py-2 text-sm text-[hsl(var(--apoiador))]"
        >
          <CheckCircle2 className="size-4 shrink-0" aria-hidden="true" />
          {confirmacao}
        </p>
      ) : null}

      {/* --- Identificação ---------------------------------------------------- */}
      <fieldset className="flex flex-col gap-3">
        <legend className="mb-1 flex items-center gap-2 text-sm font-medium text-[hsl(var(--texto))]">
          <UserRound className="size-4" aria-hidden="true" /> Quem está respondendo
        </legend>

        <div>
          <label htmlFor="nome" className="mb-1 block text-sm text-[hsl(var(--texto-secundario))]">
            Nome
          </label>
          <input
            id="nome"
            value={nome}
            onChange={(evento) => definirNome(evento.target.value)}
            autoComplete="off"
            // `autoCapitalize` importa: o teclado do celular em maiúsculas
            // reduz erro de digitação em nome próprio.
            autoCapitalize="words"
            className={classeCampo}
            required
          />
        </div>

        {sugestoes.length > 0 ? (
          <div className="rounded-[var(--raio)] border border-[hsl(var(--atencao)/0.4)] bg-[hsl(var(--atencao-sutil))] p-3">
            <p className="flex items-center gap-2 text-sm font-medium text-[hsl(var(--atencao))]">
              <TriangleAlert className="size-4 shrink-0" aria-hidden="true" />
              Já existe alguém parecido cadastrado
            </p>
            <ul className="mt-2 space-y-1 text-sm text-[hsl(var(--texto-secundario))]">
              {sugestoes.map((sugestao) => (
                <li key={sugestao.id}>
                  {sugestao.nome}
                  {sugestao.apelido ? ` (${sugestao.apelido})` : ''}
                  {sugestao.mesmoDomicilio ? ' — mesmo domicílio' : ''}
                </li>
              ))}
            </ul>
            <p className="mt-2 text-xs text-[hsl(var(--texto-fraco))]">
              Se for a mesma pessoa, procure o cadastro existente em vez de criar outro.
            </p>
          </div>
        ) : null}

        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <label htmlFor="apelido" className="mb-1 block text-sm text-[hsl(var(--texto-secundario))]">
              Como é conhecido <span className="text-[hsl(var(--texto-fraco))]">(opcional)</span>
            </label>
            <input
              id="apelido"
              value={apelido}
              onChange={(evento) => definirApelido(evento.target.value)}
              className={classeCampo}
            />
          </div>
          <div>
            <label htmlFor="telefone" className="mb-1 block text-sm text-[hsl(var(--texto-secundario))]">
              Telefone <span className="text-[hsl(var(--texto-fraco))]">(opcional)</span>
            </label>
            <input
              id="telefone"
              value={telefone}
              onChange={(evento) => definirTelefone(mascararTelefone(evento.target.value))}
              inputMode="numeric"
              className={classeCampo}
            />
          </div>
        </div>

        {/*
          CPF e título não aparecem aqui. São opcionais e desabilitados por
          padrão (minimização, LGPD art. 6º, III); só surgem se o administrador
          da campanha habilitar a coleta.
        */}
      </fieldset>

      {/* --- Classificação ---------------------------------------------------- */}
      <fieldset>
        <legend className="mb-2 text-sm font-medium text-[hsl(var(--texto))]">
          Como você classificaria
        </legend>
        <div className="flex flex-wrap gap-2">
          {CLASSIFICACOES.map((valor) => (
            <button
              key={valor}
              type="button"
              onClick={() => definirClassificacao(valor)}
              aria-pressed={classificacao === valor}
              className={cn(
                'rounded-full transition-opacity',
                classificacao === valor ? 'ring-2 ring-[hsl(var(--foco))]' : 'opacity-60',
              )}
              title={RotuloClassificacaoEleitor[valor]}
            >
              <EtiquetaClassificacao classificacao={valor} />
            </button>
          ))}
        </div>
      </fieldset>

      {/* --- Intenção de voto ------------------------------------------------- */}
      <fieldset className="flex flex-col gap-3">
        <legend className="mb-1 text-sm font-medium text-[hsl(var(--texto))]">
          Intenção de voto
        </legend>

        <label className="flex items-center gap-2 text-sm text-[hsl(var(--texto-secundario))]">
          <input
            type="checkbox"
            checked={recusouResponder}
            onChange={(evento) => definirRecusou(evento.target.checked)}
            className="size-4"
          />
          Preferiu não responder
        </label>

        {!recusouResponder
          ? cargos.map((cargo) => (
              <div key={cargo.id}>
                <label
                  htmlFor={`cargo-${cargo.id}`}
                  className="mb-1 block text-sm text-[hsl(var(--texto-secundario))]"
                >
                  {cargo.nome}
                  {cargo.quantidadeVotosPermitida > 1
                    ? ` — ${cargo.quantidadeVotosPermitida} votos`
                    : ''}
                </label>
                <input
                  id={`cargo-${cargo.id}`}
                  value={intencoes[cargo.id] ?? ''}
                  onChange={(evento) =>
                    definirIntencoes((atual) => ({
                      ...atual,
                      [cargo.id]: evento.target.value.replace(/\D+/g, '').slice(0, 5),
                    }))
                  }
                  inputMode="numeric"
                  placeholder="Número na urna"
                  className={classeCampo}
                />
              </div>
            ))
          : null}
      </fieldset>

      <div>
        <label
          htmlFor="observacoes"
          className="mb-1 block text-sm text-[hsl(var(--texto-secundario))]"
        >
          Observações <span className="text-[hsl(var(--texto-fraco))]">(opcional)</span>
        </label>
        <textarea
          id="observacoes"
          value={observacoes}
          onChange={(evento) => definirObservacoes(evento.target.value)}
          rows={3}
          className="w-full rounded-[var(--raio)] border border-[hsl(var(--borda))] bg-[hsl(var(--superficie))] p-3 text-base text-[hsl(var(--texto))]"
        />
      </div>

      {/* --- Consentimento (bloqueante) --------------------------------------- */}
      <fieldset className="rounded-[var(--raio)] border-2 border-[hsl(var(--acento)/0.4)] bg-[hsl(var(--acento-sutil))] p-3">
        <legend className="flex items-center gap-2 px-1 text-sm font-semibold text-[hsl(var(--texto))]">
          <ShieldCheck className="size-4" aria-hidden="true" /> Consentimento
        </legend>
        <p className="max-h-40 overflow-y-auto text-sm text-[hsl(var(--texto-secundario))]">
          {textoConsentimento}
        </p>
        <label className="mt-3 flex items-start gap-2 text-sm font-medium text-[hsl(var(--texto))]">
          <input
            type="checkbox"
            checked={consentiu}
            onChange={(evento) => definirConsentiu(evento.target.checked)}
            className="mt-0.5 size-4 shrink-0"
          />
          Li o termo acima para o entrevistado e ele concordou.
        </label>
      </fieldset>

      {/* --- Estado do GPS ---------------------------------------------------- */}
      <p className="flex items-center gap-2 text-xs text-[hsl(var(--texto-fraco))]">
        <MapPin className="size-3.5 shrink-0" aria-hidden="true" />
        {estadoGps === 'obtida' && posicao
          ? `Localização registrada (precisão de ${Math.round(posicao.precisaoMetros)} m).`
          : estadoGps === 'obtendo'
            ? 'Obtendo localização…'
            : estadoGps === 'negada'
              ? 'Localização negada. A entrevista pode ser salva mesmo assim.'
              : 'Sem localização. A entrevista pode ser salva mesmo assim.'}
        {estadoGps !== 'obtida' && estadoGps !== 'obtendo' ? (
          <button
            type="button"
            onClick={solicitarGps}
            className="underline underline-offset-2"
          >
            tentar de novo
          </button>
        ) : null}
      </p>

      {!consentiu ? (
        <p className="text-sm text-[hsl(var(--atencao))]">
          O consentimento é obrigatório: convicção política é dado pessoal sensível.
        </p>
      ) : null}

      <Botao
        variante="primario"
        tamanho="grande"
        type="submit"
        disabled={!podeSalvar}
        carregando={salvando}
        className="w-full"
      >
        Salvar entrevista
      </Botao>
    </form>
  );
}
