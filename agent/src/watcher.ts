// agent/src/watcher.ts — Surveille le dossier Missions OneDrive
import chokidar from 'chokidar';
import path from 'path';
import fs from 'fs';
import { config } from './config';
import { logger } from './logger';
import { hashFile } from './hasher';
import { createMission, findByHash, updateMission } from './mission-store';
import { extractMission } from './extractor';

const SUPPORTED_EXT = ['.pdf', '.png', '.jpg', '.jpeg', '.webp'];
const STABILIZE_DELAY = 2000;

const pendingFiles = new Map<string, NodeJS.Timeout>();

export function startWatcher() {
  // ── 1. Surveiller les fichiers PDF/images à la racine de Missions/ (inbox) ──
  // depth: 0 = seulement la racine, pas les sous-dossiers de missions traitées
  const inboxWatcher = chokidar.watch(config.inboxPath, {
    ignoreInitial: false,
    persistent: true,
    awaitWriteFinish: { stabilityThreshold: STABILIZE_DELAY, pollInterval: 500 },
    ignored: [
      /(^|[\/\\])\../, /\.icloud$/, /\.tmp$/,   // .DS_Store, fichiers iCloud/OneDrive en transit
      /\/_archive\//,                             // dossier archive
    ],
    depth: 0, // SEULEMENT les fichiers à la racine — pas les sous-dossiers de missions
  });

  inboxWatcher.on('add', (filePath: string) => {
    const ext = path.extname(filePath).toLowerCase();
    if (!SUPPORTED_EXT.includes(ext)) return;

    // Ignorer les fichiers dans les sous-dossiers (missions déjà traitées)
    const relative = path.relative(config.inboxPath, filePath);
    if (relative.includes(path.sep)) return; // fichier dans un sous-dossier → ignorer

    // Debounce
    if (pendingFiles.has(filePath)) clearTimeout(pendingFiles.get(filePath));
    pendingFiles.set(filePath, setTimeout(() => {
      pendingFiles.delete(filePath);
      processInboxFile(filePath);
    }, 1000));
  });

  inboxWatcher.on('error', (err) => {
    logger.error('Inbox watcher error', { error: String(err) });
  });

  logger.info(`Inbox watcher started: ${config.inboxPath}`);

  // ── 2. Surveiller les mission.json dans les sous-dossiers (modifs autres Macs) ──
  const missionsWatcher = chokidar.watch(
    path.join(config.missionsPath, '*/mission.json'),
    {
      ignoreInitial: true,
      persistent: true,
      awaitWriteFinish: { stabilityThreshold: 1000, pollInterval: 500 },
      ignored: [/(^|[\/\\])\../, /\.icloud$/, /\.tmp$/],
    }
  );

  missionsWatcher.on('change', (filePath: string) => {
    try {
      const raw = fs.readFileSync(filePath, 'utf-8');
      const mission = JSON.parse(raw);
      if (mission.meta?.updated_by !== config.machineId) {
        logger.info('Mission updated by another Mac', {
          mission_id: mission.id,
          updated_by: mission.meta.updated_by,
          status: mission.status,
        });
      }
    } catch {}
  });

  logger.info(`Missions watcher started: ${config.missionsPath}`);
}

async function processInboxFile(filePath: string) {
  const fileName = path.basename(filePath);
  logger.info(`New file detected: ${fileName}`);

  try {
    if (!fs.existsSync(filePath)) {
      logger.warn('File disappeared before processing', { file: fileName });
      return;
    }

    const stat = fs.statSync(filePath);
    if (stat.size === 0) {
      logger.warn('Empty file, skipping', { file: fileName });
      return;
    }
    if (stat.size > 10 * 1024 * 1024) {
      logger.warn('File too large (>10Mo), skipping', { file: fileName, size: stat.size });
      return;
    }

    // Hash pour détection doublons
    const hash = await hashFile(filePath);
    const existing = findByHash(hash);

    if (existing) {
      logger.info('Duplicate file detected (same hash)', {
        file: fileName,
        existing_mission: existing.id,
      });
      return; // Ne pas supprimer, ne pas recréer
    }

    // Créer la mission (sous-dossier dans Missions/)
    const mission = createMission(filePath, hash, stat.size);
    logger.info('Mission created', {
      mission_id: mission.id,
      file: fileName,
      hash: hash.slice(0, 12),
      size: stat.size,
    });

    // Passer en queued
    updateMission(mission.id, {
      status: 'queued',
      timestamps: { ...mission.timestamps, queued: new Date().toISOString() },
      _event: 'status_queued',
    } as any);

    // Extraction automatique si clé API disponible
    if (config.claudeApiKey) {
      logger.info('Auto-extraction started', { mission_id: mission.id });
      extractMission(mission.id, 'claude').then((result) => {
        if (result) {
          logger.info('Auto-extraction complete', {
            mission_id: mission.id,
            status: result.status,
          });
        }
      }).catch((err) => {
        logger.error('Auto-extraction failed', {
          mission_id: mission.id,
          error: String(err),
        });
      });
    }

  } catch (err) {
    logger.error('Failed to process inbox file', {
      file: fileName,
      error: String(err),
    });
  }
}
