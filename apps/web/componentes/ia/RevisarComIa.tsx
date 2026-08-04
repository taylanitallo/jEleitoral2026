'use client';

import { Check, Sparkles, X } from 'lucide-react';
import { useState } from 'react';
import { Botao, cn } from '@jeleitoral/ui';
import { ErroDaApi, api } from '@/lib/api';

interface Alteracao {
  trecho: string;
  motivo: string;
}

/**
 * Revisão de texto por IA, ao lado de qualquer campo longo.
 *
 * Um componente resolve "IA em todo o sistema" — observação de entrevista,
 * descrição de problema, pauta de atividade, texto de publicação — sem N
 * endpoints e sem N telas.
 *
 * Duas regras que o componente torna estruturais, não opcionais:
 *
 *  1. **A IA nunca escreve no campo sozinha.** Ela propõe; quem aplica é a
 *     pessoa, clicando. O texto é de quem assina a campanha, e uma revisão
 *     aplicada em silêncio é uma alteração que ninguém autorizou.
 *  2. **As alterações vêm listadas com o motivo.** Sem isso a revisão é uma
 *     caixa-preta e o coordenador aceita no escuro ou não aceita nunca.
 */
export function RevisarComIa({
  idCampanha,
  texto,
  aoAplicar,
  className,
}: {
  idCampanha: string | null;
  texto: string;
  aoAplicar: (textoRevisado: string) => void;
  className?: string;
}): JSX.Element | null {
  const [revisando, definirRevisando] = useState(false);
  const [erro, definirErro] = useState<string | null>(null);
  const [proposta, definirProposta] = useState<{
    textoRevisado: string;
    alteracoes: Alteracao[];
  } | null>(null);

  // Texto curto demais não tem o que revisar, e a chamada custaria à toa.
  const podeRevisar = Boolean(idCampanha) && texto.trim().length >= 10;

  async function revisar(): Promise<void> {
    definirRevisando(true);
    definirErro(null);
    try {
      const resposta = await api.enviar<{ textoRevisado: string; alteracoes: Alteracao[] }>(
        '/ia/revisar-texto',
        { idCampanha, texto },
      );
      definirProposta(resposta);
    } catch (falha) {
      // Inclui o caso de a IA estar desabilitada por falta de chave, e o de a
      // campanha ter estourado o teto mensal — nos dois a API já devolve texto
      // em português explicando o que fazer.
      definirErro(falha instanceof ErroDaApi ? falha.message : 'Não foi possível revisar.');
    } finally {
      definirRevisando(false);
    }
  }

  if (!podeRevisar && !proposta && !erro) return null;

  return (
    <div className={cn('flex flex-col gap-2', className)}>
      {!proposta ? (
        <div className="flex items-center gap-2">
          <Botao
            variante="sutil"
            tamanho="pequeno"
            onClick={() => void revisar()}
            carregando={revisando}
            disabled={!podeRevisar}
          >
            <Sparkles className="size-3.5" aria-hidden="true" />
            Revisar com IA
          </Botao>
          {erro ? (
            <span role="alert" className="text-xs text-[hsl(var(--perigo))]">
              {erro}
            </span>
          ) : null}
        </div>
      ) : (
        <div className="rounded-[var(--raio)] border border-[hsl(var(--acento)/0.4)] bg-[hsl(var(--acento-sutil))] p-3">
          <TarjaGeradoPorIa />

          <p className="mt-2 whitespace-pre-wrap text-sm text-[hsl(var(--texto))]">
            {proposta.textoRevisado}
          </p>

          {proposta.alteracoes.length > 0 ? (
            <ul className="mt-2 flex flex-col gap-1 border-t border-[hsl(var(--acento)/0.2)] pt-2">
              {proposta.alteracoes.map((alteracao, indice) => (
                <li key={indice} className="text-xs text-[hsl(var(--texto-secundario))]">
                  <span className="font-medium">{alteracao.trecho}</span> — {alteracao.motivo}
                </li>
              ))}
            </ul>
          ) : (
            <p className="mt-2 text-xs text-[hsl(var(--texto-fraco))]">
              A IA não encontrou nada a corrigir.
            </p>
          )}

          <div className="mt-3 flex gap-2">
            <Botao
              tamanho="pequeno"
              onClick={() => {
                aoAplicar(proposta.textoRevisado);
                definirProposta(null);
              }}
            >
              <Check className="size-3.5" aria-hidden="true" />
              Aplicar
            </Botao>
            <Botao variante="sutil" tamanho="pequeno" onClick={() => definirProposta(null)}>
              <X className="size-3.5" aria-hidden="true" />
              Descartar
            </Botao>
          </div>
        </div>
      )}
    </div>
  );
}

/**
 * Tarja de conteúdo gerado por IA.
 *
 * Vive ao lado da `TarjaUsoInterno` no mesmo espírito: o que a máquina escreveu
 * precisa ser identificável na tela e no papel. Um texto de campanha que passou
 * por IA e circula sem essa marca vira afirmação da campanha sem ninguém ter
 * conferido.
 */
export function TarjaGeradoPorIa({ className }: { className?: string }): JSX.Element {
  return (
    <p
      className={cn(
        'flex items-center gap-1.5 text-xs font-medium text-[hsl(var(--acento))]',
        className,
      )}
    >
      <Sparkles className="size-3.5" aria-hidden="true" />
      Sugestão gerada por IA — revise antes de usar.
    </p>
  );
}
