#!/usr/bin/env bash
# ============================================================
# backup-db.sh — Backup do PostgreSQL do Conectiva Bot
# ============================================================
#
# Uso:
#   ./scripts/backup-db.sh              → Backup completo (schema + dados)
#   ./scripts/backup-db.sh --data-only  → Apenas dados (sem schema)
#   ./scripts/backup-db.sh --schema     → Apenas schema (sem dados)
#   ./scripts/backup-db.sh --restore <arquivo>  → Restaurar backup
#   ./scripts/backup-db.sh --list       → Listar backups existentes
#
# Backups ficam em: backups/
# ============================================================

set -e

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
BOLD='\033[1m'
NC='\033[0m'

info()    { echo -e "${CYAN}ℹ${NC}  $1"; }
success() { echo -e "${GREEN}✔${NC}  $1"; }
warn()    { echo -e "${YELLOW}⚠${NC}  $1"; }
error()   { echo -e "${RED}✘${NC}  $1"; }

# Config
ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT_DIR"

CONTAINER_NAME="conectiva-postgres"
DB_USER="bot"
DB_NAME="conectiva_bot"
BACKUP_DIR="$ROOT_DIR/backups"
TIMESTAMP=$(date +%Y%m%d_%H%M%S)

# Criar diretório de backups
mkdir -p "$BACKUP_DIR"

# Verificar se o container está rodando
check_container() {
  if ! docker ps --format '{{.Names}}' | grep -q "^${CONTAINER_NAME}$"; then
    error "Container $CONTAINER_NAME não está rodando!"
    echo "  Execute: docker compose up -d postgres"
    exit 1
  fi

  if ! docker exec "$CONTAINER_NAME" pg_isready -U "$DB_USER" -d "$DB_NAME" &> /dev/null; then
    error "PostgreSQL não está pronto!"
    exit 1
  fi
}

# Backup completo (schema + dados)
backup_full() {
  local FILENAME="backup_full_${TIMESTAMP}.sql.gz"
  local FILEPATH="$BACKUP_DIR/$FILENAME"

  info "Iniciando backup completo..."
  info "Container: $CONTAINER_NAME | DB: $DB_NAME | User: $DB_USER"

  docker exec "$CONTAINER_NAME" pg_dump -U "$DB_USER" -d "$DB_NAME" \
    --no-owner --no-privileges --clean --if-exists \
    | gzip > "$FILEPATH"

  local SIZE=$(du -h "$FILEPATH" | cut -f1)
  success "Backup completo salvo: $FILEPATH ($SIZE)"
}

# Backup apenas dados
backup_data() {
  local FILENAME="backup_data_${TIMESTAMP}.sql.gz"
  local FILEPATH="$BACKUP_DIR/$FILENAME"

  info "Iniciando backup de dados..."

  docker exec "$CONTAINER_NAME" pg_dump -U "$DB_USER" -d "$DB_NAME" \
    --data-only --no-owner --no-privileges \
    | gzip > "$FILEPATH"

  local SIZE=$(du -h "$FILEPATH" | cut -f1)
  success "Backup de dados salvo: $FILEPATH ($SIZE)"
}

# Backup apenas schema
backup_schema() {
  local FILENAME="backup_schema_${TIMESTAMP}.sql"
  local FILEPATH="$BACKUP_DIR/$FILENAME"

  info "Iniciando backup de schema..."

  docker exec "$CONTAINER_NAME" pg_dump -U "$DB_USER" -d "$DB_NAME" \
    --schema-only --no-owner --no-privileges \
    > "$FILEPATH"

  local SIZE=$(du -h "$FILEPATH" | cut -f1)
  success "Backup de schema salvo: $FILEPATH ($SIZE)"
}

# Restaurar backup
restore_backup() {
  local BACKUP_FILE="$1"

  if [ -z "$BACKUP_FILE" ]; then
    error "Especifique o arquivo de backup!"
    echo "  Uso: ./scripts/backup-db.sh --restore backups/backup_full_20260301_120000.sql.gz"
    exit 1
  fi

  if [ ! -f "$BACKUP_FILE" ]; then
    error "Arquivo não encontrado: $BACKUP_FILE"
    exit 1
  fi

  warn "ATENÇÃO: Isso vai substituir todos os dados do banco!"
  read -p "  Deseja continuar? (digite 'sim' para confirmar): " CONFIRM
  if [ "$CONFIRM" != "sim" ]; then
    info "Restauração cancelada."
    exit 0
  fi

  info "Restaurando backup: $BACKUP_FILE"

  if [[ "$BACKUP_FILE" == *.gz ]]; then
    gunzip -c "$BACKUP_FILE" | docker exec -i "$CONTAINER_NAME" psql -U "$DB_USER" -d "$DB_NAME" 2>&1 | \
      tail -5
  else
    docker exec -i "$CONTAINER_NAME" psql -U "$DB_USER" -d "$DB_NAME" < "$BACKUP_FILE" 2>&1 | \
      tail -5
  fi

  success "Backup restaurado com sucesso!"

  # Verificar tabelas
  TABLE_COUNT=$(docker exec "$CONTAINER_NAME" psql -U "$DB_USER" -d "$DB_NAME" -t -c \
    "SELECT count(*) FROM information_schema.tables WHERE table_schema='public' AND table_type='BASE TABLE'" | tr -d ' ')
  info "Tabelas no banco: $TABLE_COUNT"
}

# Listar backups
list_backups() {
  echo -e "${BOLD}${CYAN}━━━ Backups existentes ━━━${NC}"
  echo ""

  if [ -z "$(ls -A "$BACKUP_DIR" 2>/dev/null)" ]; then
    warn "Nenhum backup encontrado em $BACKUP_DIR/"
    return
  fi

  echo -e "  ${BOLD}Arquivo                                    Tamanho    Data${NC}"
  echo "  ─────────────────────────────────────────────────────────────"

  for f in "$BACKUP_DIR"/*; do
    [ -f "$f" ] || continue
    local NAME=$(basename "$f")
    local SIZE=$(du -h "$f" | cut -f1)
    local DATE=$(date -r "$f" "+%Y-%m-%d %H:%M" 2>/dev/null || stat -c "%y" "$f" 2>/dev/null | cut -d'.' -f1)
    printf "  %-42s %-10s %s\n" "$NAME" "$SIZE" "$DATE"
  done

  echo ""
  local TOTAL_SIZE=$(du -sh "$BACKUP_DIR" 2>/dev/null | cut -f1)
  info "Total: $TOTAL_SIZE"
}

# Limpeza de backups antigos (manter últimos N)
cleanup_backups() {
  local KEEP=${1:-10}
  local COUNT=$(ls -1 "$BACKUP_DIR"/*.sql* 2>/dev/null | wc -l)

  if [ "$COUNT" -le "$KEEP" ]; then
    info "Apenas $COUNT backups encontrados (limite: $KEEP). Nada a limpar."
    return
  fi

  local TO_DELETE=$((COUNT - KEEP))
  info "Removendo $TO_DELETE backups antigos (mantendo últimos $KEEP)..."

  ls -1t "$BACKUP_DIR"/*.sql* | tail -"$TO_DELETE" | while read -r f; do
    rm -f "$f"
    echo "  Removido: $(basename "$f")"
  done

  success "Limpeza concluída. $KEEP backups mantidos."
}

# ── Main ─────────────────────────────────────────────────
echo -e "${BOLD}${CYAN}"
echo "╔══════════════════════════════════════════════╗"
echo "║      Conectiva Bot — Backup PostgreSQL       ║"
echo "╚══════════════════════════════════════════════╝"
echo -e "${NC}"

case "${1:-}" in
  --data-only|--data)
    check_container
    backup_data
    ;;
  --schema|--schema-only)
    check_container
    backup_schema
    ;;
  --restore)
    check_container
    restore_backup "$2"
    ;;
  --list|-l)
    list_backups
    ;;
  --cleanup)
    cleanup_backups "${2:-10}"
    ;;
  --help|-h)
    echo "Uso: ./scripts/backup-db.sh [opção]"
    echo ""
    echo "Opções:"
    echo "  (sem opção)       Backup completo (schema + dados, comprimido)"
    echo "  --data-only       Apenas dados (sem schema)"
    echo "  --schema          Apenas schema (sem dados)"
    echo "  --restore <arq>   Restaurar um backup"
    echo "  --list            Listar backups existentes"
    echo "  --cleanup [N]     Manter apenas os últimos N backups (default: 10)"
    echo "  --help            Mostrar esta ajuda"
    echo ""
    echo "Backups ficam em: backups/"
    ;;
  *)
    check_container
    backup_full
    ;;
esac
