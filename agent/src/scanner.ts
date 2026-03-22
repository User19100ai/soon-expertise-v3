// agent/src/scanner.ts — Scan forcé du dossier Missions
import fs from 'fs';
import path from 'path';
import { exec } from 'child_process';
import { config } from './config';
import { logger } from './logger';
import { hashFile, generateId } from './hasher';
import { createMission, findByHash, updateMission } from './mission-store';
import { extractMission } from './extractor';

const SUPPORTED_EXT = ['.pdf', '.png', '.jpg', '.jpeg', '.webp'];

// Force OneDrive à télécharger les fichiers cloud-only
function forceOneDriveSync(dirPath: string): Promise<void> {
  return new Promise((resolve) => {
    // Lister les fichiers .icloud (fichiers OneDrive pas encore téléchargés)
    // et les "ouvrir" pour forcer le téléchargement
    try {
      const files = fs.readdirSync(dirPath);
      for (const file of files) {
        const fullPath = path.join(dirPath, file);
        const stat = fs.statSync(fullPath);
        if (stat.isDirectory()) continue;

        // Sur OneDrive Mac, les fichiers cloud-only apparaissent dans le Finder
        // mais ne sont pas forcément téléchargés. On force avec un read.
        const ext = path.extname(file).toLowerCase();
        if (SUPPORTED_EXT.includes(ext)) {
          try {
            // Ouvrir le fichier force OneDrive à le télécharger
            const fd = fs.openSync(fullPath, 'r');
            fs.closeSync(fd);
          } catch {}
        }
      }
    } catch {}

    // Aussi utiliser la commande brctl pour forcer le download (si disponible)
    exec(`find "${dirPath}" -maxdepth 1 -name "*.pdf" -o -name "*.png" -o -name "*.jpg" -o -name "*.jpeg" -o -name "*.webp" | head -20`, () => {
      resolve();
    });
  });
}

// Scan forcé : parcourt le dossier et crée les missions manquantes
export async function forceScan(): Promise<{ found: number; new_missions: number; duplicates: number; errors: string[] }> {
  const result = { found: 0, new_missions: 0, duplicates: 0, errors: [] as string[] };

  logger.info('Force scan started');

  // 1. Forcer OneDrive à télécharger
  await forceOneDriveSync(config.inboxPath);

  // Attendre un peu que OneDrive télécharge
  await new Promise(r => setTimeout(r, 3000));

  // 2. Lister tous les fichiers supportés
  let files: string[];
  try {
    files = fs.readdirSync(config.inboxPath)
      .filter(f => {
        if (f.startsWith('.')) return false;
        const ext = path.extname(f).toLowerCase();
        return SUPPORTED_EXT.includes(ext);
      });
  } catch (err) {
    logger.error('Cannot read inbox directory', { error: String(err) });
    return result;
  }

  result.found = files.length;
  logger.info(`Force scan: ${files.length} files found`);

  // 3. Traiter chaque fichier
  for (const file of files) {
    const filePath = path.join(config.inboxPath, file);

    try {
      const stat = fs.statSync(filePath);
      if (stat.size === 0) {
        result.errors.push(`${file}: fichier vide`);
        continue;
      }
      if (stat.size > 10 * 1024 * 1024) {
        result.errors.push(`${file}: trop volumineux (${(stat.size / 1024 / 1024).toFixed(1)} Mo)`);
        continue;
      }

      const hash = await hashFile(filePath);
      const existing = findByHash(hash);

      if (existing) {
        result.duplicates++;
        continue;
      }

      // Créer la mission
      const mission = createMission(filePath, hash, stat.size);
      logger.info('Force scan: mission created', { mission_id: mission.id, file });

      updateMission(mission.id, {
        status: 'queued',
        timestamps: { ...mission.timestamps, queued: new Date().toISOString() },
        _event: 'force_scan_queued',
      } as any);

      // Extraction auto
      if (config.claudeApiKey) {
        extractMission(mission.id, 'claude');
      }

      result.new_missions++;

    } catch (err) {
      result.errors.push(`${file}: ${String(err)}`);
      logger.error('Force scan: file error', { file, error: String(err) });
    }
  }

  logger.info('Force scan complete', result);
  return result;
}
