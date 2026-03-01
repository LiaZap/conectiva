# Conectiva Bot - Sistema de Atendimento Inteligente 24/7

## Visão Geral
Sistema híbrido de atendimento automatizado para provedor de internet (Conectiva Infor), integrando Backend Node.js + n8n + Painel de Monitoramento Real-time.

## Arquitetura
- **Backend Node.js (Express)** → Porta 3000: Chat engine, gerencia sessões de conversa, chama IA (OpenAI), grava logs no PostgreSQL, emite eventos WebSocket
- **Painel React** → Porta 3001: Dashboard de monitoramento real-time via WebSocket (ver conversas ao vivo, timeline de ações da IA, métricas)
- **n8n** → Porta 5678: Orquestrador de integrações com a API MK Solutions (consultar clientes, gerar boletos, abrir O.S., desbloquear conexões)
- **PostgreSQL** → Porta 5432: Banco de dados (sessões, mensagens, logs de interações, ações da IA, escalonamentos)
- **Redis** → Porta 6379: Cache do token de autenticação MK
- **Evolution API** → Porta 8085: Integração WhatsApp Business

## API MK Solutions (Conectiva Infor)
Base URL: `https://mk.conectivainfor.com.br`

### Autenticação
```
GET /mk/WSAutenticacao.rule?sys=MK0&token={userToken}&password={password}&cd_servico=9999
```
- token do usuário: `a226bc3b85a80afce7ea2b15b5333aef`
- contra-senha: `3577f21691a3977`
- cd_servico: `9999` (todos os serviços)
- Retorna: `tokenRetornoAutenticacao` (usar em todas as chamadas seguintes)

### Endpoints Disponíveis (APIs Gerais - Leitura)
| Endpoint | Função | Parâmetros |
|----------|--------|------------|
| `WSMKConsultaDoc` | Consultar cliente por CPF/CNPJ | token, doc |
| `WSMKConsultaNome` | Consultar cliente por nome | token, nome |
| `WSMKFaturasPendentes` | Faturas em aberto | token, cd_cliente |
| `WSMKSegundaViaCobranca` | Gerar 2ª via boleto | token, cd_fatura |
| `WSMKConexoesPorCliente` | Conexões do cliente | token, cd_cliente |
| `WSMKContratosPorCliente` | Contratos do cliente | token, cd_cliente |
| `WSMKListaClassificacoesAte` | Classificações de atendimento | token |
| `WSMKListaProcessos` | Processos de atendimentos | token |
| `WSMKConsultaBarras` | Fatura por código de barras | token, barras |
| `WSMKLDViaSMS` | Linha digitável via SMS | token, cd_fatura |
| `WSMKConsultaClientes` | Listar clientes com filtros | token, filtros |
| `WSMKListaEstruturaEnderecos` | Estrutura de endereços | token |
| `WSMKUserSenhaSAC` | Validar user/senha SAC | token, user_sac, pass_sac |

### Endpoints Disponíveis (APIs Especiais - Escrita)
| Endpoint | Função | Parâmetros principais |
|----------|--------|----------------------|
| `WSMKNovaLead` | Criar lead/atendimento | token, cd_cliente, info |
| `WSMKNovoContrato` | Criar novo contrato | token, CodigoCliente, CodigoTipoPlano, CodigoPlanoAcesso, CodigoRegraVencimento, CodigoSLA, CodigoRegraBloqueio, CodigoFormaPagamento, CodigoProfilePagamento, CodigoMetodoFaturamento, CodigoPlanoContas |
| `WSMKCriarOrdemServico` | Abrir O.S. | token, CodigoCliente, DescricaoProblema, CodigoTipoOS, CodigoTecnico, CodigoGrupoServico, categoria (1=cliente, 2=provedor) |
| `WSMKAutoDesbloqueio` | Desbloquear conexão | token, cd_conexao, diasexcecao |
| `WSMKFaturas` | Faturas com filtros avançados | token, codigo_cliente, liquidado, data_vencimento, codigo_contrato, quantidade_meses |

### Padrão de URL de todos os endpoints
```
GET https://mk.conectivainfor.com.br/mk/{ENDPOINT}.rule?sys=MK0&token={tokenRetornoAutenticacao}&{parametros}
```

### Fluxo de cadeia de chamadas
1. Autenticar → obter tokenRetornoAutenticacao
2. ConsultaDoc (CPF) → obter cd_cliente
3. Com cd_cliente → consultar Faturas, Conexões, Contratos, etc.
4. Com cd_fatura → gerar Segunda Via, enviar SMS
5. Com cd_conexao → Auto-desbloqueio

## Estrutura do Projeto
```
conectiva-bot/
├── src/
│   ├── server.js                 # Express + WebSocket server
│   ├── config/
│   │   ├── env.js                # Variáveis de ambiente
│   │   └── database.js           # Conexão PostgreSQL (pg pool)
│   ├── routes/
│   │   ├── webhook.js            # POST /webhook/whatsapp, /webhook/site
│   │   ├── api.js                # APIs REST para o Painel
│   │   └── dashboard.js          # APIs de métricas
│   ├── services/
│   │   ├── session.js            # Gerenciamento de sessões
│   │   ├── ai.js                 # Chamadas OpenAI (classificação + respostas)
│   │   ├── n8n.js                # Chamadas webhooks do n8n
│   │   ├── whatsapp.js           # Enviar msgs via Evolution API
│   │   └── logger.js             # Gravar logs no PostgreSQL
│   ├── websocket/
│   │   └── events.js             # Emitir eventos real-time
│   └── utils/
│       ├── normalizer.js         # Normalizar msgs de canais diferentes
│       └── validators.js         # Validar CPF, telefone
├── dashboard/                    # Frontend React do Painel
│   ├── src/
│   │   ├── App.jsx
│   │   ├── pages/
│   │   │   ├── LiveMonitor.jsx   # Conversas ao vivo
│   │   │   ├── SessionDetail.jsx # Detalhe de uma conversa
│   │   │   ├── Metrics.jsx       # Dashboard métricas
│   │   │   └── Escalations.jsx   # Escalonamentos pendentes
│   │   └── components/
│   │       ├── ChatBubble.jsx
│   │       ├── ActionLog.jsx
│   │       ├── StatusBadge.jsx
│   │       └── MetricCard.jsx
├── n8n-workflows/                # JSONs exportados dos workflows n8n
├── docker-compose.yml
├── init.sql                      # Schema do banco
├── .env.example
├── package.json
└── CLAUDE.md
```

## Banco de Dados (PostgreSQL)

### Tabelas
1. **sessions** - Cada conversa é uma sessão (id UUID, canal, telefone, nome_cliente, cpf_cnpj, cd_cliente_mk, status, intencao_principal, total_mensagens, resolvida_por, timestamps)
2. **messages** - Cada mensagem individual (session_id FK, direcao entrada/saida, conteudo, canal)
3. **interactions_log** - Log detalhado do processamento da IA (session_id, intencao, confianca, mensagem_cliente, resposta_ia, acao_mk, mk_endpoint, mk_sucesso, mk_resposta JSONB, status, tempos, os_criada, boleto_gerado, desbloqueio_executado, contrato_criado)
4. **ai_actions_log** - Log granular de cada ação da IA (session_id, interaction_id, acao, descricao, status, dados_entrada JSONB, dados_saida JSONB, tempo_ms)
5. **escalations** - Escalonamentos para humano (session_id, motivo, prioridade, historico_conversa JSONB, dados_cliente JSONB, os_mk, atendente_designado, status)
6. **negotiation_rules** - Regras de negociação configuráveis (dias_atraso_min/max, desconto_max_percent, parcelas_max, acao)

### Sessão ativa
Uma sessão fica ativa por 30 minutos sem interação, depois é marcada como expirada.

## Classificação de Intenções (IA)
A IA classifica cada mensagem em uma dessas intenções:
- **SEGUNDA_VIA** → Quer boleto, segunda via, linha digitável
- **FATURAS** → Consultar faturas, quanto deve
- **NEGOCIACAO** → Negociar débito, parcelar
- **SUPORTE** → Internet lenta, sem internet, problemas técnicos
- **CADASTRO** → Atualizar dados, mudar endereço
- **CONTRATO** → Consultar plano, trocar plano
- **DESBLOQUEIO** → Desbloquear conexão, cortaram a internet
- **HUMANO** → Falar com atendente, assunto complexo, confiança < 0.7

## Eventos WebSocket (Backend → Painel)
| Evento | Quando |
|--------|--------|
| `nova_mensagem` | Cliente envia mensagem |
| `ia_classificou` | IA classifica intenção |
| `chamando_mk` | Backend vai chamar API MK via n8n |
| `mk_retornou` | n8n retornou dados do MK |
| `resposta_enviada` | Resposta enviada ao cliente |
| `escalonamento` | Conversa escalonada para humano |
| `sessao_encerrada` | Sessão encerrada |

## Integração Backend → n8n
O backend chama o n8n via HTTP POST nos webhooks:
```javascript
const ACTIONS = {
  CONSULTAR_CLIENTE:    '/webhook/mk-consulta-doc',
  FATURAS_PENDENTES:    '/webhook/mk-faturas-pendentes',
  SEGUNDA_VIA:          '/webhook/mk-segunda-via',
  CONEXOES_CLIENTE:     '/webhook/mk-conexoes',
  CONTRATOS_CLIENTE:    '/webhook/mk-contratos',
  CRIAR_OS:             '/webhook/mk-criar-os',
  AUTO_DESBLOQUEIO:     '/webhook/mk-auto-desbloqueio',
  NOVO_CONTRATO:        '/webhook/mk-novo-contrato',
  NOVA_LEAD:            '/webhook/mk-nova-lead',
  FATURAS_AVANCADO:     '/webhook/mk-faturas-avancado',
};
```

## Variáveis de Ambiente (.env)
```
# MK Solutions
MK_BASE_URL=https://mk.conectivainfor.com.br
MK_USER_TOKEN=a226bc3b85a80afce7ea2b15b5333aef
MK_PASSWORD=3577f21691a3977
MK_CD_SERVICO=9999

# PostgreSQL
DATABASE_URL=postgresql://bot:senha_segura@postgres:5432/conectiva_bot

# Redis
REDIS_URL=redis://redis:6379

# n8n
N8N_WEBHOOK_URL=http://n8n:5678

# OpenAI
OPENAI_API_KEY=sk-...

# Evolution API (WhatsApp)
EVOLUTION_API_URL=http://evolution-api:8085
EVOLUTION_API_KEY=sua-chave

# Servidor
PORT=3000
DASHBOARD_PORT=3001
NODE_ENV=production
```

## Regras de Desenvolvimento
- Use ESM (import/export) no backend Node.js
- Use pg (node-postgres) com pool para PostgreSQL
- Use ioredis para Redis
- Use socket.io para WebSocket
- Use express para HTTP
- Use openai SDK para chamadas à IA
- Use axios para chamadas HTTP ao n8n e Evolution API
- No frontend React, use Vite + Tailwind CSS + Recharts para gráficos + socket.io-client para WebSocket
- Sempre gravar logs ANTES de responder ao cliente
- Sempre emitir eventos WebSocket em cada etapa do processamento
- Tratar erros gracefully - nunca deixar o cliente sem resposta
- Se a API MK falhar, informar ao cliente e escalonar
