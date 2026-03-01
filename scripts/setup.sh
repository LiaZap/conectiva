#!/usr/bin/env bash
# ============================================================
# setup.sh — Instalação completa do Conectiva Bot
# ============================================================
#
# Uso:  chmod +x scripts/setup.sh && ./scripts/setup.sh
#
# O que faz:
#   1. Verifica pré-requisitos (Docker, Docker Compose, Node)
#   2. Copia .env.example → .env (se não existir)
#   3. Sobe containers com docker compose
#   4. Aguarda containers ficarem saudáveis
#   5. Verifica se init.sql foi executado (tabelas criadas)
#   6. Instala dependências do dashboard
#   7. Exibe status final
# ============================================================

set -e

# ── Cores ────────────────────────────────────────────────
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
BOLD='\033[1m'
NC='\033[0m'

# ── Funções auxiliares ───────────────────────────────────
info()    { echo -e "${CYAN}ℹ${NC}  $1"; }
success() { echo -e "${GREEN}✔${NC}  $1"; }
warn()    { echo -e "${YELLOW}⚠${NC}  $1"; }
error()   { echo -e "${RED}✘${NC}  $1"; }
step()    { echo -e "\n${BOLD}${BLUE}━━━ $1 ━━━${NC}"; }

# Diretório raiz do projeto (relativo ao script)
ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT_DIR"

echo -e "${BOLD}${CYAN}"
echo "╔══════════════════════════════════════════════╗"
echo "║      Conectiva Bot — Setup Automático        ║"
echo "╚══════════════════════════════════════════════╝"
echo -e "${NC}"

# ── 1. Verificar pré-requisitos ──────────────────────────
step "1. Verificando pré-requisitos"

# Docker
if command -v docker &> /dev/null; then
  DOCKER_VERSION=$(docker --version 2>/dev/null | head -1)
  success "Docker instalado: $DOCKER_VERSION"
else
  error "Docker não encontrado!"
  echo "  Instale em: https://docs.docker.com/get-docker/"
  exit 1
fi

# Docker Compose (v2 integrado ou standalone)
if docker compose version &> /dev/null; then
  COMPOSE_CMD="docker compose"
  COMPOSE_VERSION=$(docker compose version 2>/dev/null | head -1)
  success "Docker Compose (v2): $COMPOSE_VERSION"
elif command -v docker-compose &> /dev/null; then
  COMPOSE_CMD="docker-compose"
  COMPOSE_VERSION=$(docker-compose --version 2>/dev/null | head -1)
  success "Docker Compose (v1): $COMPOSE_VERSION"
else
  error "Docker Compose não encontrado!"
  echo "  Instale em: https://docs.docker.com/compose/install/"
  exit 1
fi

# Docker daemon rodando?
if docker info &> /dev/null; then
  success "Docker daemon está rodando"
else
  error "Docker daemon não está rodando!"
  echo "  Inicie o Docker Desktop ou execute: sudo systemctl start docker"
  exit 1
fi

# Node.js (opcional, para dev local)
if command -v node &> /dev/null; then
  NODE_VERSION=$(node --version 2>/dev/null)
  success "Node.js instalado: $NODE_VERSION"
else
  warn "Node.js não encontrado (opcional para dev local)"
fi

# ── 2. Configurar .env ──────────────────────────────────
step "2. Configurando variáveis de ambiente"

if [ -f .env ]; then
  success ".env já existe"

  # Verificar se tem valores placeholder
  if grep -q "sk-\.\.\." .env 2>/dev/null; then
    warn "OPENAI_API_KEY ainda está com valor placeholder (sk-...)"
    echo "  Edite o .env e insira sua chave real da OpenAI"
  fi
  if grep -q "seu-token-aqui" .env 2>/dev/null; then
    warn "UAZAPI_TOKEN ainda está com valor placeholder"
    echo "  Edite o .env e insira seu token real da Uazapi"
  fi
else
  info "Copiando .env.example → .env"
  cp .env.example .env
  success ".env criado a partir do .env.example"
  warn "IMPORTANTE: Edite o .env e configure:"
  echo "  - OPENAI_API_KEY  → sua chave da OpenAI"
  echo "  - UAZAPI_TOKEN    → seu token da Uazapi"
  echo ""
  read -p "  Deseja editar o .env agora? (s/N): " EDIT_ENV
  if [[ "$EDIT_ENV" =~ ^[sS]$ ]]; then
    ${EDITOR:-nano} .env
  fi
fi

# ── 3. Subir containers ─────────────────────────────────
step "3. Subindo containers Docker"

info "Executando: $COMPOSE_CMD up -d --build"
$COMPOSE_CMD up -d --build

# ── 4. Aguardar containers ficarem saudáveis ─────────────
step "4. Aguardando containers ficarem saudáveis"

MAX_WAIT=60
WAIT=0

# Aguardar PostgreSQL
info "Aguardando PostgreSQL..."
while [ $WAIT -lt $MAX_WAIT ]; do
  if docker exec conectiva-postgres pg_isready -U bot -d conectiva_bot &> /dev/null; then
    success "PostgreSQL está pronto (${WAIT}s)"
    break
  fi
  sleep 2
  WAIT=$((WAIT + 2))
  echo -ne "  Aguardando... ${WAIT}s\r"
done

if [ $WAIT -ge $MAX_WAIT ]; then
  error "PostgreSQL não ficou pronto em ${MAX_WAIT}s"
  echo "  Verifique: docker logs conectiva-postgres"
  exit 1
fi

# Aguardar Redis
WAIT=0
info "Aguardando Redis..."
while [ $WAIT -lt $MAX_WAIT ]; do
  if docker exec conectiva-redis redis-cli ping 2>/dev/null | grep -q "PONG"; then
    success "Redis está pronto (${WAIT}s)"
    break
  fi
  sleep 2
  WAIT=$((WAIT + 2))
done

if [ $WAIT -ge $MAX_WAIT ]; then
  error "Redis não ficou pronto em ${MAX_WAIT}s"
  exit 1
fi

# ── 5. Verificar se tabelas foram criadas ────────────────
step "5. Verificando banco de dados"

TABLE_COUNT=$(docker exec conectiva-postgres psql -U bot -d conectiva_bot -t -c \
  "SELECT count(*) FROM information_schema.tables WHERE table_schema='public' AND table_type='BASE TABLE'" 2>/dev/null | tr -d ' ')

if [ "$TABLE_COUNT" -ge 6 ] 2>/dev/null; then
  success "Banco de dados OK: $TABLE_COUNT tabelas encontradas"
else
  warn "init.sql pode não ter sido executado automaticamente"
  info "Executando init.sql manualmente..."

  docker exec -i conectiva-postgres psql -U bot -d conectiva_bot < init.sql 2>/dev/null && \
    success "init.sql executado com sucesso" || \
    warn "Algumas tabelas podem já existir (normal em re-execução)"

  # Verificar novamente
  TABLE_COUNT=$(docker exec conectiva-postgres psql -U bot -d conectiva_bot -t -c \
    "SELECT count(*) FROM information_schema.tables WHERE table_schema='public' AND table_type='BASE TABLE'" 2>/dev/null | tr -d ' ')
  success "Tabelas após init: $TABLE_COUNT"
fi

# Listar tabelas
info "Tabelas criadas:"
docker exec conectiva-postgres psql -U bot -d conectiva_bot -c \
  "SELECT table_name FROM information_schema.tables WHERE table_schema='public' AND table_type='BASE TABLE' ORDER BY table_name" 2>/dev/null | \
  while IFS= read -r line; do echo "  $line"; done

# Verificar seed data
RULES_COUNT=$(docker exec conectiva-postgres psql -U bot -d conectiva_bot -t -c \
  "SELECT count(*) FROM negotiation_rules WHERE ativo = true" 2>/dev/null | tr -d ' ')

if [ "$RULES_COUNT" -ge 4 ] 2>/dev/null; then
  success "Seed data OK: $RULES_COUNT regras de negociação"
else
  warn "Seed data: apenas $RULES_COUNT regras encontradas"
fi

# ── 6. Instalar dependências do dashboard ────────────────
step "6. Dashboard React"

if [ -d "dashboard" ] && command -v node &> /dev/null; then
  info "Instalando dependências do dashboard..."
  cd dashboard && npm install --silent 2>/dev/null && cd ..
  success "Dependências do dashboard instaladas"
  info "Para iniciar o dashboard: cd dashboard && npm run dev"
else
  if [ ! -d "dashboard" ]; then
    warn "Pasta dashboard/ não encontrada"
  else
    warn "Node.js não disponível — instale dependências do dashboard manualmente"
    echo "  cd dashboard && npm install"
  fi
fi

# ── 7. Status final ─────────────────────────────────────
step "7. Status dos containers"

echo ""
$COMPOSE_CMD ps
echo ""

# Health check do backend
info "Testando health check do backend..."
sleep 3

HEALTH=$(docker exec conectiva-backend wget -qO- http://localhost:3000/health 2>/dev/null || \
         curl -s http://localhost:3000/health 2>/dev/null || echo "")

if echo "$HEALTH" | grep -q "ok\|healthy"; then
  success "Backend respondendo em http://localhost:3000"
else
  warn "Backend pode ainda estar inicializando..."
  echo "  Verifique em instantes: curl http://localhost:3000/health"
fi

# ── Resumo ───────────────────────────────────────────────
echo ""
echo -e "${BOLD}${GREEN}"
echo "╔══════════════════════════════════════════════╗"
echo "║          Setup concluído!                    ║"
echo "╚══════════════════════════════════════════════╝"
echo -e "${NC}"

echo -e "  ${BOLD}Serviços:${NC}"
echo "  ├── Backend:    http://localhost:3000"
echo "  ├── Dashboard:  http://localhost:3001  (npm run dev no dashboard/)"
echo "  ├── n8n:        http://localhost:5678  (admin / admin123)"
echo "  ├── PostgreSQL: localhost:5432         (bot / senha_segura)"
echo "  └── Redis:      localhost:6379"
echo ""
echo -e "  ${BOLD}Próximos passos:${NC}"
echo "  1. Edite o .env com suas chaves reais (OPENAI_API_KEY, UAZAPI_TOKEN)"
echo "  2. Acesse o n8n em http://localhost:5678 e importe os workflows de n8n-workflows/"
echo "  3. Configure a credencial Redis no n8n (host: redis, porta: 6379)"
echo "  4. Inicie o dashboard: cd dashboard && npm run dev"
echo "  5. Rode os testes: npm run test:all"
echo ""
echo -e "  ${BOLD}Comandos úteis:${NC}"
echo "  ./scripts/logs.sh              — Ver logs dos containers"
echo "  ./scripts/backup-db.sh         — Backup do banco de dados"
echo "  docker compose restart backend — Reiniciar backend"
echo "  docker compose down            — Parar tudo"
echo ""
