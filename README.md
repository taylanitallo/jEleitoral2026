# jEleitoral 2026

SaaS multi-tenant de mapeamento, projeção e gestão eleitoral para as Eleições
Gerais de 2026 (Deputado Estadual, Deputado Federal, Senador, Governador e
Presidente).

> **Status: em desenvolvimento.** O sistema não está em produção e não foi usado
> em campo. Ver [`docs/arquitetura.md`](docs/arquitetura.md) § 5 e § 6 para o
> estado real de cada módulo e as pendências conhecidas.

## O que ele faz

Equipes de campanha usam o sistema para mapear eleitores em campo (inclusive sem
internet), projetar resultados por seção eleitoral, acompanhar metas, controlar o
investimento por território e distribuir material gráfico.

## Arquitetura em uma tela

| Camada   | Tecnologia                                      |
| -------- | ----------------------------------------------- |
| Backend  | NestJS · Railway                                |
| Banco    | Supabase (PostgreSQL 17 + RLS + Auth + Storage) |
| Frontend | Next.js 14 (App Router) · Vercel                |
| Filas    | BullMQ + Redis                                  |
| IA       | Anthropic API, sempre pelo backend              |

**Nomenclatura 100% em português** — código, tabelas, rotas, variáveis.

## Três decisões que explicam o resto

**Isolamento por RLS, não por schema.** O tenant é a organização. `id_organizacao`
está em toda tabela de dados, com `FORCE ROW LEVEL SECURITY`, e vem sempre do
claim do JWT. Um `WHERE` esquecido em qualquer endpoint não vaza nada — a
política roda dentro do PostgreSQL. Há teste que quebra o build se uma tabela
ficar sem coluna de tenant, sem política ou sem índice.

**Consentimento é bloqueante no banco.** Convicção política é dado sensível
(LGPD, art. 5º, II). Um gatilho impede que a entrevista chegue a `CONCLUIDA` sem
consentimento registrado — a regra está no banco de propósito, porque a fila
offline sincroniza direto e uma validação só de tela seria contornável.

**A projeção nunca viaja sozinha.** Todo número projetado carrega método,
cobertura amostral e intervalo. Projetar 78% com 3% da seção mapeada é
desinformação, e a estrutura de retorno torna impossível exibir um sem o outro.

## Rodando localmente

```bash
pnpm install
cp .env.exemplo .env          # preencha as chaves
pnpm test                     # testes unitários
pnpm verificar:integracoes    # confere IBGE, CEP, TSE e DivulgaCandContas ao vivo
pnpm dev
```

Migrations e deploy: [`docs/runbook-deploy.md`](docs/runbook-deploy.md).

## Limites que o sistema não atravessa

- **Não reconstrói o cadastro eleitoral.** Dados nominais de eleitores do TSE não
  são públicos. Usamos apenas agregados por seção.
- **Não vincula voto real a indivíduo.** O voto é secreto. O sistema trabalha com
  intenção declarada e projeção agregada.
- **Não substitui assessoria jurídica eleitoral** nem a prestação de contas
  oficial à Justiça Eleitoral.

Levantamentos internos saem com tarja de uso interno: divulgar pesquisa sem
registro no PesqEle sujeita a multa (Lei 9.504/97, art. 33).

## Licença

Software proprietário — Jeos Sistemas. Todos os direitos reservados.
