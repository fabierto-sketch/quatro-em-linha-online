# Quatro em Linha Online 🔴🟡

> Um jogo clássico com uma experiência visual moderna e realista.
> **Portugal 🇵🇹 · Brasil 🇧🇷 · Juntos à distância ❤️**

Quatro em Linha multiplayer em tempo real, com mesas privadas criadas apenas pelo administrador, videochamada, chat privado, tabuleiro 3D com animações físicas e modo noite romântica.

---

## Índice

1. [Funcionalidades](#funcionalidades)
2. [Estrutura do projeto](#estrutura-do-projeto)
3. [Executar no computador](#executar-no-computador)
4. [Publicar no GitHub](#publicar-no-github)
5. [Publicar no Render](#publicar-no-render)
6. [Configurar a videochamada (TURN)](#configurar-a-videochamada-turn)
7. [Como usar](#como-usar)
8. [Variáveis de ambiente](#variáveis-de-ambiente)
9. [Segurança](#segurança)
10. [Testes](#testes)
11. [Limitações conhecidas](#limitações-conhecidas)

---

## Funcionalidades

**Jogo**
- Tabuleiro 7 × 6 (42 espaços) com profundidade, perspetiva inclinada, moldura dourada, base de madeira, sombras e reflexos.
- Peças com aspeto de vidro / plástico polido, anel moldado e reflexo de luz.
- Queda física de cada peça com ressalto ao chegar ao fundo, brilho na coluna e onda de impacto.
- Destaque animado das quatro (ou mais) peças vencedoras; as restantes escurecem.
- Regras oficiais validadas **no servidor**: turnos alternados, uma peça por turno, queda até à posição livre mais baixa, vitória horizontal / vertical / diagonal, empate com 42 peças, colunas cheias recusadas, jogadas simultâneas e duplicadas bloqueadas.
- Quem começa alterna a cada partida. Placar de vitórias e empates por mesa.
- Revanche ou reinício por acordo dos dois jogadores.
- Jogar com rato, toque ou teclado (setas + Enter, ou teclas 1–7).

**Durante a partida**
- Nomes, cores, indicador de turno, número de jogadas, cronómetro, estado da ligação (com latência), histórico das últimas jogadas, botões de abandonar e pedir revanche.
- Avisos quando o adversário entra, sai, perde a ligação ou volta.
- Animação de vitória com confetes, mensagem personalizada e som.

**Comunicação**
- Videochamada WebRTC com áudio bidirecional, ligar/desligar microfone e câmara, desligar chamada, ecrã inteiro, adaptada a computador e telemóvel.
- Chat privado em tempo real com emojis e indicador "a escrever…".

**Multiplayer**
- Socket.IO, sincronização total do estado, reconexão automática (o lugar fica reservado), recuperação do chat e do tabuleiro ao recarregar a página.
- Máximo de 2 jogadores por mesa — terceiros são recusados.

**Ambiente**
- Fundo azul-marinho, dourado e madeira; tipografia Playfair Display + Outfit; ícones SVG próprios.
- Efeitos sonoros e música ambiente (opcionais), volume ajustável.
- **Modo noite romântica**: céu estrelado, corações a flutuar e a faixa «Portugal 🇵🇹 ❤️ 🇧🇷 Brasil».
- Interface adaptável a computador, tablet e telemóvel.

**Administração**
- Área protegida por palavra-passe (variável `ADMIN_PASSWORD`).
- Criar várias mesas privadas (código aleatório de 6 caracteres + link de convite exclusivo + botão «Copiar convite»).
- Ver mesas, jogadores ligados, estado das partidas e atividade do servidor.
- Reiniciar partidas, terminar sessões dos jogadores, eliminar mesas, terminar todas as sessões de administrador.

---

## Estrutura do projeto

```
quatro-em-linha-online/
│
├── public/                  # Tudo o que o navegador descarrega
│   ├── index.html           # Entrada na mesa + ecrã de jogo
│   ├── style.css            # Design, tabuleiro 3D, animações, responsivo
│   ├── app.js               # Ligação ao servidor, chat, videochamada, interface
│   ├── game.js              # Desenho do tabuleiro, som, música, confetes
│   ├── admin.html           # Painel de administração (/admin)
│   ├── admin.css
│   ├── admin-panel.js
│   ├── favicon.svg
│   └── sounds/              # Efeitos sonoros (.wav)
│
├── server/
│   ├── rooms.js             # Mesas, lugares, jogadas, chat, reconexão
│   ├── game-engine.js       # Regras oficiais (fonte única da verdade)
│   ├── admin.js             # Login e API de administração
│   ├── webrtc.js            # Sinalização da videochamada + servidores ICE
│   ├── security.js          # Cabeçalhos, limitação de pedidos, sanitização
│   ├── logger.js            # Registos (consola + painel)
│   └── env.js               # Lê o ficheiro .env em desenvolvimento
│
├── test/run-tests.js        # Testes automáticos (motor + servidor real)
├── server.js                # Arranque: Express + Socket.IO
├── package.json
├── render.yaml              # Blueprint opcional do Render
├── env.example
└── README.md
```

---

## Executar no computador

Requisitos: [Node.js](https://nodejs.org) 18.18 ou superior (recomendado 20 ou 22).

```bash
# 1. Instalar dependências
npm install

# 2. Criar o ficheiro de configuração
cp env.example .env          # no Windows: copy env.example .env
# Edite .env e defina ADMIN_PASSWORD

# 3. Arrancar
npm start
```

Abra:
- Jogo: <http://localhost:3000>
- Administração: <http://localhost:3000/admin>

> 💡 Para testar sozinho, abra o convite numa janela normal e noutra em modo anónimo (ou noutro navegador).
> A câmara funciona em `localhost`; noutros endereços o navegador exige **HTTPS** (o Render já o fornece).

---

## Publicar no GitHub

1. Crie uma conta em <https://github.com> (se ainda não tiver).
2. Clique em **New repository**:
   - Nome: `quatro-em-linha-online`
   - Visibilidade: **Private** (recomendado)
   - **Não** marque "Add a README" (o projeto já tem um).
   - Clique **Create repository**.
3. No computador, dentro da pasta do projeto:

```bash
git init
git add .
git commit -m "Quatro em Linha Online — primeira versão"
git branch -M main
git remote add origin https://github.com/O-SEU-UTILIZADOR/quatro-em-linha-online.git
git push -u origin main
```

> O ficheiro `.gitignore` já impede o envio de `node_modules/` e do `.env` (onde está a palavra-passe).
> **Nunca** coloque a palavra-passe no código nem no GitHub.

**Alternativa sem linha de comandos:** na página do repositório vazio, clique em *uploading an existing file* e arraste todos os ficheiros e pastas (exceto `node_modules` e `.env`).

---

## Publicar no Render

1. Crie uma conta em <https://render.com> e ligue a sua conta GitHub.
2. **New → Web Service** e escolha o repositório `quatro-em-linha-online`.
3. Preencha:

| Campo | Valor |
|---|---|
| Name | `quatro-em-linha-online` |
| Region | Frankfurt (EU) — mais próximo de Portugal; Ohio/Virginia ficam a meio caminho para o Brasil |
| Branch | `main` |
| Runtime | **Node** |
| Build Command | `npm install` |
| Start Command | `npm start` |
| Instance Type | Free (ou Starter para não adormecer) |

4. Em **Environment → Add Environment Variable**:

| Chave | Valor |
|---|---|
| `ADMIN_PASSWORD` | a sua palavra-passe forte (mín. 6 caracteres; recomendado 12+) |
| `NODE_ENV` | `production` |
| `FORCE_HTTPS` | `true` |
| `TURN_URLS`, `TURN_USERNAME`, `TURN_CREDENTIAL` | opcionais — ver secção seguinte |

> ⚠️ **Não** defina `PORT` — o Render define-a automaticamente e o servidor usa `process.env.PORT`.

5. Em **Advanced → Health Check Path** escreva `/healthz`.
6. Clique **Create Web Service**. Em 1–3 minutos o jogo fica disponível em
   `https://quatro-em-linha-online.onrender.com` (o nome exato aparece no topo da página do serviço).
7. Cada `git push` para `main` publica automaticamente uma nova versão.

**Alternativa (Blueprint):** *New → Blueprint*, escolha o repositório; o `render.yaml` cria o serviço e pede o `ADMIN_PASSWORD`.

**Ver registos:** separador **Logs** do serviço (entradas, vitórias, erros, tentativas de login falhadas). O painel `/admin` mostra os mesmos eventos.

---

## Configurar a videochamada (TURN)

A videochamada liga os dois navegadores diretamente (WebRTC). Para descobrir o caminho entre eles, o jogo já usa servidores **STUN** públicos gratuitos — chega na maioria das redes domésticas (Wi-Fi/fibra).

Em **redes móveis (4G/5G)**, redes de empresas/universidades ou routers restritivos, a ligação direta pode falhar. Nesses casos é necessário um servidor **TURN**, que reencaminha o vídeo. Recomendado para a ligação Portugal ↔ Brasil.

1. Crie uma conta num fornecedor de TURN (por exemplo Metered, Twilio, Xirsys ou Cloudflare). Vários têm planos gratuitos com alguns GB por mês — suficiente para videochamadas entre duas pessoas.
2. Copie os endereços e credenciais fornecidos para as variáveis do Render:

```
TURN_URLS=turn:SERVIDOR:80,turn:SERVIDOR:443,turns:SERVIDOR:443?transport=tcp
TURN_USERNAME=o-seu-utilizador
TURN_CREDENTIAL=a-sua-credencial
```

3. Guarde (o Render reinicia o serviço). O painel `/admin` deixa de mostrar o aviso sobre TURN.

**Requisitos no navegador:** HTTPS (automático no Render) e autorização para câmara e microfone. No iPhone/iPad use Safari ou Chrome atualizados.

---

## Como usar

1. Entre em `https://o-seu-jogo.onrender.com/admin` e introduza a palavra-passe.
2. Clique **Criar nova mesa** (pode dar-lhe um nome, ex.: "Domingo à noite").
3. Clique **Copiar convite** e envie a mensagem ao outro jogador (WhatsApp, e-mail…). Clique **Entrar na mesa** para se sentar.
4. O convidado abre o link (ou escreve o código em `https://o-seu-jogo.onrender.com`), escolhe o nome e a cor disponível e senta-se — sem registo.
5. Joguem! Cliquem em **Ligar** para iniciar a videochamada; o outro jogador clica **Atender**.
6. No fim, **Jogar novamente** (a revanche começa quando os dois aceitam).

As mesas ficam disponíveis enquanto o servidor estiver ativo; pode reutilizar a mesma mesa noutros dias.
Em ⚙️ **Definições**: efeitos sonoros, música ambiente, volume e **modo noite romântica**.

---

## Variáveis de ambiente

| Variável | Obrigatória | Por omissão | Descrição |
|---|---|---|---|
| `ADMIN_PASSWORD` | **sim** | — | Palavra-passe do administrador (mín. 6 caracteres). Sem ela, a administração fica desativada. |
| `PORT` | não | `3000` | Porta (o Render define-a automaticamente). |
| `PUBLIC_URL` | não | detetado | Endereço público usado nos links de convite. |
| `FORCE_HTTPS` | não | `false` | Redireciona HTTP → HTTPS. Use `true` no Render. |
| `TURN_URLS` | não | — | Servidores TURN separados por vírgulas. |
| `TURN_USERNAME` / `TURN_CREDENTIAL` | não | — | Credenciais do TURN. |
| `STUN_URLS` | não | Google + Cloudflare | Substitui os servidores STUN. |
| `ADMIN_SESSION_HOURS` | não | `12` | Validade da sessão de administrador. |
| `SEAT_TIMEOUT_MINUTES` | não | `60` | Tempo que o lugar fica reservado a um jogador desligado. |
| `ROOM_TTL_HOURS` | não | `168` | Mesas sem atividade são apagadas ao fim deste tempo (7 dias). |
| `MAX_ROOMS` | não | `200` | Limite de mesas em simultâneo. |
| `TRUST_PROXY` | não | `1` | Número de proxies à frente do servidor (Render = 1). |

---

## Segurança

- **Só o administrador cria mesas.** Não existe nenhuma rota pública nem evento Socket.IO para criar mesas; `/api/admin/*` responde `401` sem sessão válida e `/api/rooms` responde `403`.
- A palavra-passe existe **apenas** na variável de ambiente e é comparada em tempo constante. Nunca é enviada ao navegador nem aparece no JavaScript público (verificado pelos testes).
- Sessão de administrador em cookie `HttpOnly`, `SameSite=Strict` e `Secure` (em HTTPS), guardada no servidor, com expiração. Pedidos que alteram dados exigem um cabeçalho próprio (proteção CSRF).
- Limite de tentativas de login (8 por 15 minutos por IP) e limitação geral de pedidos HTTP e de eventos por ligação.
- Cada jogador recebe um token secreto aleatório que identifica o seu lugar; abrir a mesa noutra janela substitui a sessão anterior.
- O servidor decide tudo: cor, linha, turno, vencedor. Jogadas fora de vez, repetidas, em colunas cheias ou inválidas são recusadas — manipular o navegador não altera o tabuleiro.
- Validação dos códigos de mesa, limite de 2 jogadores, limpeza de texto (nomes e chat) e apresentação sempre como texto (sem HTML) para evitar XSS.
- Cabeçalhos de segurança: Content-Security-Policy, X-Frame-Options, nosniff, Referrer-Policy, Permissions-Policy, HSTS em HTTPS.
- A sinalização da videochamada só é reencaminhada entre os dois jogadores sentados na mesma mesa.

---

## Testes

```bash
npm install
npm test
```

São 30 testes automáticos que arrancam o servidor real e cobrem:

| Critério | Coberto |
|---|---|
| Criação de sala pelo administrador | ✅ |
| Impossibilidade de criação de sala pelos convidados | ✅ (API admin sem sessão, cookie falso, rotas públicas, eventos socket) |
| Entrada através de código e de convite | ✅ |
| Limite de dois jogadores | ✅ (incluindo enquanto um jogador está desligado) |
| Alternância correta de jogadas | ✅ (e alternância de quem começa) |
| Queda correta das peças | ✅ |
| Vitórias horizontais, verticais e diagonais (↗ e ↘) | ✅ (motor e pela rede) |
| Empates (42 peças) | ✅ |
| Reinício de partidas por acordo | ✅ (pedido, recusa e aceitação) |
| Chat | ✅ (tempo real, limites, texto seguro) |
| Videochamada | ✅ sinalização (oferta, resposta, ICE, estado do microfone/câmara, desligar) |
| Reconexão | ✅ (lugar, tabuleiro e chat recuperados; religação automática do cliente) |
| Jogadas duplicadas/simultâneas e manipulação | ✅ |
| Compatibilidade com Render | ✅ `process.env.PORT`, `npm start`, `/healthz`, proxy confiável |

Durante o desenvolvimento, o jogo foi também testado num navegador real (Chromium) com câmara e microfone simulados. Os dois jogadores fizeram uma partida completa, trocaram mensagens no chat e estabeleceram uma videochamada (vídeo 640 px a chegar aos dois lados). Testou-se ainda a revanche, o recarregamento da página com regresso automático ao lugar, a recusa de um terceiro jogador e os ecrãs de telemóvel e tablet.

---

## Limitações conhecidas

- **Memória:** as mesas e partidas são guardadas na memória do servidor. Se o serviço reiniciar (nova publicação, manutenção, ou o plano gratuito adormecer), as mesas são apagadas — basta criar uma nova no painel. Para mesas permanentes seria necessário juntar uma base de dados (ex.: Redis ou PostgreSQL).
- **Plano gratuito do Render:** o serviço adormece após algum tempo sem visitas; a primeira visita seguinte pode demorar cerca de um minuto a acordar. Um plano pago mantém o jogo sempre ativo.
- **Uma instância:** o projeto foi feito para uma única instância (o normal para duas pessoas). Para várias instâncias seria preciso um adaptador Socket.IO partilhado.
- **Videochamada em redes muito restritivas:** precisa de TURN (ver acima).

---

Feito com ❤️ para jogar frente a frente, mesmo com um oceano pelo meio.
