/**
 * `pnpm verificar:integracoes`
 *
 * Bate em todas as fontes externas e imprime um relatório de saúde. Não usa
 * banco nem configuração completa de propósito: precisa rodar em qualquer
 * máquina, inclusive na do desenvolvedor que acabou de clonar o repositório.
 *
 * Sai com código 1 se alguma fonte OBRIGATÓRIA estiver fora. O DivulgaCandContas
 * é marcado como opcional porque é uma API não oficial e a base de candidatos
 * vem do CSV do TSE — perdê-lo degrada, não quebra.
 *
 * Regra: se uma fonte mudar de contrato, este script deve **acusar**, nunca
 * simular. Dado inventado passando por real é pior do que erro visível.
 */

const USER_AGENT =
  process.env.INTEGRACOES_USER_AGENT ?? 'jEleitoral/1.0 (+https://jeos.com.br; verificacao)';

interface Verificacao {
  nome: string;
  url: string;
  obrigatoria: boolean;
  /** Confere o corpo, não só o status: HTTP 200 com HTML de erro é armadilha comum. */
  validar?: (corpo: string) => string | null;
}

const VERIFICACOES: Verificacao[] = [
  {
    nome: 'IBGE Localidades — estados',
    url: 'https://servicodados.ibge.gov.br/api/v1/localidades/estados',
    obrigatoria: true,
    validar: (corpo) => {
      const dados = JSON.parse(corpo) as Array<{ sigla: string }>;
      return dados.length === 27 ? null : `esperava 27 UFs, veio ${dados.length}`;
    },
  },
  {
    nome: 'IBGE Localidades — distritos de São Paulo',
    url: 'https://servicodados.ibge.gov.br/api/v1/localidades/municipios/3550308/distritos',
    obrigatoria: true,
  },
  {
    nome: 'BrasilAPI — CEP',
    url: 'https://brasilapi.com.br/api/cep/v2/01001000',
    obrigatoria: true,
    validar: (corpo) => {
      const dados = JSON.parse(corpo) as { state?: string };
      return dados.state === 'SP' ? null : 'CEP 01001000 deveria devolver SP';
    },
  },
  {
    nome: 'ViaCEP (fallback)',
    url: 'https://viacep.com.br/ws/01001000/json/',
    obrigatoria: false,
  },
  {
    nome: 'TSE Dados Abertos — CKAN',
    url: 'https://dadosabertos.tse.jus.br/api/3/action/package_list',
    obrigatoria: true,
    validar: (corpo) => {
      const dados = JSON.parse(corpo) as { success?: boolean };
      return dados.success === true ? null : 'CKAN respondeu sem success=true';
    },
  },
  {
    nome: 'TSE — dataset eleitorado-2026',
    url: 'https://dadosabertos.tse.jus.br/api/3/action/package_show?id=eleitorado-2026',
    obrigatoria: true,
    validar: (corpo) => {
      const dados = JSON.parse(corpo) as {
        result?: { resources?: Array<{ name: string }> };
      };
      const recursos = dados.result?.resources ?? [];
      const temPerfilPorSecao = recursos.some((r) =>
        r.name.toLowerCase().includes('perfil do eleitorado por seção'),
      );
      return temPerfilPorSecao
        ? null
        : 'não encontrei o recurso "Perfil do eleitorado por seção eleitoral" — o layout mudou';
    },
  },
  {
    nome: 'TSE — dataset candidatos-2026',
    url: 'https://dadosabertos.tse.jus.br/api/3/action/package_show?id=candidatos-2026',
    obrigatoria: true,
    validar: (corpo) => {
      const dados = JSON.parse(corpo) as { result?: { resources?: unknown[] } };
      const quantidade = dados.result?.resources?.length ?? 0;
      return quantidade > 0 ? null : 'dataset sem recursos publicados';
    },
  },
  {
    nome: 'DivulgaCandContas (não oficial)',
    url: 'https://divulgacandcontas.tse.jus.br/divulga/rest/v1/candidatura/listar/2022/BR/544/1/candidatos',
    obrigatoria: false,
    validar: (corpo) => {
      const dados = JSON.parse(corpo) as { candidatos?: unknown[] };
      return Array.isArray(dados.candidatos)
        ? null
        : 'resposta sem a lista "candidatos" — o contrato mudou';
    },
  },
];

async function verificar(item: Verificacao): Promise<{
  ok: boolean;
  latenciaMs: number;
  detalhe: string;
}> {
  const inicio = Date.now();
  try {
    const resposta = await fetch(item.url, {
      headers: { 'User-Agent': USER_AGENT },
      signal: AbortSignal.timeout(25_000),
    });
    const latenciaMs = Date.now() - inicio;

    if (!resposta.ok) {
      return { ok: false, latenciaMs, detalhe: `HTTP ${resposta.status}` };
    }
    if (item.validar) {
      const problema = item.validar(await resposta.text());
      if (problema) return { ok: false, latenciaMs, detalhe: problema };
    }
    return { ok: true, latenciaMs, detalhe: 'ok' };
  } catch (erro) {
    return {
      ok: false,
      latenciaMs: Date.now() - inicio,
      detalhe: erro instanceof Error ? erro.message : 'falha de rede',
    };
  }
}

async function principal(): Promise<void> {
  process.stdout.write('\nVerificação das integrações do jEleitoral\n');
  process.stdout.write(`${'─'.repeat(78)}\n`);

  const resultados = await Promise.all(
    VERIFICACOES.map(async (item) => ({ item, resultado: await verificar(item) })),
  );

  let falhasObrigatorias = 0;
  for (const { item, resultado } of resultados) {
    const marca = resultado.ok ? '  OK  ' : item.obrigatoria ? ' FALHA' : ' AVISO';
    const latencia = `${String(resultado.latenciaMs).padStart(5)}ms`;
    process.stdout.write(
      `[${marca}] ${latencia}  ${item.nome.padEnd(44)} ${resultado.ok ? '' : resultado.detalhe}\n`,
    );
    if (!resultado.ok && item.obrigatoria) falhasObrigatorias += 1;
  }

  process.stdout.write(`${'─'.repeat(78)}\n`);
  if (falhasObrigatorias === 0) {
    process.stdout.write('Todas as fontes obrigatórias responderam como esperado.\n\n');
    return;
  }

  process.stdout.write(
    `${falhasObrigatorias} fonte(s) obrigatória(s) com problema.\n` +
      'Não gere dados simulados para contornar: corrija o conector ou avise a equipe.\n\n',
  );
  process.exitCode = 1;
}

principal().catch((erro: unknown) => {
  process.stderr.write(`Falha na verificação: ${String(erro)}\n`);
  process.exitCode = 1;
});
