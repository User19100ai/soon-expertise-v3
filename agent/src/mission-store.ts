// agent/src/mission-store.ts — CRUD mission.json dans iCloud
import fs from 'fs';
import path from 'path';
import { config } from './config';
import { logger } from './logger';
import { Mission } from '../../shared/schema';

// Lit tous les mission.json du dossier missions/
export function loadAllMissions(): Mission[] {
  const missions: Mission[] = [];
  const missionsDir = config.missionsPath;

  if (!fs.existsSync(missionsDir)) return missions;

  const dirs = fs.readdirSync(missionsDir, { withFileTypes: true })
    .filter(d => d.isDirectory() && !d.name.startsWith('_'));

  for (const dir of dirs) {
    const jsonPath = path.join(missionsDir, dir.name, 'mission.json');
    if (fs.existsSync(jsonPath)) {
      try {
        const raw = fs.readFileSync(jsonPath, 'utf-8');
        missions.push(JSON.parse(raw));
      } catch (err) {
        logger.warn(`Failed to read ${jsonPath}: ${err}`);
      }
    }
  }

  return missions.sort((a, b) =>
    new Date(b.timestamps.arrived).getTime() - new Date(a.timestamps.arrived).getTime()
  );
}

// Lit une mission par ID
export function loadMission(id: string): Mission | null {
  const missions = loadAllMissions();
  return missions.find(m => m.id === id) || null;
}

// Trouve le dossier d'une mission par ID
export function getMissionDir(id: string): string | null {
  const missionsDir = config.missionsPath;
  const dirs = fs.readdirSync(missionsDir, { withFileTypes: true })
    .filter(d => d.isDirectory() && !d.name.startsWith('_'));

  for (const dir of dirs) {
    const jsonPath = path.join(missionsDir, dir.name, 'mission.json');
    if (fs.existsSync(jsonPath)) {
      try {
        const raw = fs.readFileSync(jsonPath, 'utf-8');
        const mission = JSON.parse(raw);
        if (mission.id === id) return path.join(missionsDir, dir.name);
      } catch {}
    }
  }
  return null;
}

// Crée une nouvelle mission à partir d'un fichier inbox
export function createMission(
  sourceFile: string,
  hash: string,
  fileSize: number
): Mission {
  const now = new Date().toISOString();
  const ext = path.extname(sourceFile).toLowerCase().replace('.', '');
  const originalName = path.basename(sourceFile);
  const id = require('./hasher').generateId();

  // Nom du dossier mission : date_HASH-court
  const datePrefix = new Date().toISOString().slice(0, 10);
  const dirName = `${datePrefix}_${id}`;
  const missionDir = path.join(config.missionsPath, dirName);

  fs.mkdirSync(missionDir, { recursive: true });

  // Copier le fichier source
  const destFile = `source.${ext || 'pdf'}`;
  fs.copyFileSync(sourceFile, path.join(missionDir, destFile));

  const mission: Mission = {
    id,
    status: 'new',
    source: {
      files: [destFile],
      hash,
      type: ext || 'pdf',
      size: fileSize,
      original_name: originalName,
    },
    timestamps: {
      arrived: now,
      queued: null,
      extracted: null,
      filled: null,
      validated: null,
    },
    extraction: null,
    data: null,
    alerts: [],
    duplicate: { is_duplicate: false, of_mission: null, score: 0 },
    group: { id: null, order: 0 },
    corrections: [],
    meta: {
      created_by: config.machineId,
      updated_by: config.machineId,
      updated_at: now,
      extension_version: '3.0',
      mapping_version: 'v1',
    },
    history: [
      { at: now, event: 'file_detected', machine: config.machineId },
      { at: now, event: 'mission_created', machine: config.machineId },
    ],
  };

  writeMission(missionDir, mission);

  // Ne pas supprimer le fichier source — il reste dans OneDrive/inbox
  logger.info('Mission created from file (source preserved)', { mission_id: id, file: originalName });

  return mission;
}

// Met à jour une mission
export function updateMission(id: string, updates: Partial<Mission> & { _event?: string }): Mission | null {
  const missionDir = getMissionDir(id);
  if (!missionDir) return null;

  const jsonPath = path.join(missionDir, 'mission.json');
  const current: Mission = JSON.parse(fs.readFileSync(jsonPath, 'utf-8'));

  const event = updates._event || 'updated';
  delete (updates as any)._event;

  const now = new Date().toISOString();
  const merged: Mission = {
    ...current,
    ...updates,
    meta: {
      ...current.meta,
      ...(updates.meta || {}),
      updated_by: config.machineId,
      updated_at: now,
    },
    history: [
      ...current.history,
      { at: now, event, machine: config.machineId },
    ],
  };

  writeMission(missionDir, merged);
  return merged;
}

// Écriture atomique (tmp + rename)
function writeMission(missionDir: string, mission: Mission) {
  const jsonPath = path.join(missionDir, 'mission.json');
  const tmpPath = jsonPath + '.tmp';
  fs.writeFileSync(tmpPath, JSON.stringify(mission, null, 2), 'utf-8');
  fs.renameSync(tmpPath, jsonPath);
}

// Vérifie si un hash existe déjà
export function findByHash(hash: string): Mission | null {
  const all = loadAllMissions();
  return all.find(m => m.source.hash === hash) || null;
}

// Détection doublons par heuristique métier (nom + prénom + DOB)
export function findDuplicateByPatient(data: any): Mission | null {
  if (!data?.patient_nom?.value) return null;
  const nom = (data.patient_nom.value || '').toUpperCase().trim();
  const prenom = (data.patient_prenom?.value || '').toUpperCase().trim();
  const dob = (data.patient_dob?.value || '').trim();

  const all = loadAllMissions();
  for (const m of all) {
    if (!m.data || m.status === 'archived') continue;
    const mNom = (m.data.patient_nom?.value || '').toUpperCase().trim();
    const mPrenom = (m.data.patient_prenom?.value || '').toUpperCase().trim();
    const mDob = (m.data.patient_dob?.value || '').trim();

    if (mNom === nom && mPrenom === prenom) return m;
    if (mNom === nom && mDob === dob && dob) return m;
  }
  return null;
}
