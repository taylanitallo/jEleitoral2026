# Arquitetura do jEleitoral

Documento vivo. Registra as decisões tomadas, o motivo de cada uma e o estado
real da implementação — inclusive o que ainda não existe.

Última atualização: **04/08/2026**.

---

## 1. Decisões fechadas na Fase 0

| #   | Decisão                      | Escolha                                           | Consequência aceita                                                 |
| --- | ---------------------------- | ------------------------------------------------- | ------------------------------------------------------------------- |
| 1   | ~~Escopo × prazo~~ **revisto em 04/08/2026** | Ordem por "o que bloqueia a equipe ir à rua"      | Alvo: campo operando até o fim de agosto, para o pleito de 04/10/2026 |
| 2   | Candidatos 2026              | CKAN CSV primário, DivulgaCandContas complementar | Menos frescor durante a janela de registro, muito mais estabilidade |
| 3   | Volume de ETL                | Sob demanda por UF das campanhas ativas           | Onboarding de nova UF exige uma carga incremental                   |
| 4   | Inegociável no 1º entregável | Offline-first no formulário de campo              | Custo maior na Fase 6, retrofit evitado                             |
| 5   | Isolamento multi-tenant      | RLS por `organizacoes`                            | Migrations rodam uma vez; consultas federais são naturais           |

## 2. Isolamento multi-tenant

O tenant é a **organização**. A hierarquia é
`organizacoes → campanhas → dados`, e `usuarios` pertence a exatamente uma
organização.

O isolamento é feito por **Row Level Security no PostgreSQL**, não por schema
separado e não por filtro em código de aplicação. A política roda dentro do
banco: mesmo que um endpoint esqueça um `WHERE`, a linha não volta.

### Regras estruturais

- `id_organizacao` em **todas** as tabelas de dados, mesmo nas que já têm
  `id_campanha`. A repetição é intencional: deixa a política trivial e permite
  índice composto começando pela coluna de tenant.
- `ENABLE` + **`FORCE ROW LEVEL SECURITY`** em todas elas. Sem o `FORCE`, o dono
  da tabela — e portanto qualquer migration ou job — ignora a política.
- `id_organizacao` vem sempre do **claim do JWT**, nunca do corpo da requisição.
- O teste `apps/api/testes/coberturaRls.spec.ts` quebra o build se qualquer
  tabela ficar sem coluna de tenant, sem RLS, sem `FORCE`, sem política ou sem
  índice liderado por `id_organizacao`.

### Onde mora o escopo por usuário

O requisito "nenhum usuário vê o dado do outro" é atendido por
`autenticacao.visivel_no_escopo(...)`, chamada dentro das políticas de
`domicilios`, `entrevistados`, `entrevistas` e `visitas`. O escopo
(`PROPRIO` / `EQUIPE` / `TERRITORIO` / `CAMPANHA`) vem do perfil.

**Detalhe não óbvio e importante:** `autenticacao.escopo_de()` lê as permissões
do **claim `permissoes` do JWT**, não de uma consulta a `perfil_permissoes`.
Isso não é otimização prematura — é obrigatório por duas razões:

1. **Recursão.** Com `FORCE ROW LEVEL SECURITY`, nem o dono escapa das
   políticas. Uma função chamada de dentro da política de `usuarios` que
   consultasse `usuarios` entraria em laço infinito, inclusive em
   `SECURITY DEFINER`.
2. **Custo.** A política é avaliada linha a linha. Três `JOIN` por linha
   inviabilizaria qualquer listagem de volume.

O preço é que **alterar permissões só vale no próximo token**. O serviço de
perfis precisa revogar a sessão ao salvar, para que o efeito seja imediato.
Essa revogação ainda **não está implementada** — ver seção 6.

### Backoffice do provedor

A Jeos não é uma organização. Vive em `provedor.usuarios`, autentica-se à parte
e seu token não carrega `id_organizacao` — por isso falha em todas as políticas
de dados de campo, por construção e não por configuração.

As métricas do painel vêm de `catalogo.metricas_uso`, uma tabela de
**agregados** alimentada por job. O backoffice lê contadores, nunca a tabela de
origem. A auditoria que ele enxerga passa pela view
`provedor.auditoria_metadados`, que omite `dados_antes` e `dados_depois`.

O único caminho do provedor até dado de campo é `public.acessos_suporte`:
autorização explícita de um administrador da organização, motivo com no mínimo
20 caracteres, prazo máximo de 7 dias, revogável a qualquer momento e sempre
visível ao cliente.

## 3. Integrações — o que existe de verdade

Verificado com requisições reais em 31/07/2026.

| Fonte              | Estado                                               | Como se integra                                                                                                                                     |
| ------------------ | ---------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| IBGE Localidades   | ✅ 200                                               | REST direto, tempo real                                                                                                                             |
| IBGE bairros       | ❌ **404 — não existe**                              | Bairro vem de CEP e do cadastro em campo                                                                                                            |
| BrasilAPI / ViaCEP | ✅ 200                                               | Preenchimento assistido + cache permanente                                                                                                          |
| TSE CKAN           | ✅ 200                                               | `package_search` / `package_show` → CSV → ETL                                                                                                       |
| `candidatos-2026`  | ✅ publicado 22/07/2026, 7 CSVs                      | Fonte primária de candidatos                                                                                                                        |
| `eleitorado-2026`  | ✅ publicado 21/07/2026, perfil por seção **por UF** | Denominador das projeções                                                                                                                           |
| DivulgaCandContas  | ⚠️ parcial                                           | `/candidatura/listar/{ano}/{UF}/{cod}/{cargo}/candidatos` responde 200; `/eleicao/eleicoes-anos` retorna 404 e `/eleicao/eleicao-atual` retorna 400 |

O frontend **nunca** chama TSE ou IBGE diretamente. Tudo passa pela camada de
ingestão, que grava em `sincronizacoes` e serve a base já normalizada. É o que
faz o sistema continuar de pé quando o TSE sair do ar.

## 4. Conformidade

- **Consentimento é bloqueante.** O gatilho
  `public.validar_conclusao_entrevista()` impede que uma entrevista chegue a
  `CONCLUIDA` sem consentimento vigente e sem conteúdo. A regra está no banco de
  propósito: a fila offline sincroniza direto e poderia trazer registro montado
  à mão.
- **Minimização.** CPF e título são opcionais e desabilitados por padrão. Quando
  habilitados, a aplicação grava AES-256-GCM + HMAC-SHA256 para índice. O texto
  claro nunca toca o banco.
- **Trilha imutável.** `logs_auditoria` não tem política de `UPDATE` nem de
  `DELETE` para ninguém, inclusive o administrador da organização. Há teste que
  falha o build se alguém acrescentar uma.
- **Levantamento × pesquisa.** O padrão de toda campanha é
  `LEVANTAMENTO_INTERNO`, e todo relatório sai com a tarja "uso interno — vedada
  a divulgação pública". Divulgar pesquisa sem registro no PesqEle sujeita a
  multa (Lei 9.504/97, art. 33).
- **Limite que não será atravessado.** O sistema não reconstrói cadastro
  eleitoral e não vincula voto real a indivíduo. Trabalha com intenção declarada
  e projeção agregada por seção. Não há fonte pública lícita para "descobrir a
  seção do eleitor pelo nome", e o pedido, se aparecer, será recusado.

## 5. Estado da implementação

Atualizado em 01/08/2026. **185 testes unitários passando** (39 utilitários +
120 API + 26 web), typecheck limpo em todos os pacotes, `next build` compilando.

### Verificado contra sistema real

| O quê                   | Como                                                                          |
| ----------------------- | ----------------------------------------------------------------------------- |
| 13 migrations           | Aplicadas em `jeleitoral-homologacao` e `jeleitoral-producao` (PostgreSQL 17) |
| Cobertura de RLS        | `test:rls` — 7/7 contra o banco de homologação                                |
| Isolamento cruzado      | `test:isolamento` — 14/14, sob papel **não-superusuário**                     |
| Integrações externas    | `verificar:integracoes` — 8/8, validando conteúdo e não só HTTP 200           |
| Paleta de classificação | Validador de daltonismo/contraste — aprovada nos temas claro e escuro         |

### Fases entregues

| Fase                                              | Situação                                                        |
| ------------------------------------------------- | --------------------------------------------------------------- |
| 1 — Monorepo, CI, design system                   | Completa                                                        |
| 2 — Multi-tenant, RLS, escopo, auditoria          | Completa                                                        |
| 2b — Backoffice do provedor                       | API completa; telas não                                         |
| 3 — Território: IBGE, CEP, curadoria, dedup fuzzy | API completa; telas não                                         |
| 4 — Estrutura eleitoral do TSE                    | Conectores completos                                            |
| 5 — Candidatos e mesclagem                        | API completa; telas não                                         |
| 6 — Mapeamento de campo                           | Completa (API + formulário + fila offline)                      |
| 7 — Projeção e metas                              | Completa                                                        |
| 8 — Painel com filtro global                      | Painel base ligado à API; gráficos Recharts e Realtime não      |
| 9 — Relatórios PDF/Excel                          | Geração completa; fila assíncrona registra mas não processa     |
| 10 — Financeiro                                   | API completa; telas não                                         |
| 11 — Artes gráficas + Storage assinado            | API completa; telas não                                         |
| 12 — IA integrada                                 | Completa                                                        |
| 13 — Apuração ao vivo                             | Estrutura completa, **parser não confrontado com arquivo real** |
| 14 — E2E e hardening                              | Specs escritas; **não executadas** (navegador não instalado)    |

## 6. Pendências conhecidas

Ordenadas por quanto bloqueiam o uso real.

### Bloqueiam a subida

1. ~~**Custom Access Token Hook do Supabase**~~ — **resolvido em homologação
   (04/08/2026)** por `supabase config push`. `verificar:ambiente` emite um token
   real e confirma os claims. **Produção ainda não recebeu o push.**
2. ~~**`app.segredo_hmac`**~~ — **já estava configurado** em homologação; a
   pendência era um registro desatualizado. Continua valendo o alerta: mudá-la
   depois de haver documento cifrado gravado quebra todos os índices de busca.
3. **Autenticação não implementada.** Existe o guard que valida o JWT, mas não há
   tela de login, fluxo de convite, nem MFA configurado. As telas atuais usam
   identificadores fixos no código.
4. **O aplicativo de campo não abre sem rede.** A fila offline (`filaOffline.ts`)
   está completa e testada, mas **não existe service worker nem manifest** — não
   há sequer `apps/web/public/`. O app shell vem do servidor a cada visita, então
   o entrevistador que chega na zona rural sem a aba já aberta não consegue abrir
   o sistema, e a fila fica inacessível. Os dados de apoio da entrevista (cargos,
   domicílio, versão do consentimento) também estão fixos no código, com UUIDs de
   demonstração. **Motor pronto, carroceria ausente** — item bloqueante do
   caminho de campo, não melhoria.

### Prometidas no escopo e ainda ausentes

5. **Revogação de sessão ao alterar perfil** — sem ela, mudança de permissão só
   vale no próximo token. Ver seção 2.
6. **Fila BullMQ** — exportações grandes são registradas como `PENDENTE` e nunca
   processadas. Falta o worker e o Redis na Railway.
7. **Realtime por tenant** — canais do Supabase Realtime não configurados; o
   painel não atualiza sozinho.
8. **Gráficos do painel** — Recharts não integrado; há barra empilhada em CSS,
   mas não a evolução temporal, o mapa de calor nem o funil.
9. **Telas de administração** — território, candidatos, financeiro, artes,
   metas, equipes, perfis e backoffice existem só como API.
10. **Notificação por e-mail** — na concessão de acesso de suporte e na conclusão
   de exportação assíncrona. Depende de serviço de envio inexistente.
11. **CNEFE** — conector opcional de endereços do Censo 2022, nunca iniciado.

### Riscos conhecidos

12. **Parser da apuração ao vivo não validado.** O layout de 2026 só é publicado
    às vésperas do pleito. `analisarBoletim` está isolada para ser a única peça
    a mudar, mas precisa ser confrontada com o arquivo real antes de 04/10.
13. **E2E nunca executado.** As specs do Playwright existem e o `webServer` está
    configurado; falta rodar `pnpm --filter @jeleitoral/web e2e:instalar` e
    depois `e2e`. Spec escrita não é spec passando.
14. **Migrations aplicadas só uma vez.** O CI ainda não roda `db push` — a
    linha de base de produção foi aplicada à mão, o que o próprio runbook
    desaconselha para as próximas.
