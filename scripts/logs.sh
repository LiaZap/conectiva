#!/usr/bin/env bash
# ============================================================
# logs.sh — Visualizar logs dos containers do Conectiva Bot
# ============================================================
#
# Uso:
#   ./scripts/logs.sh              → Todos os containers (follow)
#   ./scripts/logs.sh backend      → Apenas backend
#   ./scripts/logs.sh postgres     → Apenas PostgreSQL
#   ./scripts/logs.sh n8n          → Apenas n8n
#   ./scripts/logs.sh redis        → Apenas Redis
#   ./scripts/logs.sh all          → Todos (snapshot, sem follow)
#   ./scripts/logs.sh errors       → Apenas linhas com erro
# ============================================================

set -e

RED='\033[0;31m'
GREEN='\033[0;32m'
CYAN='\033[0;36m'
BOLD='\033[1m'
NC='\033[0m'

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT_DIR"

# Detectar Docker Compose
if docker compose version &> /dev/null; then
  COMPOSE_CMD="docker compose"
elif command -v docker-compose &> /dev/null; then
  COMPOSE_CMD="docker-compose"
else
  echo -e "${RED}✘ Docker Compose não encontrado${NC}"
  exit 1
fi

SERVICE="${1:-}"

show_help() {
  echo -e "${BOLD}${CYAN}Conectiva Bot — Visualizador de Logs${NC}"
  echo ""
  echo "Uso: ./scripts/logs.sh [serviço|comando]"
  echo ""
  echo "Serviços:"
  echo "  backend     Logs do backend Node.js"
  echo "  postgres    Logs do PostgreSQL"
  echo "  n8n         Logs do n8n"
  echo "  redis       Logs do Redis"
  echo ""
  echo "Comandos:"
  echo "  all         Snapshot de todos os logs (sem follow)"
  echo "  errors      Filtra apenas linhas com erro"
  echo "  status      Mostra status dos containers"
  echo "  help        Mostra esta ajuda"
  echo ""
  echo "Sem argumentos: segue todos os logs em tempo real (Ctrl+C para sair)"
}

case "$SERVICE" in
  backend)
    echo -e "${BOLD}${CYAN}━━━ Logs: Backend ━━━${NC}"
    $COMPOSE_CMD logs -f --tail=100 backend
    ;;
  postgres)
    echo -e "${BOLD}${CYAN}━━━ Logs: PostgreSQL ━━━${NC}"
    $COMPOSE_CMD logs -f --tail=100 postgres
    ;;
  n8n)
    echo -e "${BOLD}${CYAN}━━━ Logs: n8n ━━━${NC}"
    $COMPOSE_CMD logs -f --tail=100 n8n
    ;;
  redis)
    echo -e "${BOLD}${CYAN}━━━ Logs: Redis ━━━${NC}"
    $COMPOSE_CMD logs -f --tail=100 redis
    ;;
  all)
    echo -e "${BOLD}${CYAN}━━━ Snapshot: Todos os Logs (últimas 50 linhas cada) ━━━${NC}"
    echo ""
    for svc in backend postgres n8n redis; do
      echo -e "${BOLD}── $svc ──${NC}"
      $COMPOSE_CMD logs --tail=50 "$svc" 2>/dev/null || echo "  (container não encontrado)"
      echo ""
    done
    ;;
  errors)
    echo -e "${BOLD}${RED}━━━ Filtrando erros em todos os containers ━━━${NC}"
    echo ""
    $COMPOSE_CMD logs --tail=500 2>/dev/null | grep -iE "error|err|fail|fatal|exception|panic|crash|ECONNREFUSED|ENOTFOUND|timeout" --color=always || \
      echo -e "${GREEN}✔ Nenhum erro encontrado nas últimas 500 linhas${NC}"
    ;;
  status)
    echo -e "${BOLD}${CYAN}━━━ Status dos Containers ━━━${NC}"
    echo ""
    $COMPOSE_CMD ps
    echo ""

    # Health checks individuais
    echo -e "${BOLD}Health checks:${NC}"

    # PostgreSQL
    if docker exec conectiva-postgres pg_isready -U bot -d conectiva_bot &> /dev/null; then
      echo -e "  ${GREEN}✔${NC} PostgreSQL: healthy"
    else
      echo -e "  ${RED}✘${NC} PostgreSQL: unhealthy"
    fi

    # Redis
    if docker exec conectiva-redis redis-cli ping 2>/dev/null | grep -q "PONG"; then
      echo -e "  ${GREEN}✔${NC} Redis: healthy"
    else
      echo -e "  ${RED}✘${NC} Redis: unhealthy"
    fi

    # Backend
    HEALTH=$(curl -s --max-time 5 http://localhost:3000/health 2>/dev/null || echo "")
    if echo "$HEALTH" | grep -q "ok\|healthy"; then
      echo -e "  ${GREEN}✔${NC} Backend: healthy"
    else
      echo -e "  ${RED}✘${NC} Backend: unhealthy ou não respondendo"
    fi

    # n8n
    N8N_HEALTH=$(curl -s --max-time 5 http://localhost:5678/healthz 2>/dev/null || echo "")
    if [ -n "$N8N_HEALTH" ]; then
      echo -e "  ${GREEN}✔${NC} n8n: respondendo"
    else
      echo -e "  ${RED}✘${NC} n8n: não respondendo"
    fi

    echo ""
    ;;
  help|-h|--help)
    show_help
    ;;
  "")
    echo -e "${BOLD}${CYAN}━━━ Logs: Todos os containers (Ctrl+C para sair) ━━━${NC}"
    $COMPOSE_CMD logs -f --tail=50
    ;;
  *)
    echo -e "${RED}Serviço desconhecido: $SERVICE${NC}"
    echo ""
    show_help
    exit 1
    ;;
esac
