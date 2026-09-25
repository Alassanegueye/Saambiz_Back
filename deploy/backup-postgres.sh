#!/usr/bin/env bash
# ============================================================
#  SaamBiz API — Sauvegarde PostgreSQL
#  Usage   : bash deploy/backup-postgres.sh
#  Cron    : 0 2 * * * /var/www/saambiz-backend/deploy/backup-postgres.sh >> /var/log/saambiz-backup.log 2>&1
#
#  APP_DIR est surchargeable : APP_DIR=/chemin/autre bash deploy/backup-postgres.sh
#
#  Fonctionnement :
#   • Docker Compose → pg_dump via le conteneur postgres
#   • PM2 / bare metal → pg_dump direct (postgres doit être installé sur l'hôte)
#   • Compresse le dump en .gz
#   • Garde les 7 dernières sauvegardes (purge automatique)
# ============================================================
set -euo pipefail

APP_DIR="${APP_DIR:-/var/www/saambiz-backend}"
BACKUP_DIR="${APP_DIR}/backups"
TIMESTAMP=$(date +"%Y%m%d_%H%M%S")
KEEP_DAYS=7

# Charger les variables d'environnement depuis .env
if [ -f "${APP_DIR}/.env" ]; then
    set -o allexport
    # shellcheck disable=SC1090
    source <(grep -E '^(DB_|PGPASSWORD)' "${APP_DIR}/.env" | sed 's/ *= */=/')
    set +o allexport
else
    # Sans .env, les identifiants viendraient de valeurs par défaut et le dump
    # échouerait sur une base inexistante — ou, pire, réussirait sur une autre.
    # Ce script tournant en cron, personne ne lit sa sortie : on s'arrête net.
    echo "[backup] ERREUR : ${APP_DIR}/.env introuvable." >&2
    echo "[backup] Ajustez APP_DIR — ce chemin pointait encore sur" >&2
    echo "[backup] /var/www/fait-maison-backend, l'ancien nom du projet." >&2
    exit 1
fi

DB_NAME="${DB_NAME:?DB_NAME absent de ${APP_DIR}/.env}"
DB_USER="${DB_USER:?DB_USER absent de ${APP_DIR}/.env}"
DB_HOST="${DB_HOST:-127.0.0.1}"
DB_PORT="${DB_PORT:-5432}"

# Le préfixe des fichiers dérive du nom de la base, il ne le répète pas en dur.
# Il était figé à « fait_maison_ » : la purge ci-dessous ne retrouvait donc
# aucune des sauvegardes réellement écrites, et le disque se remplissait sans
# que rien ne le signale.
PREFIXE="${DB_NAME}"
BACKUP_FILE="${BACKUP_DIR}/${PREFIXE}_${TIMESTAMP}.sql.gz"

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
find "${BACKUP_DIR}" -name "${PREFIXE}_*.sql.gz" -mtime "+${KEEP_DAYS}" -delete
REMAINING=$(find "${BACKUP_DIR}" -name "${PREFIXE}_*.sql.gz" | wc -l)
echo "[backup] Sauvegardes conservées : ${REMAINING}"

echo "[backup] $(date '+%Y-%m-%d %H:%M:%S') — Terminé"
