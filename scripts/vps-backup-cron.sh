#!/usr/bin/env bash
# ==============================================================================
# SALSA & WESTO Automated Daily Backup Cron Script (VPS Deployment)
# ==============================================================================
# Usage:
#   Add to crontab via `crontab -e`:
#   0 3 * * * /opt/westo/scripts/vps-backup-cron.sh >> /opt/westo/storage/backups/backup.log 2>&1
# ==============================================================================

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
APP_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"
BACKUP_DIR="${APP_ROOT}/storage/backups"
TIMESTAMP="$(date +"%Y%m%d_%H%M%S")"
TARGET_FILE="${BACKUP_DIR}/westo_db_${TIMESTAMP}.json"
CHECKSUM_FILE="${TARGET_FILE}.sha256"

mkdir -p "${BACKUP_DIR}"

echo "[$(date -u +"%Y-%m-%dT%H:%M:%SZ")] Starting automated backup..."

# 1. Snapshot JSON Database (Source of Record for Westo Tenant #1)
if [[ -f "${APP_ROOT}/server/data/db.json" ]]; then
    cp "${APP_ROOT}/server/data/db.json" "${TARGET_FILE}"
    
    # Calculate SHA256 Checksum
    if command -v shasum >/dev/null 2>&1; then
        shasum -a 256 "${TARGET_FILE}" > "${CHECKSUM_FILE}"
    elif command -v sha256sum >/dev/null 2>&1; then
        sha256sum "${TARGET_FILE}" > "${CHECKSUM_FILE}"
    fi
    echo "[$(date -u +"%Y-%m-%dT%H:%M:%SZ")] Snapshot saved: ${TARGET_FILE}"
    echo "[$(date -u +"%Y-%m-%dT%H:%M:%SZ")] Checksum saved: ${CHECKSUM_FILE}"
else
    echo "[$(date -u +"%Y-%m-%dT%H:%M:%SZ")] WARNING: server/data/db.json not found."
fi

# 2. Snapshot PostgreSQL if pg_dump is available and DATABASE_URL is set
if [[ -n "${DATABASE_URL:-}" ]] && command -v pg_dump >/dev/null 2>&1; then
    PG_TARGET="${BACKUP_DIR}/salsa_pg_${TIMESTAMP}.sql.gz"
    pg_dump "${DATABASE_URL}" | gzip > "${PG_TARGET}"
    echo "[$(date -u +"%Y-%m-%dT%H:%M:%SZ")] PostgreSQL dump saved: ${PG_TARGET}"
fi

# 3. Rotate Backups: Delete backups older than 30 days
find "${BACKUP_DIR}" -type f -name "westo_db_*.json*" -mtime +30 -delete 2>/dev/null || true
find "${BACKUP_DIR}" -type f -name "salsa_pg_*.sql.gz*" -mtime +30 -delete 2>/dev/null || true

echo "[$(date -u +"%Y-%m-%dT%H:%M:%SZ")] Backup completed successfully."
