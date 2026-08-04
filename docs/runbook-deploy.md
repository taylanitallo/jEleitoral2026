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

   Já está declarado no `config.toml`; o que faltava era aplicá-lo ao projeto
   remoto. **`config.toml` não viaja sozinho** — `db push` leva migration, não
   configuração:

   ```bash
   cd infra && supabase config push --yes
   ```

   Duas armadilhas deste comando, ambas descobertas na prática:

   - **`--workdir` não funciona aqui.** Ao contrário de `db push`, o
     `config push` procura `supabase/config.toml` a partir do diretório atual.
     Rode de dentro de `infra/`.
   - **Ele envia o arquivo inteiro, para o projeto que estiver vinculado.** Por
     isso `site_url` e `additional_redirect_urls` vêm de variável de ambiente
     (`SUPABASE_URL_SITE`, `SUPABASE_URL_REDIRECIONAMENTO`): um valor fixo faria
     todo link de convite e de recuperação de senha de produção apontar para o
     `127.0.0.1` de quem rodou o comando.

   E um campo que **não** é o que o nome diz: `[auth.email] enable_signup` é
   traduzido pelo CLI para `external_email_enabled`, o interruptor do provedor
   de e-mail inteiro. Colocá-lo em `false` derruba o login com e-mail e senha
   ("Email logins are disabled"). Quem barra autocadastro é o `enable_signup` da
   seção `[auth]`.

2. **`SEGREDO_HMAC_INDICE` no ambiente da API.** É dele que sai o índice de
   busca sobre CPF e título criptografados.

   Edições anteriores deste runbook mandavam rodar
   `alter database postgres set app.segredo_hmac = ...`. **Esse comando não
   funciona no Supabase** e nunca funcionou: desde o PostgreSQL 15, definir
   parâmetro personalizado no nível de banco ou de papel exige superusuário, e o
   papel `postgres` do Supabase não é. A tentativa responde
   `permission denied to set parameter "app.segredo_hmac"`.

   Não é preciso, e o desenho já era outro: `BancoService.executarComoUsuario`
   injeta o segredo **por transação** com `set_config(..., true)`, lendo a
   variável de ambiente da API. Basta que `SEGREDO_HMAC_INDICE` esteja correta
   na Railway.

   Se este valor mudar depois de haver dados gravados, **todos os índices de
   busca param de casar** e nenhum entrevistado é encontrado por documento. Ele
   é tão permanente quanto a chave AES.

### Verificar antes de confiar

```bash
pnpm --filter @jeleitoral/api banco:aplicar     # aplica em transação única
pnpm --filter @jeleitoral/api verificar:ambiente # hook, segredo HMAC e claims
pnpm --filter @jeleitoral/api test:rls          # cobertura de RLS
pnpm --filter @jeleitoral/api test:isolamento   # isolamento cruzado
```

`verificar:ambiente` existe porque as duas configurações acima falham em
silêncio: o sistema sobe, o login funciona, e só a primeira consulta a dado de
campo volta vazia — o sintoma parece "banco sem dados". Com
`EMAIL_VERIFICACAO` e `SENHA_VERIFICACAO` definidos, ele emite um token real e
confere os claims, que é a única prova de que o hook está registrado no serviço
de Auth e não apenas declarado no `config.toml`.

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

## 3.1 Estado em 04/08/2026

- Os dois projetos existem, ambos `ACTIVE_HEALTHY` em sa-east-1, com **16
  migrations aplicadas**.
- Em homologação, `test:rls` (7 testes) e `test:isolamento` (14 testes) passam
  contra o banco real.
- A linha de base de produção foi aplicada manualmente **uma única vez**, para
  bootstrap. Daqui em diante, produção só recebe migration pelo CI.
- **Homologação está configurada e verificada**: `verificar:ambiente` passa
  7/7, incluindo a emissão de um token real cujos claims chegam preenchidos.
  O `app.segredo_hmac` já estava definido; o que faltava era o `config push`.
- **Produção recebeu o `config push`** com `site_url = https://jeleitoral.vercel.app`
  (domínio provisório — se mudar, repetir o push, senão os links de convite e de
  recuperação de senha continuam apontando para o endereço antigo).
- **Produção estava em 0015 e recebeu a 0016** por `supabase db push`. As duas
  bases estão agora na mesma linha.

### Pendente em produção

**`SEGREDO_HMAC_INDICE` e `CHAVE_CRIPTOGRAFIA_AES` na Railway.** São os dois
valores irreversíveis do sistema: trocar qualquer um depois de haver documento
cifrado gravado inutiliza o que já está na base. Defina antes do primeiro
cadastro em campo, guarde fora do repositório e não gere de novo "para
testar".

Confirme com `verificar:ambiente` apontando `BANCO_URL` para produção — ele
compara o cálculo do banco com o da API e acusa divergência.

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
