# Runbook de deploy

Três provedores, três papéis, e uma regra que vale para os três: **nada é
aplicado à mão em produção**. O que não estiver neste arquivo ou no CI não
acontece.

| Provedor     | O que hospeda                       | CLI        |
| ------------ | ----------------------------------- | ---------- |
| **Supabase** | PostgreSQL, Auth, Storage, Realtime | `supabase` |
| **Railway**  | API NestJS, Redis, workers de fila  | `railway`  |
| **Vercel**   | Web Next.js, com preview por PR     | `vercel`   |

Estado verificado em 01/08/2026: os três CLIs instalados e autenticados
(`vercel` 54.5.0 · `railway` 4.65.0 · `supabase` 2.109.0).

---

## 1. Supabase

O `config.toml` vive em `infra/supabase/`, e não na raiz. **Todo comando precisa
de `--workdir infra`** — sem isso o CLI reclama que não encontra o projeto.

```bash
# Vincular o repositório ao projeto (uma vez por máquina)
supabase link --project-ref <ref-do-projeto> --workdir infra

# Ver o que será aplicado, sem aplicar
supabase db diff --workdir infra

# Aplicar as migrations
supabase db push --workdir infra
```

### Ambientes

Um projeto Supabase por ambiente. Não use branches de banco para separar
homologação de produção: intenção de voto é dado sensível e um `db reset` no
branch errado é irreversível.

| Ambiente        | Projeto                                                           | Quem aplica                     |
| --------------- | ----------------------------------------------------------------- | ------------------------------- |
| desenvolvimento | local ou projeto próprio                                          | o desenvolvedor                 |
| homologacao     | `jeleitoral-homologacao` — ref `rravmsjqnzfxgeuahpot` (sa-east-1) | CI, no merge para `homologacao` |
| producao        | `jeleitoral-producao` — ref `nrabyzfvulolhhfccqex` (sa-east-1)    | CI, no merge para `main`        |

### Configuração obrigatória depois do primeiro push

Duas coisas que as migrations **não** fazem sozinhas e sem as quais o sistema
sobe e nega tudo:

1. **Custom Access Token Hook.** É ele que coloca `id_organizacao`, `campanhas`,
   `equipes`, `territorios` e `permissoes` no JWT. Sem esses claims, toda
   política RLS nega — que é o padrão seguro, mas o sistema não funciona.
   Configure em Authentication → Hooks apontando para a função de token.
2. **`app.segredo_hmac`.** A função `public.hmac_indice` depende dela para gerar
   o índice de busca sobre CPF e título criptografados.
   ```sql
   alter database postgres set app.segredo_hmac = '<mesmo valor de SEGREDO_HMAC_INDICE>';
   ```
   Se este valor mudar depois de haver dados gravados, **todos os índices de
   busca param de casar** e nenhum entrevistado é encontrado por documento. Ele
   é tão permanente quanto a chave AES.

### Verificar antes de confiar

```bash
pnpm --filter @jeleitoral/api banco:aplicar   # aplica em transação única
pnpm --filter @jeleitoral/api test:rls        # cobertura de RLS
pnpm --filter @jeleitoral/api test:isolamento # isolamento cruzado
```

Os dois testes exigem `BANCO_URL` apontando para um PostgreSQL **descartável** —
eles criam e apagam organizações. Nunca aponte para produção.

---

## 2. Railway

```bash
railway link                    # vincula o diretório ao projeto
railway up --service api        # deploy manual (o normal é pelo CI)
railway logs --service api
railway variables --service api # conferir o ambiente
```

O `railway.json` fica em `apps/api/`. O build roda a partir da raiz do monorepo
porque a API depende de `pacotes/tipos` e `pacotes/utilitarios`.

Serviços esperados no projeto: `api`, `redis` e `worker` (filas BullMQ, ainda
não implementado).

O healthcheck aponta para `/api/saude`, que distingue **degradado** de
**indisponível**: o TSE fora do ar não pode derrubar a API, e por isso um estado
degradado responde 200.

---

## 3. Vercel

```bash
vercel link          # dentro de apps/web
vercel env pull      # traz as variáveis para .env.local
vercel --prod        # deploy manual (o normal é pelo CI)
```

O `vercel.json` fica em `apps/web/`, com região `gru1` (São Paulo) — a latência
importa para o entrevistador em campo com 3G.

Só variáveis com prefixo `NEXT_PUBLIC_` vão ao navegador. **Nunca** coloque
`SUPABASE_CHAVE_SERVICO`, `ANTHROPIC_API_KEY`, `CHAVE_CRIPTOGRAFIA_AES` ou
`SEGREDO_HMAC_INDICE` na Vercel: elas pertencem à Railway, onde só o backend as
lê.

---

## 3.1 Estado em 01/08/2026

- Os dois projetos existem e **as 13 migrations foram aplicadas nos dois**.
- Em homologação, `test:rls` (7 testes) e `test:isolamento` (14 testes) passam
  contra o banco real.
- A linha de base de produção foi aplicada manualmente **uma única vez**, para
  bootstrap. Daqui em diante, produção só recebe migration pelo CI.
- Falta configurar: Custom Access Token Hook e `app.segredo_hmac` nos dois
  projetos (seção 1). Sem isso a API sobe e nega tudo.

## 4. Ordem do primeiro deploy

A ordem importa: cada passo depende do anterior.

1. Criar os projetos Supabase de homologação e produção.
2. Aplicar as migrations e configurar o hook de token e o `app.segredo_hmac`.
3. Rodar `test:rls` e `test:isolamento` contra o projeto de homologação.
4. Subir a API na Railway com as variáveis do `.env.exemplo` preenchidas.
5. Conferir `GET /api/saude` — precisa responder `saudavel` ou `degradado`.
6. Subir a web na Vercel apontando `NEXT_PUBLIC_URL_API` para a Railway.
7. Rodar `pnpm verificar:integracoes` a partir do ambiente de produção, para
   confirmar que a saída de rede da Railway alcança IBGE, TSE e BrasilAPI.

---

## 5. Rollback

- **Web (Vercel):** promover o deployment anterior no painel. Instantâneo.
- **API (Railway):** `railway rollback --service api`. Segundos.
- **Banco (Supabase):** **não há rollback automático de migration.** Toda
  migration precisa ser escrita para frente — uma coluna nova entra como
  nullable, um `drop` só acontece numa migration posterior, depois que ninguém
  mais usa a coluna. Restaurar backup é o último recurso e implica perder o que
  foi coletado desde o ponto de restauração, que em dia de campanha pode ser
  centenas de entrevistas.

---

## 6. Backup

Supabase mantém backup diário automático nos planos pagos. O que **não** está
coberto e precisa de rotina própria:

- Teste de restauração — backup nunca testado é esperança, não backup.
- Exportação dos arquivos do Storage (artes gráficas e evidências de
  consentimento).

Documentar a restauração testada em `docs/runbook-backup.md` — ainda não escrito.
