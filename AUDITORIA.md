# AUDITORIA — CRM Polatto (AppSec, multi-tenant e código preguiçoso)

**Data:** 2026-11-10 · **Fase 1 (somente diagnóstico — nenhum arquivo de código ou SQL foi alterado)**

## Como esta auditoria foi feita

- **Repositório:** busca por padrão (`grep`/`glob`) em `src/` e `database/`, abrindo só os trechos suspeitos.
- **Banco de produção (projeto Supabase "CRM Polatto", `sa-east-1`):** consultado em **modo leitura, apenas catálogo** (`pg_policies`, `pg_trigger`, `pg_proc`, `pg_indexes`, `storage.buckets`, `cron.job`, advisors do Supabase). Nenhum dado de cliente foi lido e nada foi alterado. Isso foi feito de propósito: os `.sql` do repositório dizem o que *deveria* estar no banco; só o catálogo diz o que *está*.
- **Estado da produção no momento:** 1 empresa, 1 usuário, 0 negócios. Ou seja: **tudo o que está abaixo pode ser corrigido antes de existir dado real de cliente** — é a janela mais barata que o projeto vai ter.

## Veredito honesto

O isolamento entre empresas **está de pé**. Não encontrei nenhuma brecha crítica de vazamento entre tenants: RLS ligada em 100% das tabelas de `public`, nenhuma policy `USING (true)` em tabela de dados, `tenant_id` decidido pelo servidor (trigger fail-closed), papel do usuário gravável só por RPC validada, buckets privados com prefixo de tenant, todas as views com `security_invoker`, toda função `SECURITY DEFINER` com `search_path` fixo, zero segredo no bundle, zero `any`/`@ts-ignore`.

O que sobra **não é "vazar dado de um cliente para outro"**; é: (a) histórico e datas que um vendedor consegue falsificar, (b) fluxos de várias etapas que corrompem dado se a rede cair, (c) uma função de criação de usuário que mexe direto em `auth.users`, (d) um desenho de RLS e de paginação que vai ficar lento com volume. Nenhum item recebeu severidade CRÍTICA — inflar a nota destruiria a utilidade do checklist.

**Legenda:** ALTA = corrigir antes de vender · MÉDIA = corrigir antes de escalar · cada item traz o que foi **confirmado** e, quando for o caso, o que ficou **não verificado**.

---

## PILAR 1 — Fronteira cliente-servidor e segredos

Passou sem ressalva: nenhum `.env` no histórico do git, só `VITE_SUPABASE_URL`/`VITE_SUPABASE_KEY` (chave pública) no bundle, nenhuma `service_role`/token/webhook/SMTP no código, CSP restritiva em `public/serve.json`, `npm audit` no CI. Chamadas externas do navegador: só ViaCEP (público, sem chave) e links `wa.me`/Google Maps.

- [x] **[P1-01] (Severidade: ALTA)** - `database/migrations/2026-11-03_12_papeis_exclusao_lixeira.sql` (função `criar_usuario_equipe`, linhas 291–400) + `src/pages/insights/employees.tsx` (linha 330)
  - **Problema:** A criação de membro da equipe é uma função SQL que faz `INSERT` direto em `auth.users` e `auth.identities`, gerando o hash com `crypt()`. Três defeitos num só lugar: (1) o gerente digita a senha do funcionário e ela viaja em texto pelo corpo da RPC; (2) a conta nasce com `email_confirmed_at = now()` — o e-mail nunca é verificado, então o gerente cria conta em nome de qualquer endereço de terceiro; (3) escrever nas tabelas internas do Supabase Auth não é API suportada: uma atualização do GoTrue que adicione coluna obrigatória quebra o cadastro de equipe sem aviso. `excluir_usuario_equipe` faz o mesmo com `DELETE` em `auth.users`.
  - **Impacto Comercial:** Gerente conhece a senha de todo vendedor (repúdio: "não fui eu que movi esse lead"). Um e-mail de terceiro cadastrado indevidamente fica bloqueado para cadastro próprio ("Este e-mail já possui conta"). E o recurso de equipe pode parar de funcionar num upgrade do Supabase, em produção, com cliente pagante.
  - **Correção Cirúrgica:** Mover para uma **Edge Function** `equipe-convidar` que valida o JWT do chamador, confere `eh_admin_do_tenant` e usa `auth.admin.inviteUserByEmail` (o funcionário define a própria senha pelo link) — a `service_role` fica só no servidor. Vínculo + funcionário + meta gravados numa RPC transacional chamada pela função. A tela continua igual; o campo de senha vira dispensável (decisão sua se some ou não — é o único ponto em que a correção encosta em UI).

- [ ] **[P1-02] (Severidade: MÉDIA)** - `Supabase Auth (configuração do projeto)` — confirmado pelo advisor de segurança
  - **Problema:** Proteção contra senha vazada (HaveIBeenPwned) está **desligada** em produção. Além disso, as configurações de Auth (confirmação de e-mail obrigatória, tamanho mínimo de senha, URLs de redirect permitidas, limites de envio de e-mail) não estão versionadas no repositório — **ponto cego**: não consegui verificá-las por aqui.
  - **Impacto Comercial:** Vendedor usa `123456789`, a conta é tomada por credential stuffing e o invasor exporta a carteira inteira da empresa. Para o cliente, quem vazou foi o seu CRM.
  - **Correção Cirúrgica:** Painel Supabase > Authentication: ligar *Leaked password protection*, exigir confirmação de e-mail, senha mínima ≥ 10, conferir a lista de *Redirect URLs*. Registrar esses valores num `docs/` ou `supabase/config.toml` para deixarem de ser ponto cego. [Guia](https://supabase.com/docs/guides/auth/password-security#password-strength-and-leaked-password-protection).

- [x] **[P1-03] (Severidade: MÉDIA)** - `src/authProvider.ts` (linha 77) + `provisionar_tenant` (migration 10, linha 656)
  - **Problema:** Cadastro é aberto: qualquer pessoa cria conta e, em seguida, uma empresa (limite: 3 por dia por usuário). Não existe cobrança nem aprovação — o plano é atribuído por padrão e só muda via SQL manual. Não é brecha, é regra de negócio ausente: hoje "comercializar" depende de você lembrar de ajustar `tenant_planos` à mão.
  - **Impacto Comercial:** Uso gratuito indefinido por quem descobrir a URL; base poluída de tenants fantasmas; nenhum gatilho automático de bloqueio por inadimplência.
  - **Correção Cirúrgica:** Decidir o modelo antes de vender: (a) cadastro só por convite seu (desligar signup público no Auth e provisionar por Edge Function administrativa), ou (b) self-service com trial + webhook do gateway de pagamento **em Edge Function** atualizando `tenant_planos`. Em ambos os casos a regra vive no servidor; nada muda nas telas.

---

## PILAR 2 — RLS, Storage e multi-tenancy

Confirmado em produção: 41 tabelas, todas com RLS; policies só para `authenticated`; `anon` sem policy nenhuma; buckets `lead-files` (PDF, 10 MB) e `empresa-assets` (PNG/JPEG/WEBP, 2 MB) privados com prefixo `{tenant_id}/`; `utilizadores_empresas` gravável só por superadmin/RPC; triggers `somente_gerente` e `guarda_exclusao` presentes.

- [x] **[P2-01] (Severidade: ALTA)** - `Policies cliente_status_history_tenant_isolation e atividades_lead_tenant_isolation` (`FOR ALL`)
  - **Problema:** As duas tabelas de histórico aceitam `INSERT`, `UPDATE` e `DELETE` de **qualquer membro** da empresa. Não têm trigger `audit_changes` nem `guarda_exclusao`. Um vendedor, pelo console do navegador, apaga a linha "movido para Perdido", edita a descrição de uma atividade ou insere um registro com autor e data inventados.
  - **Impacto Comercial:** O histórico é o que resolve disputa de comissão e "quem perdeu esse cliente". Se é editável, não vale como prova — e o seu cliente descobre isso no pior momento.
  - **Correção Cirúrgica:** Trocar o `FOR ALL` por policies separadas: `SELECT` do tenant; `INSERT` do tenant com colunas de autoria/data forçadas por trigger (ver P3-01); **sem** `UPDATE`/`DELETE` para `authenticated` em `cliente_status_history`; em `atividades_lead`, `UPDATE`/`DELETE` só do autor ou gerente. Nenhuma tela muda.

- [x] **[P2-02] (Severidade: ALTA)** - `Todas as policies no formato tenant_filter(tenant_id)` (migration 02, linha 164) — desenho de RLS
  - **Problema:** `tenant_filter()` é `SECURITY DEFINER` e recebe a coluna da linha. O Postgres não consegue "abrir" função `SECURITY DEFINER` dentro do plano, então ela é **executada linha a linha** — e cada execução roda `current_tenant_id()`, que consulta `utilizadores_empresas`. Pior: como a coluna `tenant_id` fica escondida dentro da função, **os índices de `tenant_id` não são usados pela RLS**. O advisor já acusa o mesmo padrão (`auth_rls_initplan`) em `utilizadores_empresas_proprio` e `system_admins_self_read`.
  - **Impacto Comercial:** Com 1 empresa e 0 negócios é invisível. Com 50 empresas e 200 mil negócios, toda listagem vira varredura da tabela inteira com uma subconsulta por linha: Kanban de 5 segundos e conta de banco subindo.
  - **Correção Cirúrgica:** Reescrever as policies para `tenant_id = (select public.current_tenant_id()) or (select public.is_system_admin())` — o `(select ...)` é avaliado uma vez por consulta e o índice passa a valer. Mesma semântica, mesma suíte de testes de isolamento. Aproveitar para fundir os pares "leitura + escrita `FOR ALL`" que o advisor aponta como policies permissivas duplicadas (10 tabelas).

- [x] **[P2-03] (Severidade: MÉDIA)** - `GRANTs de tabela em public` — confirmado em produção
  - **Problema:** O papel `anon` tem `SELECT/INSERT/UPDATE/DELETE/TRUNCATE` em 28 tabelas e `authenticated` tem `TRUNCATE` em 39. Hoje nada vaza porque a RLS barra — mas a RLS virou a **única** camada. `TRUNCATE` nem passa por RLS (só não é explorável porque a API REST não o expõe).
  - **Impacto Comercial:** Basta uma migration futura criar uma policy errada (ou alguém desligar RLS "para testar") e a chave pública do site lê a tabela. Defesa em profundidade custa um `REVOKE`.
  - **Correção Cirúrgica:** `revoke all on all tables in schema public from anon;` · `revoke truncate, references, trigger on all tables in schema public from authenticated;` · `alter default privileges ... revoke` para tabelas futuras. Incluir a checagem no `relatorio_rls()`.

- [x] **[P2-04] (Severidade: MÉDIA)** - `Funções SECURITY DEFINER expostas em /rest/v1/rpc` — 20 apontadas pelo advisor
  - **Problema:** A maioria é intencional (RPCs da tela). Mas há auxiliares internas chamáveis por qualquer usuário logado. A mais relevante: `enforce_rate_limit(p_chave, p_limite, p_janela)` — o usuário escolhe os três parâmetros, então chama com chave inventada e limite altíssimo em laço e enche `rate_limit_hits` sem freio (a limpeza só remove a própria chave após 7 dias). Também expostas sem necessidade: `registro_eh_do_usuario`, `tenant_filter`, `current_tenant_id`, `is_system_admin`, `membro_do_tenant`, `eh_admin_do_tenant`.
  - **Impacto Comercial:** Um usuário mal-intencionado (ou um cliente com script) infla o banco e degrada todos os tenants.
  - **Correção Cirúrgica:** `revoke execute ... from authenticated` em `enforce_rate_limit` (as funções que a chamam rodam como dono e seguem funcionando). Para as auxiliares usadas dentro de policies, mover para um schema não exposto (`private`) ou aceitar o risco conscientemente — são booleanas sobre o próprio usuário. Trocar `exception when others then return ... sqlerrm` de `criar_usuario_equipe` por mensagem genérica (hoje devolve o erro interno do Postgres para a tela).

- [x] **[P2-05] (Severidade: MÉDIA)** - `Índices` — confirmado em produção
  - **Problema:** Sem índice começando por `tenant_id`: `negocios_pessoas`, `consentimentos`, `acessos_dados_pessoais`, `clientes_legado`. Chaves estrangeiras sem índice de cobertura (advisor): `negocios` (`stage_id`, `pipeline_id`, `responsavel_id`, `pessoa_principal_id`, `organizacao_id`, `motivo_perda_id`), `orcamento_itens (tenant_id, orcamento_id)`, `consentimentos.pessoa_id`, `automacoes_execucoes (tenant_id, negocio_id)` e 5 em `automacoes*`.
  - **Impacto Comercial:** Excluir uma etapa ou uma pessoa obriga o banco a varrer `negocios` inteira para checar a FK; relatórios por responsável/etapa ficam lentos. Só aparece com volume — ou seja, depois da venda.
  - **Correção Cirúrgica:** Uma migration `18_indices_rls_fk.sql` com `create index concurrently if not exists` para cada item acima (só faz efeito pleno depois do P2-02). Os 70 "índices não usados" do advisor devem ser **ignorados por ora**: o banco está vazio, a estatística não significa nada.

- [x] **[P2-06] (Severidade: MÉDIA)** - `Storage: policies lead_files_tenant_delete / lead_files_tenant_update`
  - **Problema:** A tabela `documentos_lead` tem `guarda_exclusao` (vendedor só exclui o que é dele), mas o **arquivo físico** no bucket pode ser apagado ou sobrescrito por qualquer membro da empresa via API de Storage. A regra da tabela é contornável pelo lado do arquivo. Além disso, o bucket confia no MIME declarado: o front envia sempre `contentType: "application/pdf"` (`src/lib/leadTimeline.ts`, linha 552) sem conferir os bytes do arquivo (o upload de logo confere; o de documento, não — **não verifiquei** se há checagem anterior na tela).
  - **Impacto Comercial:** Vendedor que está saindo apaga os contratos anexados dos colegas; o registro continua na tela apontando para um arquivo que não existe mais.
  - **Correção Cirúrgica:** Restringir `DELETE`/`UPDATE` do bucket a gerente ou `owner = auth.uid()`. Validar a assinatura `%PDF-` no cliente antes do upload (mesmo padrão já usado em `validarArquivoLogo`).

- [x] **[P2-07] (Severidade: MÉDIA)** - `Schema backup_crm_20261103` em produção
  - **Problema:** O backup da geração anterior do banco mora dentro do banco de produção, com policies antigas (inclusive para `anon`) e 4 funções sem `search_path`. **Não está exposto** (confirmei: `anon`/`authenticated` sem `USAGE` no schema), mas basta alguém adicionar o schema em *Exposed schemas* para reabrir tudo.
  - **Impacto Comercial:** Dado antigo de cliente guardado sem prazo é passivo de LGPD e superfície de ataque que não gera valor nenhum.
  - **Correção Cirúrgica:** `pg_dump` do schema para arquivo fora do banco, conferir, `drop schema backup_crm_20261103 cascade`. Definir prazo de retenção do arquivo.

- [x] **[P2-08] (Severidade: MÉDIA)** - `Processo de migração` (`database/migrations/README.md`) — ponto cego estrutural
  - **Problema:** As migrations são coladas à mão no SQL Editor; não existe `supabase_migrations.schema_migrations` em produção (confirmado). A ordem tem armadilhas documentadas ("se rodar a 01 de novo, rode a 10 de novo"; "se rodar a 15 ou 16, rode a 17"; "se rodar a 12, rode a 16"). O CI testa contra um Postgres com schemas `auth`/`storage` **simulados**, não contra o Supabase real. Hoje produção e repositório batem (conferi policy por policy) — mas nada garante que continuem batendo.
  - **Impacto Comercial:** Um dia alguém reexecuta a 01 numa correção urgente, esquece a 10, e a view `clientes` volta a aceitar `tenant_id` do payload. Ninguém percebe até o incidente.
  - **Correção Cirúrgica:** Adotar `supabase/migrations` com o CLI (histórico rastreado), e um job agendado que roda `select * from relatorio_rls()` + os advisors em produção e falha se vier linha. Os scripts avulsos `database/*.sql` (que recriam `using (true)`) devem sair do repositório — já abortam na primeira linha, mas continuam sendo munição para copiar e colar.

---

## PILAR 3 — Integridade transacional, RPCs e histórico

Passou: `salvar_orcamento`, `nova_versao_orcamento` e `salvar_automacao` já são RPCs transacionais `SECURITY INVOKER`; totais de orçamento e numeração são calculados no banco; mudança de etapa e de temperatura viram timeline por trigger; em produção **nenhuma** função `SECURITY DEFINER` está sem `search_path`.

- [x] **[P3-01] (Severidade: ALTA)** - `src/pages/clientes/list.tsx` (linha 940), `src/lib/leadTimeline.ts` (linhas 262, 274, 399), view `clientes` (migration 10, linha 286)
  - **Problema:** Datas e autoria de negócio vêm do **relógio e do texto do navegador**: `data_fechamento: new Date().toISOString()` ao mover para ganho/perda (o trigger da view aceita o valor enviado quando não é nulo); `created_at: now` e `criado_por: input.author` nas atividades; `movido_em`/`movido_por` no histórico legado. Qualquer usuário manda a data e o autor que quiser.
  - **Impacto Comercial:** Vendedor fecha em 2 de dezembro e grava 30 de novembro para bater a meta do mês; ou registra uma ligação "feita ontem" em nome de outro. Relatório de metas, ranking e comissão passam a medir o que o vendedor declarou, não o que aconteceu.
  - **Correção Cirúrgica:** No banco: trigger `BEFORE INSERT` em `atividades_lead` e `cliente_status_history` forçando `created_at`/`movido_em = now()` e autoria = `auth.uid()` (nome resolvido de `funcionarios`); no trigger da view `clientes`, ignorar `new.data_fechamento` vindo da API e carimbar `now()` na transição para etapa ganho/perda (gerente pode corrigir por RPC auditada, se você quiser essa válvula). No front: parar de enviar esses campos.

- [x] **[P3-02] (Severidade: ALTA)** - `src/pages/insights/employees.tsx` (linhas 326–412)
  - **Problema:** Salvar um membro são até **5 chamadas soltas**: RPC de criação → `insert` em `metas` (linha 349, **sem ler `{ error }`**) → ou `update funcionarios` → `select metas` → `update`/`insert metas` (linhas 375–394, **todos sem ler `{ error }`**) → RPC de papel. A tela mostra "Membro criado com sucesso!" / "Membro atualizado." mesmo que a meta tenha sido recusada pelo banco.
  - **Impacto Comercial:** Gerente define meta de R$ 80 mil, vê mensagem de sucesso, e a meta não existe. Descobre no fechamento do mês, quando o painel mostra o vendedor "sem meta".
  - **Correção Cirúrgica:** Uma RPC `salvar_membro_equipe(p_funcionario_id, p_nome, p_cargo, p_ativo, p_papel, p_meta_mes)` que faz tudo em uma transação e devolve erro único. A tela só troca as chamadas; layout intacto. (Depende do P1-01 para o caminho de criação.)

- [x] **[P3-03] (Severidade: ALTA)** - `src/lib/leadTimeline.ts` (função de upload de documento, linhas 526–600)
  - **Problema:** Quatro passos no navegador: lê a última versão → sobe o arquivo → marca os anteriores como `substituido` → insere o novo registro. Se o último `insert` falha, o código apaga o arquivo novo mas **não desfaz** o `substituido`: o lead fica sem nenhum documento ativo. E a versão é calculada no cliente — dois uploads simultâneos geram a mesma versão.
  - **Impacto Comercial:** Contrato assinado "some" da tela do lead (está lá, mas marcado como substituído) logo depois de uma queda de internet. É o tipo de bug que o cliente descreve como "o sistema perdeu meu documento".
  - **Correção Cirúrgica:** Manter o upload no Storage e trocar os passos 1, 3 e 4 por uma RPC `registrar_documento_lead(p_cliente_id, p_tipo, p_nome, p_caminho, p_tamanho)` que calcula a versão com trava, substitui os anteriores e insere — tudo ou nada. Se a RPC falhar, o front remove o arquivo (como já faz).

- [x] **[P3-04] (Severidade: MÉDIA)** - `src/pages/insights/goals.tsx` (linhas 192–216) + tabela `metas`
  - **Problema:** Salvar metas é um laço de `update` + `insert` por vendedor; se falhar no terceiro, os dois primeiros já foram gravados. E **não existe índice único** em `(tenant_id, funcionario_id, mes_referencia)` (confirmado em produção) — o próprio comentário no código admite. Duas abas ou um clique duplo criam duas metas para o mesmo vendedor no mesmo mês.
  - **Impacto Comercial:** Meta duplicada soma em dobro no painel; salvamento parcial deixa a equipe com metas de meses diferentes sem ninguém saber.
  - **Correção Cirúrgica:** Índice único (após deduplicar) + RPC `salvar_metas_mes(p_mes, p_metas jsonb)` com `insert ... on conflict do update` numa transação.

- [x] **[P3-05] (Severidade: MÉDIA)** - `src/pages/clientes/list.tsx` (linhas 741–763, `confirmDeleteStage`)
  - **Problema:** Excluir coluna do Kanban = `update` movendo os leads + `delete` da etapa, em duas chamadas. A FK é `on delete set null`: um lead que entrar na etapa entre as duas chamadas (colega arrastando, automação, importação) fica **sem etapa** e some do funil. O `catch {}` da linha 768 ainda descarta o motivo real do erro.
  - **Impacto Comercial:** Lead órfão, invisível no Kanban, que ninguém atende.
  - **Correção Cirúrgica:** RPC `excluir_etapa(p_stage_id, p_destino_id)` que trava a etapa, move e apaga na mesma transação (e recusa se sobrar negócio). Mostrar a mensagem real do erro no `catch`.

- [x] **[P3-06] (Severidade: MÉDIA)** - `src/pages/clientes/list.tsx` (linhas 933–975) e `src/lib/leadTimeline.ts` (linhas 368–418)
  - **Problema:** Mover o card = `update` do lead + segunda chamada gravando "Motivo da perda" na timeline. Se a segunda falha, o usuário vê "Etapa atualizada, mas não foi possível registrar no histórico". O motivo **já vai** na coluna `motivo_perda` do próprio `update` — a segunda chamada é redundante. O ramo "legado" (id não-UUID, linhas 393–417) é código morto depois da virada e é justamente o que grava histórico com relógio do cliente.
  - **Impacto Comercial:** Timeline incompleta e um aviso amarelo que o vendedor aprende a ignorar.
  - **Correção Cirúrgica:** Fazer o trigger `registrar_mudanca_stage` incluir o `motivo_perda` na linha que ele já grava; apagar a segunda chamada e o ramo legado.

- [x] **[P3-07] (Severidade: MÉDIA)** - `Soft delete com data do navegador` — `leadTimeline.ts:703`, `orcamentos/api.ts:339`, `organizacoes/index.tsx:197`, `pessoas/index.tsx:290`, `agenda/index.tsx:121`, `primeiro-acesso.tsx:41`
  - **Problema:** `deleted_at` (e `dispensado_em`) saem de `new Date()` do cliente. O trigger `guarda_exclusao` carimba **quem** excluiu (`deleted_by = auth.uid()`), mas aceita **quando** do payload.
  - **Impacto Comercial:** Ordem da lixeira e política de retenção LGPD (que conta dias a partir da data) passam a depender do relógio de cada computador — ou de quem quiser adulterar.
  - **Correção Cirúrgica:** No `guarda_exclusao`: `new.deleted_at := case when new.deleted_at is null then null else now() end`. O front pode continuar enviando qualquer valor não nulo.

- [x] **[P3-08] (Severidade: MÉDIA)** - `Cobertura do audit_log` — confirmado em produção
  - **Problema:** Sem trigger `audit_changes`: `tarefas`, `atividades_lead`, `cliente_status_history`, `negocios_pessoas`, `consentimentos` (LGPD!), `orcamento_itens`. E só existe **um** job no `pg_cron` (automações): `aplicar_politica_retencao()` e `limpar_erros_antigos()` nunca foram agendados — o README os lista como "agendar depois".
  - **Impacto Comercial:** Alteração de consentimento LGPD sem trilha; item de proposta alterado sem rastro; `audit_log`, `client_errors` e `automacoes_execucoes` crescendo para sempre.
  - **Correção Cirúrgica:** Ligar `audit_changes` nas 6 tabelas; agendar os dois jobs no `pg_cron`; definir retenção para `audit_log` e `automacoes_execucoes`.

---

## PILAR 4 — Código preguiçoso no React

Passou: **zero** `any`, `@ts-ignore`, `@ts-nocheck`; zero `localhost`; zero `dangerouslySetInnerHTML`/`eval`; `window.open` com `noopener`; formulários e modais principais travam o botão durante o envio (`confirmLoading`/`loading` conferidos em leads, agenda, pessoas, organizações, importação, lixeira, empresa). As permissões de "só gerente" da tela **têm trava real no banco** (triggers conferidos em produção) — não é segurança de fachada.

- [x] **[P4-01] (Severidade: ALTA)** - `src/lib/leadTimeline.ts` (linhas 261–334, `addLeadActivity`; linha 180) e `src/lib/crmEmployees.ts` (linha 85)
  - **Problema:** Código de "adivinhar o schema": tenta **4 formatos de payload diferentes** em sequência (`cliente_id`/`lead_id`, `tipo`/`activity_type`, `titulo`/`title`...) e, se o banco responde "coluna não existe", engole e tenta o próximo; se a tabela não existe, devolve `false` em silêncio. `crmEmployees` faz o mesmo entre tabelas de funcionários. Isso é resquício de quando o schema não era versionado.
  - **Impacto Comercial:** Um erro real de coluna (migration esquecida) vira "atividade não registrada" sem mensagem. O bug fica meses escondido porque o código foi escrito para não reclamar.
  - **Correção Cirúrgica:** O schema hoje é conhecido e testado: manter **um** payload, apagar os fallbacks e deixar o erro subir para a tela. Mesma limpeza nos `isSupabaseMissingColumn`/`isSupabaseMissingRelation` espalhados.

- [x] **[P4-02] (Severidade: MÉDIA)** - `Blocos catch {} sem causa` — ~40 ocorrências; confirmadas: `clientes/list.tsx:768`, `configuracoes/crm/pipelines.tsx:182 e 206`, `components/header/index.tsx:58`, `base-clientes/page.tsx:73`
  - **Problema:** Padrão `catch { message.error("Não foi possível X.") }` que joga fora o erro do banco (não mostra, não envia ao `registrar_erro_cliente`). No sino de tarefas, erro = esconder o sino. Em `base-clientes` a consulta das etapas de ganho ignora `{ error }`: falha vira "carteira vazia". **Não revisei as ~35 restantes uma a uma** — várias são legítimas (`localStorage` indisponível, por exemplo).
  - **Impacto Comercial:** Suporte cego: o cliente manda print de "Não foi possível excluir a coluna" e você não tem como saber se foi permissão, FK ou rede.
  - **Correção Cirúrgica:** Triagem das 40: onde houver chamada ao banco, usar `getSupabaseErrorMessage(error)` (já existe) na mensagem e reportar via `errorMonitoring`. Sem mudança visual além do texto do aviso.

- [x] **[P4-03] (Severidade: MÉDIA)** - `src/pages/clientes/list.tsx` (linhas 565–582)
  - **Problema:** O aviso "Novo lead recebido" escuta `postgres_changes` na tabela `clientes` — que depois da virada é uma **view**. Realtime não emite eventos de view, e a publicação em produção só contém `negocios`, `tarefas` e `pipeline_stages`. O recurso está morto e ninguém percebeu porque não dá erro. O próprio comentário diz "enquanto clientes for tabela".
  - **Impacto Comercial:** Funcionalidade que você pode estar vendendo ("avisa na hora quando chega lead") e que não funciona.
  - **Correção Cirúrgica:** Apontar o listener para `negocios` (reaproveitando `useRealtimeNegocios`) ou remover.

- [x] **[P4-04] (Severidade: MÉDIA)** - `src/authProvider.ts` (linhas 77–96, `register`)
  - **Problema:** Após `signUp`, devolve sucesso e redireciona para `/` sempre que há `data` — inclusive quando a confirmação de e-mail está ligada e **não existe sessão**. O usuário é jogado de volta ao login sem nenhuma explicação.
  - **Impacto Comercial:** Primeiro contato do cliente com o produto é "cadastrei e não entrou". Vira ticket ou desistência.
  - **Correção Cirúrgica:** Se `data.session` for nulo, retornar sucesso com notificação "Enviamos um link de confirmação para seu e-mail" e sem redirect.

- [x] **[P4-05] (Severidade: MÉDIA)** - `src/types/db.ts` (165 linhas, escrito à mão) × 41 tabelas no banco
  - **Problema:** Não há `any`, mas há a versão educada dele: `Record<string, unknown>` e `as Tipo` nos retornos do Supabase. Os tipos são mantidos à mão e cobrem uma fração do schema; nada avisa quando uma coluna muda de nome.
  - **Impacto Comercial:** Migration renomeia coluna, o build passa verde e a tela quebra em produção.
  - **Correção Cirúrgica:** Gerar `src/types/database.generated.ts` com `supabase gen types` no CI e tipar o `createClient<Database>`. Zero impacto visual.

- [x] **[P4-06] (Severidade: MÉDIA)** - `tenant_id` enviado pelo front — `list.tsx:746 e 936`, `import-leads.tsx:107`, `employees.tsx:353`, `goals.tsx:209`, `leadTimeline.ts:267`; e `src/lib/leadVisibility.ts` (linhas 23 e 61)
  - **Problema:** (a) O front ainda manda `tenant_id` em vários payloads. O banco sobrescreve (está seguro), mas o código sugere que é o cliente quem decide — convite para alguém "consertar" do jeito errado. (b) `leadVisibility` guarda em `localStorage` a marcação de "visto por último" dos leads: troca de computador ou limpeza do navegador e tudo volta a aparecer como novo (**não li o arquivo inteiro**; confirmar o uso antes de mexer). `crm_tenant_id` em `localStorage` está correto: é só preferência, validada no servidor.
  - **Impacto Comercial:** Baixo hoje; é dívida que confunde o próximo desenvolvedor e dado de uso que não acompanha o usuário.
  - **Correção Cirúrgica:** Remover `tenant_id` dos payloads; decidir se "visto por último" merece tabela própria.

- [x] **[P4-07] (Severidade: MÉDIA)** - `Clique duplo / concorrência` — `list.tsx` (`moverLeadParaStage`), `import-leads.tsx` (linhas 100–135)
  - **Problema:** Os botões travam, mas duas operações não têm trava **no banco**: arrastar o mesmo card duas vezes rápido dispara dois `update` concorrentes (o último vence, e cada um gera linha de histórico); a importação deduplica **no cliente** (lê telefones/e-mails, depois insere) — duas abas importando a mesma planilha duplicam tudo, pois não há índice único de dedup em `pessoas`.
  - **Impacto Comercial:** Leads duplicados na base (dois vendedores ligando para o mesmo contato) e timeline com movimentos fantasma.
  - **Correção Cirúrgica:** Ignorar o drop enquanto o card tem mutação pendente (flag por id, sem mudar visual); dedup de importação no servidor por RPC `importar_leads(jsonb)` com `on conflict` — que também resolve o "lote parcial".

---

## PILAR 5 — Escala e vazamento de memória

Passou: todos os `supabase.channel()` têm `removeChannel` no cleanup; os dois `setInterval` têm `clearInterval`; listeners de `window` são removidos. **Não encontrei conexão fantasma.**

- [x] **[P5-01] (Severidade: ALTA)** - `src/lib/dataProviderPaginado.ts` (linhas 39–94) usado por ~45 consultas com `pagination: { mode: "off" }`
  - **Problema:** O wrapper foi escrito para "trazer todas as linhas, não só as 1000 primeiras": busca página após página, em série, e junta tudo na memória do navegador. É usado no dashboard (5 consultas), em todas as telas de Insights (`panel`, `roi`, `gains-losses`, `activities`, `origins`), `pessoas`, `organizacoes`, `orcamentos`, `historico`, `agenda` e 4 vezes em `clientes/list.tsx`. Os KPIs são então somados em JavaScript.
  - **Impacto Comercial:** Cliente com 30 mil leads abre o dashboard: 30 requisições encadeadas de 1000 linhas **por consulta**, vários MB de JSON, aba travada no celular do vendedor. É o primeiro sintoma que um cliente grande vai relatar.
  - **Correção Cirúrgica:** Separar em dois grupos. (1) **Listas pequenas e limitadas por natureza** (etapas, funis, campos personalizados, tipos, origens): manter. (2) **Tabelas que crescem** (`clientes`, `tarefas`, `atividades_lead`, `pessoas`, `organizacoes`, `orcamentos`): agregação no banco (já existem `vw_dashboard_kpis`, `vw_kanban_kpis`, `vw_performance_vendedores`, `vw_vendas_por_origem` — criar as que faltam) e paginação de servidor nas tabelas. As telas recebem os mesmos números; nada de layout muda.

- [x] **[P5-02] (Severidade: MÉDIA)** - `src/lib/crmEmployees.ts` (linha 85) e `src/lib/leadTimeline.ts` (linha 180)
  - **Problema:** `select("*")` sem `limit` nem filtro. `fetchEmployeeByEmail` — chamado por `useCrmAccess` em praticamente toda tela — baixa a tabela `funcionarios` **inteira** para achar uma pessoa pelo e-mail no JavaScript. A timeline do lead traz todas as atividades, sem ordenação nem teto.
  - **Impacto Comercial:** Carga inútil repetida a cada navegação; lead antigo com 2 mil atividades demora a abrir.
  - **Correção Cirúrgica:** `.select("id,nome,email,cargo,user_id").eq("email", email).maybeSingle()`; timeline com `.order("created_at", { ascending: false }).range()` e "carregar mais".

- [x] **[P5-03] (Severidade: MÉDIA)** - `src/pages/clientes/list.tsx` (linhas 240–270 e 500–512)
  - **Problema:** A cada 2 minutos o Kanban rebusca até 1000 tarefas para calcular "próxima tarefa" de cada card no cliente; outra consulta de `funcionarios` com `limit(1000)`. A view `vw_negocios_saude` já entrega `próxima tarefa` calculada no banco.
  - **Impacto Comercial:** Com mais de 1000 tarefas abertas o indicador passa a mentir (corta silenciosamente); com muitos usuários, é polling pesado multiplicado.
  - **Correção Cirúrgica:** Ler a próxima tarefa de `vw_negocios_saude` (o código já tem o ramo `saudeDisponivel`) e remover o polling.

- [x] **[P5-04] (Severidade: MÉDIA)** - `src/App.tsx` (linha 114, `liveProvider`) + canais manuais
  - **Problema:** O `liveProvider` do Refine está ligado globalmente **e** existem canais manuais (`useRealtimeNegocios`, agenda, lista de leads) **e** polling no sino e no Kanban — três mecanismos de atualização sobrepostos. Nenhum vaza, mas cada aba aberta mantém várias assinaturas; os nomes de canal são fixos e sem filtro de tenant (a RLS filtra o conteúdo, então não vaza dado).
  - **Impacto Comercial:** Estouro do limite de conexões Realtime do plano Supabase com poucas dezenas de usuários simultâneos.
  - **Correção Cirúrgica:** Escolher um mecanismo por recurso (Realtime para `negocios`/`tarefas`, sem polling) e adicionar `filter: tenant_id=eq.<id>` nos canais para o servidor nem avaliar eventos de outros tenants.

---

## Pontos cegos declarados (o que NÃO consegui verificar)

1. **Configuração do Supabase Auth** (confirmação de e-mail, política de senha, redirect URLs, rate limit de e-mail, provedores OAuth) — fora do repositório e do catálogo SQL. Ver P1-02.
2. **Edge Functions:** o repositório não tem nenhuma. Não listei as de produção; se existir alguma, não foi auditada.
3. **`.htaccess` / deploy Hostinger:** conferi `public/serve.json`; não validei se o `.htaccess` publicado está idêntico nem os cabeçalhos da URL real.
4. **Corpo de `alterar_papel_membro`, `excluir_usuario_equipe`, motor de automações e LGPD:** confiei na suíte `database/tests` (isolamento, papéis, hardening) e conferi só cabeçalho, `search_path` e checagem de gerente. Não reli linha a linha.
5. **~35 dos ~40 `catch {}`** e o uso completo de `leadVisibility` — amostragem, não revisão total (regra de economia de tokens).
6. **Backups/PITR do projeto Supabase** e quem tem acesso ao painel — operacional, fora do código.

## Ordem sugerida para a Fase 2

1. **Banco primeiro, sem tocar em tela:** P2-01, P3-01, P3-07, P2-03, P2-04, P3-08 (uma migration `18`, com testes).
2. **RLS de performance:** P2-02 + P2-05 (migration `19`; reexecutar a suíte de isolamento inteira).
3. **RPCs transacionais + troca das chamadas no front:** P3-02, P3-03, P3-04, P3-05, P3-06.
4. **Equipe por Edge Function:** P1-01 (e decidir P1-03).
5. **Limpeza de front:** P4-01 a P4-07.
6. **Escala:** P5-01 a P5-04.
7. **Processo:** P2-07, P2-08, P1-02, P4-05.

> Observação: o `CLAUDE.md` do projeto está desatualizado (diz que não há testes; há Vitest e suíte de banco; a tabela de rotas não lista orçamentos, automações, lixeira, pessoas, organizações). Não afeta produção, mas induz a IA a erro nas próximas sessões.

---

## Notas de execução (Fase 2)

- **P4-06 revisto.** O `tenant_id` enviado pelo front **não é resto de código**: é o que permite ao administrador da plataforma gravar na empresa selecionada (para os demais usuários o banco ignora o valor). Foi mantido. `leadVisibility.ts` era código morto (ninguém importava) e foi removido.
- **P4-05 continua aberto.** Gerar os tipos do banco exige o CLI do Supabase com token de acesso (não disponível no ambiente de execução) e ligar o cliente tipado deve gerar uma leva de erros de tipo a corrigir tela a tela — é um bloco próprio.
- **P5-02 corrigido em parte no P4.** `fetchEmployeeByEmail` já filtrava por e-mail no banco (o diagnóstico original estava errado nesse ponto); quem baixava a tabela inteira com `select *` era a lista de responsáveis, agora com colunas explícitas e sem removidos.
- **Achados novos, já corrigidos:** (1) o link de arquivo da timeline era uma URL assinada de 24h gravada no banco — vencia no dia seguinte; agora é assinado ao exibir. (2) Painel e log de Insights liam `cliente_status_history`, onde negócio do modelo atual fica com id nulo; passaram a ler as mudanças de etapa de `atividades_lead`. (3) Falha ao carregar os vínculos do usuário era tratada como "usuário sem empresa" e o app oferecia criar uma empresa.
- **P2-07 e P1-02** aguardam ação/decisão do dono (apagar o schema de backup; ligar a proteção de senha vazada no painel).
- **P5-01 feito em parte.** Painel comercial e Histórico passaram a usar o resumo agregado no banco (`vw_kanban_kpis`); ROI, Ganhos e perdas e Atividades pedem ao banco só o período escolhido; Pessoas e Organizações têm paginação e busca no servidor. **Falta a lista de Orçamentos**, que ainda baixa todos os orçamentos: os cartões de resumo e a busca pelo nome do cliente dependem da lista inteira e pedem uma view de resumo própria.
- **P5-03 revisto.** O polling de tarefas do Kanban só roda no modo antigo (banco sem a view de saúde); no modo normal a próxima tarefa já vinha na linha do card. O defeito real era outro: qualquer falha passageira ao sondar a view rebaixava o board para o modo antigo pela sessão inteira — corrigido.
- **P5-04.** Removidas as assinaturas de realtime em views (uma por coluna do Kanban, nunca recebiam evento); agenda com um canal só; canais filtrados por empresa.
- **Busca em Pessoas/Organizações** agora é feita pelo banco: não diferencia maiúsculas, mas passou a diferenciar acentos ("joao" não encontra "João").
- **P4-05 concluído.** `scripts/gerar-tipos-do-banco.mjs` gera `src/types/database.generated.ts` a partir de um Postgres com as migrations aplicadas (sem o CLI do Supabase); o schema local e o de produção têm a mesma impressão digital (581 colunas). O cliente Supabase é tipado; os 23 pontos acusados pelo compilador foram corrigidos; o CI falha se os tipos ficarem diferentes do banco.
- **P5-01 concluído.** A lista de Orçamentos pagina, busca e filtra no banco (`vw_orcamentos_lista`) e os cartões vêm de `vw_orcamentos_resumo` (migration 22).
- **Deploy na Vercel:** `vercel.json` com as rotas do app e os mesmos cabeçalhos de segurança de `serve.json` (teste de paridade). Na Vercel, definir `VITE_SUPABASE_URL` e `VITE_SUPABASE_KEY` (chave pública).
- **Ainda abertos:** P2-07 (apagar o schema `backup_crm_20261103` — irreversível, aguarda autorização), P1-02 (painel do Supabase) e o teste real da Edge Function `equipe-usuarios`, que só acontece com o front publicado.
- **Teste de ponta a ponta em produção (2026-11-16), com login de teste em empresa separada.** Navegador automatizado: 22 telas carregam sem erro de rede ou console, vazias e com dados; criar lead pelo formulário, criar e remover membro pela tela (Edge Function com CORS real) e mover card no Kanban funcionam. Chamadas diretas com o mesmo login: 67 de 68 verificações passaram; a que falhou era asserção errada do teste (o `update` ecoa a data enviada, mas o banco grava a hora do servidor — conferido relendo).
- **Defeitos achados no teste e corrigidos:** (1) mensagens de login em inglês; (2) card movido no Kanban continuava desenhado na coluna antiga (a invalidação não atingia as consultas infinitas das colunas); (3) lead importado sem etapa não aparecia em nenhuma coluna — `importar_leads` passa a usar a primeira etapa aberta do funil.
- **P2-07 concluído:** schema `backup_crm_20261103` apagado pelo dono, após cópia das linhas não padrão.
- **Não testado:** upload de PDF pela tela, geração do PDF de proposta, importação de CSV pela tela, arrastar e soltar com o mouse (o botão "Mover" foi testado), automações agendadas e o realtime entre duas abas.

## Revisão final de front-end (17/11/2026) — commits `78403dd` e `e0dcec3`

Testado em produção (Supabase real) com o login de teste, no build de produção, em computador, celular e modo escuro.

**Defeito grave encontrado e corrigido**
- [x] **[RF-01] (Alta)** — `src/utility/antdReact19.ts`
  - **Problema:** com React 19, `message.*`, `Modal.confirm` e `notification.*` do antd não desenhavam nada (147 chamadas em 28 arquivos).
  - **Impacto Comercial:** o usuário não via "salvo", não via erro e o "Excluir selecionados" não abria confirmação — parecia sistema quebrado.
  - **Correção Cirúrgica:** ponte de renderização do React 19 carregada antes de tudo; janelas herdam tema e pt-BR. Verificado no navegador (confirmação, aviso "1 lead excluído.", "Etapa atualizada com sucesso").

**Retoques de tela**
- [x] Login/recuperação de senha com painel da marca; "Criar conta" escondido enquanto o cadastro estiver fechado (`/register` volta ao login).
- [x] Configurações: abas Geral e Notificações eram fachada (não salvavam) → removidas; "Modo noturno" agora funciona.
- [x] Dashboard e Meu dia sem buraco em branco; relatórios alinhados; cartões de KPI com mesma altura.
- [x] Agenda: texto do agendamento não corta mais; busca (Ctrl+K) já abre digitável.
- [x] Plurais, "Equipe" (não "Equipa"), mês MM/AAAA, rótulos do ROI, taxa de perda sem alarme falso, telefone sempre formatado.
- [x] Botão destrutivo vermelho; desabilitado não parece clicável; KPI no escuro sem "%" de outra cor.
- [x] Mensagens de desenvolvedor ("execute a migration", "policies RLS", "bucket") trocadas por avisos para o usuário.
- [x] Lead importado sem CPF pode ser editado (lead novo continua exigindo).
- [x] Banco: mudança de etapa assinada com o nome do vendedor, não o e-mail (aplicado em produção, com acerto do histórico).

**Fluxos testados pela interface:** criar lead, editar, mover (botão e arrastar, persiste após recarregar), temperatura, anotação, upload de PDF e link assinado, PDF da proposta, importação CSV, excluir em lote → lixeira → restaurar, agenda (criar e abrir), contatos, organizações, metas, motivos de perda, 10 seções de Configurações, busca global, lista, equipe (Edge Function), 21 telas sem erro de console/rede e sem rolagem lateral no celular.

**Verificação final:** banco 786/786, 357 testes unitários, tipos e lint sem erro, build ok.

**Pendências que são suas (não de código)**
1. Supabase → Authentication: ligar *leaked password protection* e desligar cadastro público (P1-02).
2. Supabase → Authentication → URL Configuration: incluir o domínio da Vercel em Site URL e Redirect URLs (senão o e-mail de "esqueci a senha" aponta para o endereço errado).
3. Vercel: `VITE_SUPABASE_URL` e `VITE_SUPABASE_KEY` (chave pública).
4. Trocar a senha ou apagar o login de teste — a senha passou pelo chat.
5. Meio de pagamento: decisão de negócio pendente.

## Verificação independente (17/11/2026, noite)

Conferência item por item deste documento contra o código do `testes-kanban` e contra o catálogo do banco de produção (só leitura, sem ler dado de cliente).

**Execução local:** banco 787 asserções aprovadas, 0 falhas (Postgres 16, migrations duas vezes + instalação do zero) · 357 testes unitários · tipos e lint sem erro · build ok.

**Confirmado em produção:** 57 policies no formato `(select current_tenant_id())` e nenhuma com `tenant_filter(...)` (P2-02) · `anon` sem nenhum privilégio de tabela e `authenticated` sem `TRUNCATE` (P2-03) · `enforce_rate_limit`/`registro_eh_do_usuario` fora da API (P2-04) · nenhuma FK sem índice (P2-05) · policies restritivas no `lead-files` (P2-06) · schema de backup apagado (P2-07) · `cliente_status_history` sem escrita pela API (P2-01) · `uq_metas_funcionario_mes` (P3-04) · `audit_changes` nas 6 tabelas (P3-08) · migrations até a 22, Edge Function `equipe-usuarios` ativa com JWT, cadastro fechado (P1-01, P1-03) · 3 jobs do `pg_cron` com 78/78 execuções ok nos últimos 3 dias (automações agendadas, que constavam como "não testado").

**Confirmado no código:** RPCs transacionais em uso (P3-02 a P3-05, P4-07) · trava de um movimento por card · sem data/autor do navegador (P3-01, P3-07) · realtime fora da view `clientes` (P4-03) · cadastro sem sessão avisa (P4-04) · assinatura `%PDF-` no upload (P2-06) · os 25 `catch` sem variável restantes são legítimos (P4-02) · `antdReact19` é o primeiro import (RF-01).

**Ressalvas (marcados como feitos, mas com diferença em relação à correção proposta):**
- **P1-01:** o login da equipe saiu de `auth.users` (o defeito de risco), mas é criado com a senha digitada pelo gerente e e-mail já confirmado, não por convite. O gerente continua conhecendo a senha inicial; o membro pode trocá-la em Meu perfil. Para o piloto não importa; antes de vender, considerar convite por e-mail ou troca obrigatória no primeiro acesso.
- **P2-08:** feito em parte. Saíram os scripts avulsos e entrou o `relatorio_privilegios()`, mas as migrations continuam aplicadas à mão (sem `supabase/migrations` + CLI) e não há job agendado rodando os linters. Não bloqueia o piloto.

**Corrigido nesta verificação:** um alerta alto publicado hoje no `picomatch` (sem versão corrigida) derrubaria o gate `npm audit` do CI no próximo push. Ele só chegava por `@refinedev/cli` e `@refinedev/devtools`, ferramentas que não vão para o navegador, agora em `devDependencies` (nenhuma versão mudou). `CLAUDE.md` com a tabela de rotas completa (a observação da linha final da Fase 1).

**Busca que ignora acentos (pendência das notas da Fase 2, corrigida em 18/11):** "joao" não achava "João" — e não só em Pessoas/Organizações: também no Kanban, na busca global (Ctrl+K), em Orçamentos e no seletor de lead da Agenda. Migration 23: coluna calculada `busca_sem_acento` nas 5 fontes, sem alterar tabela nem view; o front filtra por ela com o termo sem acento (`src/lib/buscaSemAcento.ts`). Suíte 18 (13 asserções), inclusive a prova de que nada que a busca antiga achava deixa de ser achado; teste de paridade do mapa de letras SQL × front. Aplicada em produção e conferida: funções `SECURITY INVOKER`, nada para a chave pública, linters iguais aos de antes, coluna reconhecida pela API nas 5 fontes. Banco 800/800, 361 testes unitários, tipos do banco em dia, build ok.

**Pendências do dono, atualizadas:**
1. *Leaked password protection* (P1-02) só existe no plano Pro do Supabase: fica para a migração ao plano pago.
2. O login de teste e a "Empresa de Teste E2E" continuam em produção (2 logins no Auth): trocar a senha ou apagar antes de entregar ao cliente.
3. Plano gratuito: o projeto pausa após cerca de uma semana sem uso e não tem backup diário. Avisar o cliente do piloto.
4. A empresa do cliente ainda não existe ("Empresa Pioneira" não tem negócios): usar a Pioneira ou abrir o cadastro, cadastrar e fechar de novo.
