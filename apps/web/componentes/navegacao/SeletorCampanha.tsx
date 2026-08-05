'use client';

import { usePathname, useRouter } from 'next/navigation';
import { useContextoSessao } from './ProvedorSessao';

/**
 * Troca de campanha, na barra superior.
 *
 * Some quando há uma campanha só — que é o caso comum hoje. Aparece assim que
 * um coordenador tiver acesso a mais de um município, e é isso que faz
 * "campanha é o município" ser navegável, não só verdadeiro no banco.
 */
export function SeletorCampanha(): JSX.Element | null {
  const { sessao, idCampanha, definirCampanhaAtiva } = useContextoSessao();
  const roteador = useRouter();
  const caminho = usePathname();

  const campanhas = sessao?.campanhasDisponiveis ?? [];
  if (campanhas.length <= 1) return null;

  function trocar(id: string): void {
    if (id === idCampanha) return;
    definirCampanhaAtiva(id);
    /*
     * Descarta os parâmetros da URL ao trocar.
     *
     * Um filtro de `idSecao`/`idBairro` da campanha A não existe na campanha
     * B — o painel mostraria zero sem dizer por quê. Navegar para o caminho
     * limpo é a forma mais simples de garantir isso em toda tela de uma vez,
     * sem cada uma precisar tratar o caso.
     */
    roteador.push(caminho);
  }

  return (
    <select
      aria-label="Campanha ativa"
      value={idCampanha ?? ''}
      onChange={(evento) => trocar(evento.target.value)}
      className="h-8 max-w-[12rem] truncate rounded-[var(--raio)] border border-[hsl(var(--borda))] bg-[hsl(var(--superficie))] px-2 text-xs text-[hsl(var(--texto))]"
    >
      {campanhas.map((campanha) => (
        <option key={campanha.id} value={campanha.id}>
          {campanha.nomeMunicipio ? `${campanha.nome} — ${campanha.nomeMunicipio}` : campanha.nome}
        </option>
      ))}
    </select>
  );
}
