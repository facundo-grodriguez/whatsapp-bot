#!/usr/bin/env node
/**
 * Copia la base SQLite local (DATABASE_URL) a backups/ con timestamp, y borra
 * las copias más viejas que excedan la retención configurada. Solo sirve para
 * bases de archivo local (`file:...`, la única forma soportada en este proyecto
 * — ver CLAUDE.md, decisión de base de datos); si DATABASE_URL apunta a otra
 * cosa, no hay nada que copiar acá y el script avisa y no hace nada.
 *
 * Uso:
 *   npm run db:backup                  # retiene las últimas 30 copias
 *   npm run db:backup -- --keep 7      # retiene las últimas 7
 *
 * Pensado para correr desde un cron (Linux) o el Programador de tareas de
 * Windows, apuntando a `node --env-file=.env scripts/backup-db.mjs` con la
 * frecuencia que se necesite (ver README, sección "Backups").
 */

import { copyFile, mkdir, readdir, rm, stat } from "node:fs/promises";
import path from "node:path";

const DEFAULT_KEEP = 30;
const FILE_PREFIX = "file:";

function flagValue(name, fallback) {
  const args = process.argv.slice(2);
  const index = args.indexOf(`--${name}`);
  return index !== -1 && args[index + 1] ? args[index + 1] : fallback;
}

function timestampSuffix(date) {
  // YYYYMMDD-HHmmss en hora local — ordena alfabéticamente igual que
  // cronológicamente, y es legible a simple vista en el nombre del archivo.
  const pad = (n) => String(n).padStart(2, "0");
  return (
    `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}-` +
    `${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}`
  );
}

async function main() {
  const databaseUrl = process.env.DATABASE_URL ?? "file:./data/bot.db";
  if (!databaseUrl.startsWith(FILE_PREFIX)) {
    console.log(
      `DATABASE_URL ("${databaseUrl}") no es un archivo local: este script solo hace backup ` +
        `de bases file:. No hay nada que hacer.`,
    );
    return;
  }

  const dbPath = databaseUrl.slice(FILE_PREFIX.length);
  const dbStat = await stat(dbPath).catch(() => null);
  if (!dbStat) {
    console.error(`No se encontró la base en "${dbPath}". ¿Corriste las migraciones?`);
    process.exitCode = 1;
    return;
  }

  const backupsDir = path.join(path.dirname(dbPath), "..", "backups");
  await mkdir(backupsDir, { recursive: true });

  const backupName = `${path.basename(dbPath, path.extname(dbPath))}-${timestampSuffix(new Date())}${path.extname(dbPath)}`;
  const backupPath = path.join(backupsDir, backupName);
  await copyFile(dbPath, backupPath);
  console.log(`Backup creado: ${backupPath}`);

  const keep = Number(flagValue("keep", DEFAULT_KEEP));
  const prefix = path.basename(dbPath, path.extname(dbPath));
  const existing = (await readdir(backupsDir))
    .filter((name) => name.startsWith(`${prefix}-`))
    .sort(); // el formato de timestamp ordena cronológicamente como string

  const toDelete = existing.slice(0, Math.max(0, existing.length - keep));
  for (const name of toDelete) {
    await rm(path.join(backupsDir, name));
    console.log(`Backup viejo borrado (excede retención de ${keep}): ${name}`);
  }
}

main().catch((error) => {
  console.error("Error haciendo el backup:", error);
  process.exitCode = 1;
});
