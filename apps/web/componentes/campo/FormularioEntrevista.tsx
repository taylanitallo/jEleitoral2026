'use client';

import { CheckCircle2, MapPin, ShieldCheck, TriangleAlert, UserRound } from 'lucide-react';
import Link from 'next/link';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Botao, EtiquetaClassificacao, TarjaUsoInterno, cn } from '@jeleitoral/ui';
import {
  ClassificacaoEleitor,
  RotuloClassificacaoEleitor,
  type EntradaEntrevista,
  type EntradaIntencaoVoto,
} from '@jeleitoral/tipos';
import { mascararTelefone, normalizarNomePessoa } from '@jeleitoral/utilitarios';
import { api, ErroDaApi } from '@/lib/api';
import { enviarLoteEntrevistas } from '@/lib/enviarLoteEntrevistas';
import { filaOffline } from '@/lib/filaOffline';
import { useGeolocalizacao } from '@/lib/useGeolocalizacao';
import { SeletorCandidato, type CandidatoDoCargo, type EscolhaIntencao } from './SeletorCandidato';

interface CargoDisponivel {
  id: string;
  nome: string;
  quantidadeVotosPermitida: number;
  digitosNumeroUrna: number;
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
  candidatos?: Array<CandidatoDoCargo & { idCargo: string }>;
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
  candidatos,
  idVersaoConsentimento,
  textoConsentimento,
  aoConcluir,
}: PropriedadesFormularioEntrevista): JSX.Element {
  const [nome, definirNome] = useState('');
  const [apelido, definirApelido] = useState('');
  const [telefone, definirTelefone] = useState('');
  const [classificacao, definirClassificacao] = useState<ClassificacaoEleitor>('NAO_INFORMOU');
  /*
   * Um array de slots por cargo, em vez de um único valor.
   *
   * O Senado no Ceará tem 2 votos, e o formulário antigo tinha UM campo — a
   * trigger `intencoes_validar_quantidade` já sabia recusar o excesso, mas a
   * tela nunca permitia o segundo voto. Cada cargo aqui tem exatamente
   * `quantidadeVotosPermitida` posições; slot vazio (`null`) simplesmente não
   * vira linha ao salvar.
   */
  const [intencoes, definirIntencoes] = useState<Record<string, Array<EscolhaIntencao | null>>>(
    () =>
      Object.fromEntries(
        cargos.map((cargo) => [cargo.id, Array(cargo.quantidadeVotosPermitida).fill(null)]),
      ),
  );
  const [observacoes, definirObservacoes] = useState('');
  const [recusouResponder, definirRecusou] = useState(false);
  const [consentiu, definirConsentiu] = useState(false);
  const [sugestoes, definirSugestoes] = useState<Sugestao[]>([]);
  const [salvando, definirSalvando] = useState(false);
  const [confirmacao, definirConfirmacao] = useState<string | null>(null);
  const [iniciadoEm] = useState(() => Date.now());

  const { posicao, estado: estadoGps, solicitar: solicitarGps } = useGeolocalizacao();

  const candidatosPorCargo = useMemo(() => {
    const mapa = new Map<string, CandidatoDoCargo[]>();
    // Defensivo: uma API mais antiga (deploy em andamento, cache de contexto
    // salvo antes desta versão) pode não trazer `candidatos`. Sem isto, a tela
    // quebra por inteiro em vez de cair para a lista vazia — que o
    // `SeletorCandidato` já trata mostrando só as opções fixas e "Outro número".
    for (const candidato of candidatos ?? []) {
      const lista = mapa.get(candidato.idCargo) ?? [];
      lista.push(candidato);
      mapa.set(candidato.idCargo, lista);
    }
    return mapa;
  }, [candidatos]);

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
  const temConteudo =
    recusouResponder ||
    Object.values(intencoes).some((slots) => slots.some((slot) => slot !== null));
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
          ...(posicao ? { latitude: posicao.latitude, longitude: posicao.longitude } : {}),
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
        intencoes: Object.entries(intencoes).flatMap<EntradaIntencaoVoto>(([idCargo, slots]) =>
          slots
            .filter((slot): slot is EscolhaIntencao => slot !== null)
            .map((slot) => ({
              idCargo,
              idCandidato: slot.idCandidato,
              numeroDeclarado: slot.numeroDeclarado,
              tipo: slot.tipo,
              grauCerteza: 3,
              votoDefinido: false,
            })),
        ),
        votosDomicilio: [],
        status: 'CONCLUIDA',
      } as EntradaEntrevista;

      await filaOffline.enfileirar(idCampanha, entrevista);

      if (navigator.onLine) {
        // Dispara aqui, e não só espera o `IndicadorFilaOffline`: aquele
        // componente só sincroniza sozinho a cada 2 minutos, ao montar ou ao
        // reconectar — nenhum desses gatilhos reage a este `enfileirar`. Sem
        // isto, "está subindo para o servidor" era uma frase sem envio
        // nenhum por trás, por até 2 minutos. Sem `await`: a confirmação e a
        // limpeza do formulário não podem esperar a rede — o indicador
        // mostra o resultado, e uma falha aqui vira item ATENCAO lá.
        void filaOffline
          .sincronizar(enviarLoteEntrevistas)
          .then(() => filaOffline.limparEnviados());
      }

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
    definirIntencoes(
      Object.fromEntries(
        cargos.map((cargo) => [cargo.id, Array(cargo.quantidadeVotosPermitida).fill(null)]),
      ),
    );
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
          <span className="flex-1">{confirmacao}</span>
          {/*
           * Link para o registro, e não navegação automática para lá. A
           * entrevista fica na fila local até sincronizar — antes disso não
           * existe uma página de detalhe para navegar. Sair da tela quebraria
           * também o fluxo de campo ("próxima casa direto"), que o comentário
           * deste componente já defende como prioridade.
           */}
          <Link
            href="/campo/entrevistas"
            className="shrink-0 whitespace-nowrap text-xs underline underline-offset-2 hover:no-underline"
          >
            Ver registro
          </Link>
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
            <label
              htmlFor="apelido"
              className="mb-1 block text-sm text-[hsl(var(--texto-secundario))]"
            >
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
            <label
              htmlFor="telefone"
              className="mb-1 block text-sm text-[hsl(var(--texto-secundario))]"
            >
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
          ? cargos.map((cargo) => {
              const slots = intencoes[cargo.id] ?? [];
              const candidatosDoCargo = candidatosPorCargo.get(cargo.id) ?? [];

              function definirSlot(indice: number, escolha: EscolhaIntencao | null): void {
                definirIntencoes((atual) => {
                  const lista = [...(atual[cargo.id] ?? [])];
                  lista[indice] = escolha;
                  return { ...atual, [cargo.id]: lista };
                });
              }

              return (
                <div key={cargo.id} className="flex flex-col gap-2">
                  {slots.map((slot, indice) => (
                    <div key={indice}>
                      <label
                        htmlFor={indice === 0 ? `cargo-${cargo.id}` : undefined}
                        className="mb-1 block text-sm text-[hsl(var(--texto-secundario))]"
                      >
                        {cargo.nome}
                        {/* Dois campos e não um rótulo com "2 votos": o
                            eleitor cearense declara DOIS senadores distintos,
                            e um único input só cabia um. */}
                        {slots.length > 1 ? ` (${indice + 1}º voto)` : ''}
                      </label>
                      <SeletorCandidato
                        idCargo={indice === 0 ? cargo.id : `${cargo.id}-${indice}`}
                        candidatos={candidatosDoCargo}
                        valor={slot}
                        // O segundo voto de Senador não pode repetir quem já
                        // foi escolhido no primeiro — é o par em interface do
                        // índice único que o banco já aplica.
                        excluir={slots
                          .filter((_, i) => i !== indice)
                          .map((s) => s?.idCandidato)
                          .filter((id): id is string => Boolean(id))}
                        digitosNumeroUrna={cargo.digitosNumeroUrna}
                        aoEscolher={(escolha) => definirSlot(indice, escolha)}
                      />
                    </div>
                  ))}
                </div>
              );
            })
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
          <button type="button" onClick={solicitarGps} className="underline underline-offset-2">
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
