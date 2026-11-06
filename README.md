# Sorteador de Comentários do Instagram

Aplicação web para sortear ganhadores a partir dos comentários de uma publicação do Instagram, um por vez.
O usuário cola o link, carrega os comentários, ajusta as regras (se precisar) e clica em **Sortear ganhador**.

- **Coleta real** pela API oficial do Instagram, com paginação completa, respostas e deduplicação
- **Sorteio no servidor** com `crypto.randomInt` (gerador criptográfico). A animação é só visual.
- **Regras configuráveis**: ganhadores repetidos, chance por comentário ou por perfil, palavra obrigatória, hashtag, menções mínimas, exigir marcação, exclusões
- **Histórico** com posição, @, comentário, data e hora e nº do sorteio; remoção com confirmação, exportação CSV e cópia da lista
- **Tokens só no backend.** O navegador nunca recebe a chave do Instagram.

---

## Buscar comentários sem login: botão "Enviar para o sorteador"

É o jeito mais simples e não exige conta de desenvolvedor, token nem API. Funciona com post de **qualquer** conta.

1. No sorteador, clique em **Botão do Instagram** (topo) e siga a aba **Computador** ou **Celular** para instalar o favorito *Enviar para o sorteador*. Isso é feito só uma vez.
2. Abra o post no **instagram.com**, no navegador onde você já usa o Instagram.
3. Clique no favorito. Uma aba do sorteador abre e recebe os comentários e as respostas. O progresso aparece no canto da página do Instagram.

Como funciona: o favorito lê os comentários que o seu próprio navegador já consegue ver, ou seja, a mesma visão de quando você abre o post, e entrega para a aba do sorteador por `postMessage`. O sorteador só aceita mensagens vindas de `instagram.com` e revalida todos os dados no servidor.

Limitações, para ficar transparente:
- **É uma leitura não oficial.** O Instagram não aprova automação, e o botão pode precisar de ajuste se o site mudar.
- O Instagram só mostra os comentários para quem está **logado no site**, no navegador em que o botão é usado.
- No celular, o post precisa ser aberto no **navegador** (Safari ou Chrome), não no app.
- O botão vai devagar e pausa quando o Instagram pede. Se a leitura parar antes do fim, o sorteio fica marcado como **coleta parcial**, com o motivo.
- A publicação aparece como *"Lido pelo navegador · fonte não oficial"*.

Teste local, com Instagram simulado e dados de teste: `node backend/test/fakeInstagramWeb.js 4020`. Depois abra `http://localhost:4020/p/TESTE123abc/`.

## ⚠️ O que a API oficial permite (leia antes)

O Instagram **não oferece API oficial para ler comentários de qualquer publicação pública.**
Com a *Instagram API* (login do Instagram), uma conta **profissional** (Empresa ou Criador de conteúdo) só pode ler os comentários das **próprias publicações**.

| Situação | O que acontece |
|---|---|
| Post/reel da conta conectada | ✅ Coleta completa de comentários e respostas |
| Post de outra conta | ❌ Mensagem clara: *"Esta publicação não pertence à conta conectada"*, com duas saídas: conectar a conta dona da publicação **ou** usar **Importar lista** |
| Stories / destaques | ❌ Não têm comentários públicos |
| Comentários ocultos, excluídos, filtrados ou de contas restritas | Não são devolvidos pela API. O sistema mostra a diferença entre o total informado pelo post e o total coletado. |

**Importar lista** é a alternativa para quando a API não dá acesso. Você cola (ou envia um `.csv`/`.txt`) os comentários exportados pelo dono da publicação. O sorteio fica marcado como **"Importação manual · não verificada pela API"**, para que ninguém confunda com uma coleta oficial.

O sistema não faz scraping e não usa dados fictícios.

---

## Requisitos

- Node.js **20.12+** (testado com 22)
- Uma conta do Instagram **profissional** (Empresa ou Criador de conteúdo)
- Um app no [Meta for Developers](https://developers.facebook.com/) com o produto **Instagram** (API setup with Instagram login)

## Instalação

```bash
npm install
cp .env.example .env      # depois edite o .env (veja abaixo)
```

### Desenvolvimento

```bash
npm run dev
```

Abre o backend em `http://127.0.0.1:3001` e a interface em **http://localhost:5173** (o Vite repassa `/api` para o backend).

### Produção / uso diário

```bash
npm run build     # compila o frontend
npm start         # backend serve API + interface em http://localhost:3001
```

No `.env`, use `APP_URL=http://localhost:3001` neste modo.

### Testes

```bash
npm test
```

São 13 testes. Eles cobrem a validação de links, todas as regras, os modos de participação, a ausência de repetição, a uniformidade estatística do sorteio, CSV e importação, além de um fluxo de ponta a ponta contra uma **Graph API falsa**. Essa API falsa (`backend/test/fakeGraph.js`) devolve só dados de teste identificados (`teste_usuario_*`) e simula paginação, respostas paginadas, itens duplicados entre páginas, limite de requisições e token inválido.

---

## Conectando a conta do Instagram

### Passo 1: conta profissional
No app do Instagram: **Configurações → Tipo de conta e ferramentas → Mudar para conta profissional** (Empresa ou Criador).

### Passo 2: criar o app na Meta
1. Acesse [developers.facebook.com/apps](https://developers.facebook.com/apps) → **Criar app**.
2. Escolha o caso de uso de **Instagram** ("Gerenciar mensagens e conteúdo no Instagram").
3. No painel do app: **Instagram → API setup with Instagram login**.
4. Em permissões, garanta **`instagram_business_basic`** e **`instagram_business_manage_comments`**.
5. Enquanto o app estiver em modo de desenvolvimento, a conta do Instagram precisa ter uma função no app: **Funções do app → Funções → Adicionar Testador do Instagram**. Depois aceite o convite no Instagram em *Configurações → Apps e sites → Convites de testador*.

Depois disso, conecte **pela própria página**, sem mexer em código nem no Render. Clique em **Conectar Instagram** no topo e escolha uma das formas:

### Forma 1: botão "Entrar com Instagram" (recomendada)
Configuração única:
1. No painel do app: **Instagram → API setup with Instagram login → Set up Instagram business login**. Em *Redirect URL*, cole o endereço que a janela "Conectar Instagram" mostra (botão **Copiar**). Ex.: `https://sorteador-instagram-lrc9.onrender.com/api/auth/callback`
2. Copie o **Instagram app ID** e o **Instagram app secret** dessa tela (são diferentes do App ID do Facebook) e cole na janela. Clique em **Salvar e ativar login**.

A partir daí, conectar é só clicar em **Entrar com Instagram**: você faz login na página oficial do Instagram e volta conectado. O token de longa duração (60 dias) é **renovado automaticamente**.

### Forma 2: colar um token
1. Em **API setup with Instagram login → Generate access tokens**, clique em **Add account**, faça login e depois em **Generate token**.
2. Na janela "Conectar Instagram", clique em **colar token**, cole e confirme. O sistema verifica o token na hora e mostra a conta conectada.

### Onde a conexão fica guardada
O token e os dados do app ficam num **cookie criptografado (AES-256-GCM)** neste navegador. Só o servidor consegue abrir, com a chave `TOKEN_SECRET` gerada automaticamente pelo Render. Por isso a conexão continua valendo mesmo quando o servidor gratuito "dorme" e reinicia. Em outro computador ou navegador, conecte de novo. O sistema **nunca pede a senha do Instagram**.

> Também é possível configurar pelo servidor, com as variáveis `INSTAGRAM_ACCESS_TOKEN` ou `IG_APP_ID` + `IG_APP_SECRET` (+ `IG_REDIRECT_URI`) no `.env` ou no painel do Render.
>
> Para que contas **sem função no app** (clientes, por exemplo) possam conectar, o app precisa passar pela **Análise do App** da Meta com acesso avançado às duas permissões.

### Avançado: Facebook Login for Business
Se você já usa tokens de página do Facebook (`graph.facebook.com`) com a permissão `instagram_manage_comments`:
```env
IG_GRAPH_BASE=https://graph.facebook.com
IG_USER_ID=17841400000000000   # ID da conta do Instagram vinculada à página
INSTAGRAM_ACCESS_TOKEN=EAA...
```

---

## Como o sorteio funciona

1. **Coleta.** O link é validado (`/p/`, `/reel/`, `/reels/`, `/tv/`, com ou sem `@usuario/`). O backend procura a mídia entre as publicações da conta (`/me/media`, paginado), depois busca `/{media-id}/comments` com as respostas embutidas, seguindo **todas** as páginas, inclusive das respostas. Comentários repetidos entre páginas são descartados pelo `id`. Limites de requisição e falhas temporárias da API são repetidos automaticamente com espera exponencial. Não há limite artificial de quantidade.
2. **Participações.** A cada mudança de configuração, o backend recalcula quem é elegível:
   - comentários de perfis **excluídos** e (opcionalmente) do **dono da publicação** não contam;
   - **respostas** contam apenas se "Incluir respostas" estiver ativo;
   - cada regra ativa precisa ser cumprida (comentários que não cumprem são **ignorados** e contados como "ignorados");
   - **1 por comentário**: cada comentário válido é uma chance. **1 por perfil**: cada perfil com ao menos um comentário válido tem uma chance (o comentário mostrado é o primeiro válido);
   - com **ganhadores repetidos desativado**, quem já está no histórico sai do sorteio.
3. **Sorteio.** `POST /api/draw` escolhe uma participação com `crypto.randomInt(0, total)` sobre a lista elegível. O resultado é gravado no histórico **antes** de ser exibido. A animação só percorre nomes elegíveis até parar no ganhador já definido.
4. **Remover do histórico** (com confirmação) apaga o registro. Se repetição estiver desativada, a pessoa volta a concorrer. O **nº do sorteio** nunca é reutilizado, para manter a auditoria.

Detalhes das regras:
- Palavra/frase e hashtag são comparadas **sem diferenciar maiúsculas e acentos**. A hashtag precisa ser exata (`#promo` não aceita `#promocao`).
- Nas menções contam apenas **pessoas distintas**, sem o próprio autor e sem a conta da publicação.
- Se uma regra está ligada mas sem texto preenchido, a interface avisa que ela ainda não está valendo.
- Configurações inválidas (ex.: mínimo de menções 0) são **recusadas** pelo servidor, nunca ajustadas em silêncio.

Os resultados ficam guardados durante a sessão do navegador (cookie de sessão, 12 h). Recarregar a página não perde nada. Recarregar a **mesma** publicação atualiza os comentários e mantém o histórico. Carregar **outra** publicação pede confirmação e limpa o histórico.

---

## Arquitetura

```
├── backend/                  Node + Express (única dependência)
│   ├── src/
│   │   ├── server.js         inicialização
│   │   ├── app.js            rotas da API + servir o frontend compilado
│   │   ├── config.js         leitura do .env
│   │   ├── sessions.js       estado por sessão (cookie HttpOnly)
│   │   ├── instagram/
│   │   │   ├── graphClient.js  chamadas à Graph API, repetição, paginação
│   │   │   ├── auth.js         token (.env ou OAuth), renovação, status
│   │   │   ├── collector.js    localizar mídia + coletar comentários/respostas
│   │   │   └── url.js          validação do link
│   │   └── raffle/
│   │       ├── engine.js       regras, conjunto elegível, sorteio (crypto)
│   │       ├── importer.js     importação manual (linhas ou CSV)
│   │       └── exporter.js     CSV dos ganhadores
│   └── test/                 testes + Graph API falsa (dados de teste)
├── frontend/                 React + Vite (uma única página)
│   └── src/components/       Header, PostPanel, SettingsPanel, DrawStage, History, Modals
└── scripts/dev.mjs           sobe backend e frontend juntos
```

### API do backend

| Método | Rota | Descrição |
|---|---|---|
| GET | `/api/auth/status` | conta conectada, origem do token, erros |
| GET | `/api/auth/login` · `/api/auth/callback` | fluxo OAuth do Instagram |
| POST | `/api/auth/logout` | remove o token salvo pelo OAuth |
| POST | `/api/collect` `{url}` | inicia a coleta (job assíncrono; não duplica se já houver uma em andamento) |
| GET | `/api/collect/:id` | progresso da coleta (fase, comentários, respostas, páginas, erro) |
| POST | `/api/import` `{text, label}` | importação manual |
| GET | `/api/state` | publicação, estatísticas, configurações, ganhadores |
| PUT | `/api/settings` | atualiza configurações e devolve as estatísticas recalculadas |
| GET | `/api/participants?q=&status=` | lista de participantes com status e motivo de invalidação |
| POST | `/api/draw` | sorteia **um** ganhador |
| DELETE | `/api/winners/:id` | remove ganhador do histórico |
| GET | `/api/winners.csv` | exportação (UTF-8 com BOM, `;`, protegido contra fórmulas) |
| POST | `/api/reset` | limpa publicação e histórico da sessão |

### Segurança
- O token fica no `.env` ou em `backend/data/` (ignorados pelo git) e só é usado pelo servidor. Nenhuma resposta da API o inclui (há teste para isso).
- Links de paginação só são seguidos se apontarem para o mesmo host da Graph API.
- O servidor escuta em `127.0.0.1` por padrão. **Não exponha na internet sem autenticação na frente**: quem acessa a interface usa a conta conectada.
- Requisições que alteram estado exigem `Content-Type: application/json` (proteção básica contra CSRF), e o cookie de sessão é `HttpOnly; SameSite=Lax`.

---

## Demonstração local com dados de teste

Para ver a interface funcionando sem conta real, rode a Graph API falsa (500 comentários fictícios **identificados como teste**):

```bash
node backend/test/fakeGraph.js 4010 500
```

Em outro terminal:

```bash
IG_GRAPH_BASE=http://127.0.0.1:4010 IG_API_VERSION= INSTAGRAM_ACCESS_TOKEN=IGTEST_TOKEN_NAO_REAL_USADO_SOMENTE_EM_TESTES_0001 DATA_DIR=/tmp/sorteio-demo APP_URL=http://localhost:3001 npm start
```

Abra http://localhost:3001 e carregue `https://www.instagram.com/p/TESTE123abc/`. **Use isso só para testes.** Em uso real, deixe `IG_GRAPH_BASE` no padrão.

---

## Problemas comuns

| Mensagem | Causa / solução |
|---|---|
| *Nenhuma conta do Instagram conectada* | Clique em **Conectar Instagram** no topo da página |
| *O token do Instagram é inválido ou expirou* | Clique em **Conectar Instagram** e entre de novo |
| *Esta publicação não pertence à conta conectada* | Limitação da API oficial. Conecte a conta dona do post ou use "Importar lista". |
| *A conta conectada não tem permissão…* | Falta `instagram_business_manage_comments` ou a conta não é profissional |
| *Limite de requisições da API…* | A Meta limita chamadas por hora. Aguarde alguns minutos e clique em "Atualizar comentários". |
| Total coletado menor que o do post | Comentários ocultos, filtrados, excluídos ou de contas restritas não são devolvidos pela API |
