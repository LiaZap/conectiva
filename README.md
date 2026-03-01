# Conectiva Bot

Sistema de Atendimento Inteligente 24/7 para a **Conectiva Infor** (provedor de internet).

Integra WhatsApp (Uazapi), IA (OpenAI GPT-4o), sistema de gestao MK Solutions (via n8n) e painel de monitoramento em tempo real.

---

## Arquitetura

```
                    ┌──────────────┐
 WhatsApp ──────►   │   Uazapi     │
 (clientes)         │  (WhatsApp)  │
                    └──────┬───────┘
                           │ webhook
                    ┌──────▼───────┐      ┌──────────────┐
 Site Chat ────►    │   Backend    │◄────►│   OpenAI     │
 (widget)           │  Node.js     │      │   GPT-4o     │
                    │  :3000       │      └──────────────┘
                    └──┬───┬───┬───┘
                       │   │   │
              ┌────────┘   │   └────────┐
              ▼            ▼            ▼
       ┌──────────┐ ┌──────────┐ ┌──────────┐
       │PostgreSQL│ │  Redis   │ │   n8n    │
       │  :5432   │ │  :6379   │ │  :5678   │
       └──────────┘ └──────────┘ └────┬─────┘
                                      │
                               ┌──────▼───────┐
                               │ MK Solutions  │
                               │   API REST    │
                               └──────────────┘
              ┌──────────┐
              │Dashboard │◄──── WebSocket (Socket.IO)
              │  React   │
              │  :3001   │
              └──────────┘
```

| Componente | Tecnologia | Porta |
|-----------|-----------|-------|
| Backend | Node.js + Express | 3000 |
| Dashboard | React + Vite + Tailwind | 3001 |
| PostgreSQL | postgres:16-alpine | 5432 |
| Redis | redis:7-alpine | 6379 |
| n8n | n8nio/n8n | 5678 |
| WhatsApp | Uazapi API | externo |
| Gestao ISP | MK Solutions API | externo |

---

## Pre-requisitos

- **Docker** >= 20.0 e **Docker Compose** >= 2.0
- **Node.js** >= 18 (para desenvolvimento local e dashboard)
- Conta **OpenAI** com API key (GPT-4o)
- Conta **Uazapi** com token de acesso
- Acesso a **MK Solutions** (Conectiva Infor)

---

## Instalacao Rapida

```bash
# 1. Clonar o repositorio
git clone <repo-url> conectiva-bot
cd conectiva-bot

# 2. Executar setup automatico
chmod +x scripts/setup.sh
./scripts/setup.sh

# 3. Configurar chaves no .env
nano .env
# Editar: OPENAI_API_KEY e UAZAPI_TOKEN

# 4. Reiniciar backend com novas chaves
docker compose restart backend

# 5. Iniciar dashboard (em outro terminal)
cd dashboard
npm install
npm run dev
```

O setup automatico faz: verifica Docker, copia `.env.example` para `.env`, sobe containers, aguarda health checks, verifica tabelas no banco e instala dependencias do dashboard.

---

## Instalacao Manual

### 1. Variaveis de ambiente

```bash
cp .env.example .env
```

Edite o `.env` e configure:

| Variavel | Descricao | Obrigatorio |
|---------|-----------|-------------|
| `OPENAI_API_KEY` | Chave da API OpenAI | Sim |
| `UAZAPI_BASE_URL` | URL base da Uazapi | Sim |
| `UAZAPI_TOKEN` | Token de autenticacao Uazapi | Sim |
| `DATABASE_URL` | Connection string PostgreSQL | Sim |
| `REDIS_URL` | Connection string Redis | Sim |
| `N8N_WEBHOOK_URL` | URL base dos webhooks n8n | Sim |
| `MK_BASE_URL` | URL base da API MK Solutions | Sim |
| `MK_USER_TOKEN` | Token de usuario MK | Sim |
| `MK_PASSWORD` | Contra-senha MK | Sim |

### 2. Subir containers

```bash
docker compose up -d --build
```

### 3. Verificar saude

```bash
# Status dos containers
docker compose ps

# Health check do backend
curl http://localhost:3000/health

# Testar banco
docker exec conectiva-postgres psql -U bot -d conectiva_bot -c "SELECT count(*) FROM sessions"
```

### 4. Dashboard

```bash
cd dashboard
npm install
npm run dev
# Acesse http://localhost:3001
```

---

## Configuracao do n8n

O n8n e o orquestrador que conecta o backend a API MK Solutions.

### 1. Acessar n8n

Abra `http://localhost:5678` (usuario: `admin`, senha: `admin123`).

### 2. Configurar credencial Redis

1. Va em **Settings > Credentials > Add Credential**
2. Tipo: **Redis**
3. Nome: `Redis Local`
4. Host: `redis` (nome do container Docker)
5. Port: `6379`
6. Salvar

### 3. Importar workflows

Para cada arquivo em `n8n-workflows/`:

1. Va em **Workflows > Import from File**
2. Selecione o JSON
3. Ative o workflow

**Ordem recomendada de importacao:**

| # | Arquivo | Funcao |
|---|---------|--------|
| 1 | `wf-auth.json` | Autenticacao MK (Cron 50min) |
| 2 | `wf-consulta-doc.json` | Consultar cliente por CPF |
| 3 | `wf-faturas-pendentes.json` | Faturas em aberto |
| 4 | `wf-segunda-via.json` | Gerar 2a via boleto |
| 5 | `wf-conexoes.json` | Conexoes do cliente |
| 6 | `wf-contratos.json` | Contratos do cliente |
| 7 | `wf-criar-os.json` | Criar ordem de servico |
| 8 | `wf-auto-desbloqueio.json` | Desbloquear conexao |
| 9 | `wf-novo-contrato.json` | Criar novo contrato |
| 10 | `wf-nova-lead.json` | Criar nova lead |
| 11 | `wf-faturas-avancado.json` | Faturas com filtros |

> **Importante:** Importe e ative o `wf-auth.json` primeiro. Ele renova o token MK a cada 50 minutos e armazena no Redis.

---

## Configuracao do Webhook Uazapi

No painel da Uazapi, configure o webhook para apontar para:

```
POST http://<seu-ip-publico>:3000/webhook/whatsapp
```

O payload da Uazapi sera normalizado automaticamente pelo backend.

---

## Estrutura do Projeto

```
conectiva-bot/
├── src/
│   ├── server.js                 # Servidor Express + Socket.IO
│   ├── config/
│   │   ├── env.js                # Validacao de variaveis de ambiente
│   │   └── database.js           # Pool PostgreSQL
│   ├── routes/
│   │   ├── webhook.js            # Webhooks WhatsApp e Site
│   │   ├── api.js                # APIs REST (sessions, escalations)
│   │   └── dashboard.js          # APIs de metricas
│   ├── services/
│   │   ├── session.js            # Gerenciamento de sessoes
│   │   ├── ai.js                 # OpenAI GPT-4o (classificacao + respostas)
│   │   ├── n8n.js                # Chamadas webhooks n8n
│   │   ├── whatsapp.js           # Envio via Uazapi
│   │   └── logger.js             # Gravacao de logs no PostgreSQL
│   ├── websocket/
│   │   └── events.js             # Eventos Socket.IO em tempo real
│   └── utils/
│       ├── normalizer.js         # Normalizar payloads
│       └── validators.js         # Validar CPF, CNPJ, telefone
├── dashboard/                    # Frontend React
│   ├── src/
│   │   ├── App.jsx               # Layout + Rotas
│   │   ├── pages/
│   │   │   ├── LiveMonitor.jsx   # Monitor ao vivo
│   │   │   ├── SessionDetail.jsx # Detalhe de sessao
│   │   │   ├── Metrics.jsx       # Dashboard de metricas
│   │   │   └── Escalations.jsx   # Escalonamentos
│   │   ├── components/
│   │   │   ├── ChatBubble.jsx    # Bolha de chat
│   │   │   ├── ActionLog.jsx     # Log de acoes (accordion JSON)
│   │   │   ├── StatusBadge.jsx   # Badge de status
│   │   │   └── MetricCard.jsx    # Card de metrica
│   │   ├── context/
│   │   │   └── WebSocketContext.jsx
│   │   └── services/
│   │       └── api.js            # Cliente axios
│   └── vite.config.js
├── n8n-workflows/                # JSONs para importar no n8n
│   ├── wf-auth.json
│   ├── wf-consulta-doc.json
│   └── ... (11 workflows)
├── tests/                        # Scripts de teste
│   ├── test-mk-auth.js           # Teste auth MK (API real)
│   ├── test-database.js          # Teste CRUD PostgreSQL
│   ├── test-session-flow.js      # Teste fluxo completo
│   └── test-webhook.js           # Teste webhooks + validators
├── scripts/
│   ├── setup.sh                  # Setup automatico
│   ├── logs.sh                   # Visualizar logs
│   └── backup-db.sh              # Backup PostgreSQL
├── docker-compose.yml
├── Dockerfile
├── init.sql                      # Schema PostgreSQL + seed
├── .env.example
├── package.json
└── CLAUDE.md                     # Documentacao tecnica interna
```

---

## Banco de Dados

6 tabelas PostgreSQL:

| Tabela | Descricao |
|--------|-----------|
| `sessions` | Sessoes de conversa (30min TTL) |
| `messages` | Mensagens individuais (entrada/saida) |
| `interactions_log` | Log de processamento da IA |
| `ai_actions_log` | Log granular de acoes (com JSON expandivel) |
| `escalations` | Escalonamentos para atendente humano |
| `negotiation_rules` | Regras de negociacao configuraveis |

O schema e criado automaticamente via `init.sql` quando o container PostgreSQL inicia pela primeira vez.

---

## Fluxo de Atendimento

```
1. Cliente envia mensagem (WhatsApp ou Site)
       │
2. Webhook recebe e normaliza payload
       │
3. Busca/cria sessao no PostgreSQL
       │
4. Grava mensagem + emite evento WebSocket
       │
5. Envia historico + mensagem para GPT-4o
       │
6. IA classifica intencao (SEGUNDA_VIA, FATURAS, SUPORTE, etc.)
       │
7. Se precisa CPF e nao tem → pede ao cliente
       │
8. Se tem acao MK → chama n8n → n8n chama API MK
       │
9. Formata resposta com IA baseada nos dados MK
       │
10. Envia resposta ao cliente + grava logs
       │
11. Se intencao = HUMANO → escalona para atendente
```

### Intencoes classificadas

| Intencao | Descricao | Acao MK |
|---------|-----------|---------|
| SEGUNDA_VIA | 2a via de boleto | WSMKSegundaViaCobranca |
| FATURAS | Consultar faturas | WSMKFaturasPendentes |
| NEGOCIACAO | Negociar debitos | Regras automaticas |
| SUPORTE | Problemas tecnicos | WSMKConexoesPorCliente |
| CADASTRO | Atualizar dados | WSMKConsultaDoc |
| CONTRATO | Consultar/trocar plano | WSMKContratosPorCliente |
| DESBLOQUEIO | Desbloquear conexao | WSMKAutoDesbloqueio |
| HUMANO | Falar com atendente | Escalonamento |

---

## Scripts npm

```bash
# Servidor
npm start                  # Iniciar em producao
npm run dev                # Iniciar com watch mode

# Testes
npm run test:mk-auth       # Testar autenticacao MK (API real)
npm run test:database      # Testar banco de dados
npm run test:webhook       # Testar webhooks e validacoes
npm run test:session-flow  # Testar fluxo completo (requer DB + OpenAI)
npm run test:all           # Todos os testes

# Dashboard
cd dashboard
npm run dev                # Dev server :3001
npm run build              # Build para producao
```

---

## Scripts auxiliares

```bash
# Setup completo (Docker + banco + dependencias)
./scripts/setup.sh

# Visualizar logs
./scripts/logs.sh              # Todos (follow)
./scripts/logs.sh backend      # Apenas backend
./scripts/logs.sh errors       # Apenas erros
./scripts/logs.sh status       # Health checks

# Backup do banco
./scripts/backup-db.sh                     # Backup completo
./scripts/backup-db.sh --data-only         # Apenas dados
./scripts/backup-db.sh --schema            # Apenas schema
./scripts/backup-db.sh --restore <arquivo> # Restaurar
./scripts/backup-db.sh --list              # Listar backups
./scripts/backup-db.sh --cleanup 10        # Manter ultimos 10
```

---

## APIs REST

### Webhooks

| Metodo | Endpoint | Descricao |
|--------|---------|-----------|
| POST | `/webhook/whatsapp` | Receber mensagens da Uazapi |
| POST | `/webhook/site` | Receber mensagens do chat do site |

### Sessions

| Metodo | Endpoint | Descricao |
|--------|---------|-----------|
| GET | `/api/sessions` | Listar sessoes (filtros: status, canal, limit) |
| GET | `/api/sessions/:id` | Detalhes + mensagens + acoes |
| GET | `/api/sessions/:id/actions` | Acoes da IA da sessao |
| POST | `/api/sessions/:id/takeover` | Assumir sessao (atendente humano) |

### Escalations

| Metodo | Endpoint | Descricao |
|--------|---------|-----------|
| GET | `/api/escalations` | Listar (filtros: status, prioridade) |
| POST | `/api/escalations/:id/assign` | Designar atendente |
| POST | `/api/escalations/:id/resolve` | Marcar como resolvido |

### Metricas

| Metodo | Endpoint | Descricao |
|--------|---------|-----------|
| GET | `/api/metrics/overview` | Visao geral |
| GET | `/api/metrics/by-channel` | Por canal |
| GET | `/api/metrics/by-intent` | Por intencao |
| GET | `/api/metrics/resolution-rate` | Taxa de resolucao por dia |
| GET | `/api/metrics/mk-apis` | Chamadas MK por endpoint |
| GET | `/api/metrics/performance` | Tempos medios por dia |
| GET | `/api/metrics/top-escalations` | Top motivos de escalonamento |

Todos os endpoints de metricas aceitam `?periodo=hoje|semana|mes`.

### Health Check

| Metodo | Endpoint | Descricao |
|--------|---------|-----------|
| GET | `/health` | Status do servidor + PostgreSQL + Redis |

---

## Eventos WebSocket

O dashboard recebe eventos em tempo real via Socket.IO:

| Evento | Quando |
|--------|--------|
| `nova_mensagem` | Cliente envia mensagem |
| `ia_classificou` | IA classifica intencao |
| `chamando_mk` | Chamando API MK via n8n |
| `mk_retornou` | n8n retornou dados do MK |
| `resposta_enviada` | Resposta enviada ao cliente |
| `escalonamento` | Conversa escalonada |
| `sessao_encerrada` | Sessao encerrada |

Para monitorar uma sessao especifica, use rooms:

```javascript
socket.emit('join_session', sessionId);
socket.on('ia_classificou', (data) => { ... });
```

---

## Dashboard

O painel React tem 4 telas:

1. **Monitor ao Vivo** — Lista de sessoes ativas, chat em tempo real, timeline de acoes da IA
2. **Detalhes da Sessao** — Dados do cliente, historico completo, acoes da IA com JSON expandivel
3. **Metricas** — Graficos de atendimentos, resolucao automatica, intencoes, APIs MK, performance
4. **Escalonamentos** — Fila de escalonamentos com filtros, modal de conversa, acoes de assumir/resolver

---

## Troubleshooting

### Backend nao inicia

```bash
# Ver logs do container
docker logs conectiva-backend

# Verificar variaveis de ambiente
docker exec conectiva-backend env | grep -E "DATABASE|REDIS|OPENAI"

# Testar conexao com banco de dentro do container
docker exec conectiva-backend node -e "
  import('pg').then(({default:pg}) => {
    const p = new pg.Pool({connectionString: process.env.DATABASE_URL});
    p.query('SELECT 1').then(() => console.log('OK')).catch(console.error);
  })
"
```

### Banco sem tabelas

```bash
# Executar init.sql manualmente
docker exec -i conectiva-postgres psql -U bot -d conectiva_bot < init.sql
```

### n8n nao conecta no Redis

Verifique se a credencial Redis no n8n usa:
- Host: `redis` (nao `localhost`)
- Porta: `6379`

### Webhook nao recebe mensagens

1. Verifique se a URL do webhook esta acessivel externamente
2. Para desenvolvimento local, use ngrok: `ngrok http 3000`
3. Configure a URL publica no painel da Uazapi

---

## Producao

Para deploy em producao:

1. Altere `NODE_ENV=production` no `.env`
2. Altere senhas padroes (PostgreSQL, n8n)
3. Configure HTTPS (nginx reverse proxy)
4. Configure firewall (abrir apenas 80/443)
5. Build do dashboard: `cd dashboard && npm run build`
6. Sirva o build via nginx ou adicione ao docker-compose
7. Configure backups automaticos via crontab:

```bash
# Backup diario as 2h da manha
0 2 * * * /caminho/para/conectiva-bot/scripts/backup-db.sh >> /var/log/conectiva-backup.log 2>&1

# Limpar backups antigos (manter ultimos 30)
0 3 * * 0 /caminho/para/conectiva-bot/scripts/backup-db.sh --cleanup 30
```

---

## Licenca

Projeto privado — Conectiva Infor.
