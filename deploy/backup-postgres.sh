#!/usr/bin/env bash
# ============================================================
#  Fait Maison API — Sauvegarde PostgreSQL
#  Usage   : bash deploy/backup-postgres.sh
#  Cron    : 0 2 * * * /var/www/fait-maison-backend/deploy/backup-postgres.sh >> /var/log/fait-maison-backup.log 2>&1
#
#  Fonctionnement :
#   • Docker Compose → pg_dump via le conteneur postgres
#   • PM2 / bare metal → pg_dump direct (postgres doit être installé sur l'hôte)
#   • Compresse le dump en .gz
#   • Garde les 7 dernières sauvegardes (purge automatique)
# ============================================================
set -euo pipefail

APP_DIR="/var/www/fait-maison-backend"
BACKUP_DIR="${APP_DIR}/backups"
TIMESTAMP=$(date +"%Y%m%d_%H%M%S")
BACKUP_FILE="${BACKUP_DIR}/fait_maison_${TIMESTAMP}.sql.gz"
KEEP_DAYS=7

# Charger les variables d'environnement depuis .env
if [ -f "${APP_DIR}/.env" ]; then
    set -o allexport
    # shellcheck disable=SC1090
    source <(grep -E '^(DB_|PGPASSWORD)' "${APP_DIR}/.env" | sed 's/ *= */=/')
    set +o allexport
fi

DB_NAME="${DB_NAME:-fait_maison}"
DB_USER="${DB_USER:-faitmaison_user}"
DB_HOST="${DB_HOST:-127.0.0.1}"
DB_PORT="${DB_PORT:-5432}"

mkdir -p "${BACKUP_DIR}"

echo "[backup] $(date '+%Y-%m-%d %H:%M:%S') — Début sauvegarde de '${DB_NAME}'"

# Détecter le mode (Docker ou bare metal)
if docker compose -f "${APP_DIR}/docker-compose.prod.yml" ps postgres 2>/dev/null | grep -q "Up"; then
    echo "[backup] Mode : Docker Compose"
    docker compose -f "${APP_DIR}/docker-compose.prod.yml" exec -T postgres \
        pg_dump -U "${DB_USER}" "${DB_NAME}" \
        | gzip > "${BACKUP_FILE}"
else
    echo "[backup] Mode : bare metal (pg_dump direct)"
    PGPASSWORD="${DB_PASSWORD:-}" pg_dump \
        -h "${DB_HOST}" \
        -p "${DB_PORT}" \
        -U "${DB_USER}" \
        "${DB_NAME}" \
        | gzip > "${BACKUP_FILE}"
fi

SIZE=$(du -sh "${BACKUP_FILE}" | cut -f1)
echo "[backup] Sauvegarde créée : ${BACKUP_FILE} (${SIZE})"

# Purger les sauvegardes de plus de KEEP_DAYS jours
find "${BACKUP_DIR}" -name "fait_maison_*.sql.gz" -mtime "+${KEEP_DAYS}" -delete
REMAINING=$(find "${BACKUP_DIR}" -name "fait_maison_*.sql.gz" | wc -l)
echo "[backup] Sauvegardes conservées : ${REMAINING}"

echo "[backup] $(date '+%Y-%m-%d %H:%M:%S') — Terminé"
