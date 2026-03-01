# Deploy no EasyPanel - Conectiva Bot

Acesse: **painel.liaautomacoes.site**

---

## Passo 1: Criar o Projeto

1. No EasyPanel, clique em **"Create Project"**
2. Nome: `conectiva-bot`
3. Clique em **Create**

---

## Passo 2: Criar o PostgreSQL

1. Dentro do projeto, clique em **"+ Service"** > **"Database"** > **"Postgres"**
2. Configure:
   - **Name:** `postgres`
   - **Image:** `postgres:16-alpine`
   - **Password:** `senha_segura_producao_2024`
   - **Database:** `conectiva_bot`
   - **User:** `bot`
3. Clique em **Create**
4. Aguarde ficar verde (running)

### Rodar o Schema (init.sql)

Após o Postgres subir, vá em **"Terminal"** do serviço postgres e rode:

```bash
psql -U bot -d conectiva_bot
```

Depois cole TODO o conteúdo do arquivo `init.sql` e pressione Enter. Ou use o seguinte comando direto:

```bash
psql -U bot -d conectiva_bot -f /tmp/init.sql
```

(Para isso, copie o init.sql para o container via a aba "Files" do EasyPanel)

---

## Passo 3: Criar o Redis

1. Clique em **"+ Service"** > **"Database"** > **"Redis"**
2. Configure:
   - **Name:** `redis`
3. Clique em **Create**

---

## Passo 4: Criar o n8n

1. Clique em **"+ Service"** > **"App"**
2. Configure:
   - **Name:** `n8n`
   - **Image:** `n8nio/n8n:latest`
   - **Port:** `5678`
3. Em **"Environment"**, adicione:
   ```
   N8N_BASIC_AUTH_ACTIVE=true
   N8N_BASIC_AUTH_USER=admin
   N8N_BASIC_AUTH_PASSWORD=SuaSenhaSegura123
   WEBHOOK_URL=https://n8n.liaautomacoes.site
   ```
4. Em **"Domains"**, adicione:
   - `n8n.liaautomacoes.site` (ou o subdomínio que preferir)
5. Clique em **Create**

### Importar Workflows no n8n

1. Acesse o n8n pelo domínio configurado
2. Para cada arquivo em `n8n-workflows/`:
   - Clique em **"..."** > **"Import from file"**
   - Selecione o arquivo JSON
   - Ative o workflow
3. **IMPORTANTE:** Configure a credencial Redis no n8n:
   - Vá em **Settings > Credentials > Add Credential > Redis**
   - Host: `redis` (nome do serviço)
   - Port: `6379`
   - Name: `Redis Local`

---

## Passo 5: Criar o Backend (App Principal)

1. Clique em **"+ Service"** > **"App"**
2. Escolha **"GitHub"** como source
3. Configure:
   - **Repository:** `seu-usuario/conectiva-bot`
   - **Branch:** `main`
   - **Name:** `backend`
   - **Port:** `3000`
   - **Dockerfile:** `./Dockerfile` (já existe no projeto)
4. Em **"Environment"**, adicione TODAS estas variáveis:

```
# MK Solutions
MK_BASE_URL=https://mk.conectivainfor.com.br
MK_USER_TOKEN=seu-token-mk
MK_PASSWORD=sua-contra-senha-mk
MK_CD_SERVICO=9999

# PostgreSQL (usar hostname interno do EasyPanel)
DATABASE_URL=postgresql://bot:SUA_SENHA_POSTGRES@conectiva-bot_postgres:5432/conectiva_bot

# Redis (usar hostname interno do EasyPanel)
REDIS_URL=redis://conectiva-bot_redis:6379

# n8n (usar hostname interno do EasyPanel)
N8N_WEBHOOK_URL=http://conectiva-bot_n8n:5678

# OpenAI
OPENAI_API_KEY=sk-sua-chave-openai-aqui

# Uazapi (WhatsApp)
UAZAPI_BASE_URL=https://liaautomacoes.uazapi.com
UAZAPI_TOKEN=seu-token-uazapi-aqui

# Servidor
PORT=3000
DASHBOARD_PORT=3001
NODE_ENV=production

# Seguranca
JWT_SECRET=gere-uma-chave-secreta-longa-aqui
JWT_EXPIRES_IN=8h

# Sessoes
SESSION_TTL_MINUTES=30

# CORS
DASHBOARD_ORIGIN=https://dashboard.liaautomacoes.site
WIDGET_ORIGIN=https://www.conectivainfor.com.br
```

5. Em **"Domains"**, adicione:
   - `api.liaautomacoes.site` (para o backend/webhook)
6. Clique em **Deploy**

---

## Passo 6: Configurar Webhook no Uazapi

No painel do Uazapi, configure o webhook da instância para apontar para:

```
https://api.liaautomacoes.site/webhook/whatsapp
```

Método: **POST**

---

## Passo 7: Deploy do Dashboard (Opcional)

O dashboard React pode ser deployado como site estático:

1. No seu PC, rode:
   ```bash
   cd dashboard
   npm run build
   ```
2. No EasyPanel, crie um novo serviço **"App"** com Nginx:
   - **Name:** `dashboard`
   - **Image:** `nginx:alpine`
   - **Port:** `80`
3. Copie o conteúdo de `dashboard/dist/` para `/usr/share/nginx/html` no container
4. Em **"Domains"**, adicione:
   - `dashboard.liaautomacoes.site`

**OU** mais simples: sirva o dashboard como estático pelo próprio backend (já funciona em produção).

---

## Passo 8: Widget no Site da Conectiva

Adicione no site da Conectiva Infor:

```html
<script src="https://api.liaautomacoes.site/widget/conectiva-chat.js"
        data-server="https://api.liaautomacoes.site"
        data-color="#2563eb"
        data-title="Conectiva Infor"
        data-greeting="Olá! Sou o assistente virtual da Conectiva Infor. Como posso ajudá-lo?"
        defer>
</script>
```

---

## Verificação Final

Após tudo subir, teste:

1. **Backend:** `https://api.liaautomacoes.site/health` → deve retornar `{"status":"ok"}`
2. **n8n:** `https://n8n.liaautomacoes.site` → painel do n8n
3. **Dashboard:** `https://dashboard.liaautomacoes.site` → painel de monitoramento
4. **WhatsApp:** Envie uma mensagem no WhatsApp da Conectiva → bot deve responder

---

## Hostnames Internos (EasyPanel)

Dentro do mesmo projeto EasyPanel, os serviços se comunicam por nome:

| Serviço | Hostname interno | Porta |
|---------|-----------------|-------|
| PostgreSQL | `postgres` | 5432 |
| Redis | `redis` | 6379 |
| n8n | `n8n` | 5678 |
| Backend | `backend` | 3000 |

---

## Troubleshooting

- **Backend não conecta no Postgres:** Verifique se o hostname é `postgres` (não `localhost`)
- **n8n não encontra Redis:** Configure a credencial Redis com host `redis`
- **Webhook não funciona:** Verifique se o domínio `api.liaautomacoes.site` está com SSL ativo
- **CORS errors no dashboard:** Verifique `DASHBOARD_ORIGIN` no .env do backend
