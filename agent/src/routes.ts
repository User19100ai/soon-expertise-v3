// agent/src/routes.ts — API REST
import { Router, Request, Response } from 'express';
import path from 'path';
import fs from 'fs';
import { config } from './config';
import { loadAllMissions, loadMission, updateMission, getMissionDir, findDuplicateByPatient } from './mission-store';
import { extractMission } from './extractor';
import { canTransition } from '../../shared/statuses';
import { MissionStatus } from '../../shared/statuses';
import { stampValidated } from './stamper';
import { forceScan } from './scanner';

export const router = Router();

// ── GET /health ──
router.get('/health', (req: Request, res: Response) => {
  const missions = loadAllMissions();
  res.json({
    status: 'ok',
    version: '3.0',
    machine: config.machineId,
    missions_count: missions.length,
    missions_by_status: countByStatus(missions),
  });
});

// ── GET /missions ──
router.get('/missions', (req: Request, res: Response) => {
  const { status, limit = '50', offset = '0', search } = req.query;
  let missions = loadAllMissions();

  if (status) {
    const statuses = (status as string).split(',');
    missions = missions.filter(m => statuses.includes(m.status));
  }

  if (search) {
    const q = (search as string).toLowerCase();
    missions = missions.filter(m => {
      const nom = m.data?.patient_nom?.value?.toLowerCase() || '';
      const prenom = m.data?.patient_prenom?.value?.toLowerCase() || '';
      const client = m.data?.client_name?.value?.toLowerCase() || '';
      const ref = m.data?.reference_client?.value?.toLowerCase() || '';
      return nom.includes(q) || prenom.includes(q) || client.includes(q) || ref.includes(q);
    });
  }

  const total = missions.length;
  const sliced = missions.slice(
    parseInt(offset as string, 10),
    parseInt(offset as string, 10) + parseInt(limit as string, 10)
  );

  // Retourner sans raw_response pour alléger
  const clean = sliced.map(m => ({
    ...m,
    extraction: m.extraction ? { ...m.extraction, raw_response: undefined } : null,
  }));

  res.json({ total, missions: clean });
});

// ── GET /missions/:id ──
router.get('/missions/:id', (req: Request, res: Response) => {
  const mission = loadMission(req.params.id);
  if (!mission) return res.status(404).json({ error: 'Mission not found' });
  res.json(mission);
});

// ── PATCH /missions/:id ──
router.patch('/missions/:id', (req: Request, res: Response) => {
  const mission = loadMission(req.params.id);
  if (!mission) return res.status(404).json({ error: 'Mission not found' });

  const { status, data, corrections, decision, decision_reason } = req.body;

  // Vérifier la transition de statut
  if (status && status !== mission.status) {
    if (!canTransition(mission.status as MissionStatus, status as MissionStatus)) {
      return res.status(400).json({
        error: `Transition interdite: ${mission.status} → ${status}`,
      });
    }
  }

  const updates: any = { _event: 'manual_update' };
  if (status) {
    updates.status = status;
    updates._event = `status_${status}`;

    // Mettre à jour les timestamps
    const ts: any = { ...mission.timestamps };
    if (status === 'filled') ts.filled = new Date().toISOString();
    if (status === 'validated') ts.validated = new Date().toISOString();
    updates.timestamps = ts;
  }
  if (data) updates.data = data;
  if (corrections) updates.corrections = [...(mission.corrections || []), ...corrections];
  if (decision) updates.decision = decision;
  if (decision_reason) updates.decision_reason = decision_reason;

  const updated = updateMission(req.params.id, updates);
  if (!updated) return res.status(500).json({ error: 'Update failed' });

  res.json(updated);
});

// ── POST /missions/:id/extract ──
router.post('/missions/:id/extract', async (req: Request, res: Response) => {
  const mission = loadMission(req.params.id);
  if (!mission) return res.status(404).json({ error: 'Mission not found' });

  if (!['queued', 'needs_review'].includes(mission.status)) {
    return res.status(400).json({ error: `Cannot extract in status: ${mission.status}` });
  }

  const provider = (req.body.provider || 'claude') as 'claude' | 'mistral';
  const apiKey = provider === 'mistral' ? config.mistralApiKey : config.claudeApiKey;
  if (!apiKey) {
    return res.status(400).json({ error: `Clé API ${provider} non configurée dans .env` });
  }

  // Lancer l'extraction en async
  res.json({ status: 'processing', mission_id: req.params.id });

  // L'extraction tourne en background
  extractMission(req.params.id, provider);
});

// ── GET /missions/:id/file ──
router.get('/missions/:id/file', (req: Request, res: Response) => {
  const missionDir = getMissionDir(req.params.id);
  if (!missionDir) return res.status(404).json({ error: 'Mission not found' });

  const mission = loadMission(req.params.id);
  if (!mission) return res.status(404).json({ error: 'Mission not found' });

  const filePath = path.join(missionDir, mission.source.files[0]);
  if (!fs.existsSync(filePath)) return res.status(404).json({ error: 'File not found' });

  res.sendFile(filePath);
});

// ── GET /missions/:id/file-base64 ──
router.get('/missions/:id/file-base64', (req: Request, res: Response) => {
  const missionDir = getMissionDir(req.params.id);
  if (!missionDir) return res.status(404).json({ error: 'Mission not found' });

  const mission = loadMission(req.params.id);
  if (!mission) return res.status(404).json({ error: 'Mission not found' });

  const filePath = path.join(missionDir, mission.source.files[0]);
  if (!fs.existsSync(filePath)) return res.status(404).json({ error: 'File not found' });

  const base64 = fs.readFileSync(filePath).toString('base64');
  const mime = mission.source.type === 'pdf' ? 'application/pdf' : `image/${mission.source.type}`;
  res.json({ base64, mime, filename: mission.source.original_name });
});

// ── POST /missions/:id/duplicate ──
router.post('/missions/:id/duplicate', (req: Request, res: Response) => {
  const { of_mission } = req.body;
  const updated = updateMission(req.params.id, {
    status: 'duplicate',
    duplicate: { is_duplicate: true, of_mission, score: 1.0 },
    _event: 'marked_duplicate',
  } as any);
  if (!updated) return res.status(500).json({ error: 'Update failed' });
  res.json(updated);
});

// ── POST /missions/group ──
router.post('/missions/group', (req: Request, res: Response) => {
  const { mission_ids } = req.body;
  if (!Array.isArray(mission_ids) || mission_ids.length < 2) {
    return res.status(400).json({ error: 'Need at least 2 mission IDs' });
  }
  const groupId = require('./hasher').generateId();
  const results = mission_ids.map((id: string, i: number) =>
    updateMission(id, {
      group: { id: groupId, order: i },
      _event: 'grouped',
    } as any)
  );
  res.json({ group_id: groupId, missions: results.filter(Boolean) });
});

// ── POST /scan ──
router.post('/scan', async (req: Request, res: Response) => {
  const result = await forceScan();
  res.json(result);
});

// ── GET /stats ──
router.get('/stats', (req: Request, res: Response) => {
  const missions = loadAllMissions();
  const monthKey = new Date().toISOString().slice(0, 7);

  const byStatus = countByStatus(missions);
  const byAssurer: Record<string, number> = {};
  const byMonth: Record<string, number> = {};
  let totalCost = 0;
  let totalDuration = 0;
  let extractedCount = 0;

  for (const m of missions) {
    const client = m.data?.client_name?.value || 'Inconnu';
    byAssurer[client] = (byAssurer[client] || 0) + 1;

    const month = m.timestamps.arrived.slice(0, 7);
    byMonth[month] = (byMonth[month] || 0) + 1;

    if (m.extraction) {
      totalCost += m.extraction.cost_eur || 0;
      totalDuration += m.extraction.duration_ms || 0;
      extractedCount++;
    }
  }

  res.json({
    total: missions.length,
    this_month: byMonth[monthKey] || 0,
    by_status: byStatus,
    by_assurer: byAssurer,
    by_month: byMonth,
    avg_cost_eur: extractedCount ? totalCost / extractedCount : 0,
    avg_duration_ms: extractedCount ? totalDuration / extractedCount : 0,
  });
});

function countByStatus(missions: any[]) {
  const counts: Record<string, number> = {};
  for (const m of missions) {
    counts[m.status] = (counts[m.status] || 0) + 1;
  }
  return counts;
}
