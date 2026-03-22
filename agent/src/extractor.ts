// agent/src/extractor.ts — Appels IA Claude / Mistral depuis l'agent
import fs from 'fs';
import path from 'path';
import { config } from './config';
import { logger } from './logger';
import { getMissionDir, updateMission } from './mission-store';
import { stampValidated } from './stamper';
import { Mission, ExtractedData } from '../../shared/schema';

const PROMPT = `Tu es un assistant expert en extraction de données de missions d'expertise médicale française.
Réponds UNIQUEMENT avec un JSON valide, sans markdown, sans texte avant ou après.

Pour chaque champ, donne la valeur ET un score de confiance entre 0 et 100.

{
  "client_type":          { "value": "Assureur ou Tribunal ou Expert ou Avocat ou Autre", "confidence": 95 },
  "client_name":          { "value": "nom de la compagnie", "confidence": 90 },
  "contact_gestionnaire": { "value": "nom du gestionnaire si mentionné", "confidence": 60 },
  "reference_client":     { "value": "numéro de dossier client", "confidence": 95 },
  "date_sinistre":        { "value": "JJ/MM/AAAA", "confidence": 90 },
  "date_souscription":    { "value": "JJ/MM/AAAA si mentionnée", "confidence": 50 },
  "patient_civilite":     { "value": "Madame ou Monsieur ou Autre", "confidence": 99 },
  "patient_sexe":         { "value": "M ou F", "confidence": 99 },
  "patient_prenom":       { "value": "prénom", "confidence": 95 },
  "patient_nom":          { "value": "nom de famille", "confidence": 97 },
  "patient_dob":          { "value": "JJ/MM/AAAA", "confidence": 88 },
  "patient_adresse":      { "value": "adresse complète", "confidence": 70 },
  "patient_telephone":    { "value": "numéro principal", "confidence": 85 },
  "patient_telephone2":   { "value": "autre numéro", "confidence": 50 },
  "patient_email":        { "value": "email", "confidence": 80 },
  "representant_legal":   { "value": "si mineur ou tutelle", "confidence": 60 },
  "blessures":            { "value": "blessures signalées", "confidence": 75 },
  "type_expertise":       { "value": "type d'expertise parmi la liste ci-dessous", "confidence": 80 }
}

CLASSIFICATION DU TYPE D'EXPERTISE — Choisis EXACTEMENT un type dans la liste ci-dessous.

Règles de déduction (applique dans l'ordre) :

1. Si le document mentionne un TRIBUNAL, une ORDONNANCE, un JUGE, une décision de justice :
   → "Expertise judiciaire (Contractuelle, Badinter, Faute Inexcusable)" si accident de la route ou contrat
   → "Expertise judiciaire (Assurance de personnes)" si assurance vie, prévoyance, GAV
   → "Expertise judiciaire ou CCI (Responsabilité médicale)" si erreur médicale, infection nosocomiale

2. Si le document mentionne "ASSISTANCE", "assister", "défendre les intérêts de", "avocat" :
   → C'est une ASSISTANCE (le médecin expert assiste la victime, pas l'assureur)
   → "Assistance à expertise judiciaire (Droit commun)" si accident, responsabilité civile
   → "Assistance à expertise judiciaire (Assurance de personnes)" si assurance de personnes
   → "Assistance à expertise responsabilité médicale" si erreur médicale

3. Si le mandant est un ASSUREUR (MAIF, AXA, MMA, GROUPAMA, MACIF, GMF, etc.) :
   → "Droit commun" si accident corporel, responsabilité civile, accident de la route (loi Badinter)
   → "Assurance de personnes" si GAV (Garantie Accidents de la Vie), prévoyance, assurance vie, individuelle accident
   → "Contractuelle" si litige contractuel, garantie
   → "IRCA" si convention IRCA mentionnée, indemnisation directe entre assureurs
   → "Badinter" si loi Badinter explicitement mentionnée, accident de la circulation

4. Si le document mentionne "AMIABLE", "contradictoire", "amiable et contradictoire" :
   → "Amiable et Contradictoire (IRCA, Contractuelle, Badinter, Droit commun)" si assureur dommages
   → "Amiable et Contradictoire (Assurance de personnes)" si assurance de personnes

5. Si le document mentionne "ARBITRAGE" :
   → "Arbitrage (IRCA, Contractuelle, Badinter, Droit commun)" ou "Arbitrage (Assurance de personnes)"

6. Si le document mentionne CCI, Commission de Conciliation :
   → "Audience CCI"

7. Si "sur pièces", "examen sur dossier" → "Expertise sur pièces"
8. Si "sapiteur" → "Sapiteur"
9. Si "dépendance", "perte d'autonomie", "APA" → "Dépendance"
10. Si "statutaire", "fonction publique", "militaire" → "Expertise statutaire"
11. Si "BRUGNOT" → "Jurisprudence BRUGNOT"
12. Si "responsabilité médicale", "erreur médicale", "infection nosocomiale" (sans tribunal) → "Responsabilité médicale"

INDICES SUPPLÉMENTAIRES :
- Un assureur qui mandate directement = expertise amiable (pas judiciaire)
- "Accident de la route" + assureur = souvent "Droit commun" ou "IRCA"
- "GAV", "Garantie Accidents de la Vie", "individuelle accident" = "Assurance de personnes"
- "Morsure", "chute", "agression" + assureur = souvent "Droit commun"
- "Prévoyance", "incapacité", "invalidité" + assureur = souvent "Assurance de personnes"
- MMA, AXA, MAIF mandatent souvent en "Droit commun" pour les accidents corporels
- GAN, GROUPAMA mandatent aussi en "Droit commun"

Types possibles (EXACTEMENT un) :
IRCA | Assurance de personnes | Droit commun | Contractuelle | Badinter | Responsabilité médicale | Dépendance | Expertise sur pièces | Sapiteur | Expertise statutaire | Jurisprudence BRUGNOT | Audience CCI | Amiable et Contradictoire (Assurance de personnes) | Amiable et Contradictoire (IRCA, Contractuelle, Badinter, Droit commun) | Expertise judiciaire (Contractuelle, Badinter, Faute Inexcusable) | Expertise judiciaire (Assurance de personnes) | Expertise judiciaire ou CCI (Responsabilité médicale) | Assistance à expertise amiable (Assurance de personnes) | Assistance à expertise amiable (IRCA, Contractuelle, Badinter, Droit commun) | Assistance à expertise responsabilité médicale | Assistance à expertise judiciaire (Droit commun) | Assistance à expertise judiciaire (Assurance de personnes) | Assistance à expertise judiciaire ou CCI (Responsabilité médicale) | Assistance à expertise judiciaire en Faute Inexcusable | Assistance à avis sapiteur | Arbitrage (IRCA, Contractuelle, Badinter, Droit commun) | Arbitrage (Assurance de personnes) | Assistance à arbitrage (IRCA, Contractuelle, Badinter, Droit commun) | Assistance à arbitrage (Assurance de personnes)

Si une info est absente : { "value": null, "confidence": 0 }.
Le score de confiance reflète ta certitude : 100 = sûr, 50 = probable, < 30 = deviné.`;

export async function extractMission(
  missionId: string,
  provider: 'claude' | 'mistral' = 'claude'
): Promise<Mission | null> {
  const missionDir = getMissionDir(missionId);
  if (!missionDir) {
    logger.error('Mission dir not found', { mission_id: missionId });
    return null;
  }

  const jsonPath = path.join(missionDir, 'mission.json');
  const mission: Mission = JSON.parse(fs.readFileSync(jsonPath, 'utf-8'));

  // Lire le fichier source
  const sourceFile = mission.source.files[0];
  const sourcePath = path.join(missionDir, sourceFile);

  if (!fs.existsSync(sourcePath)) {
    logger.error('Source file not found', { mission_id: missionId, file: sourceFile });
    return null;
  }

  // Marquer comme processing
  updateMission(missionId, { status: 'processing', _event: 'extraction_start' } as any);

  const startTime = Date.now();

  try {
    const base64 = fs.readFileSync(sourcePath).toString('base64');
    const mime = getMimeType(sourceFile);

    let result: any;
    if (provider === 'mistral') {
      result = await callMistral(base64, mime);
    } else {
      result = await callClaude(base64, mime);
    }

    const durationMs = Date.now() - startTime;
    const rawText = provider === 'mistral'
      ? result.choices[0].message.content
      : result.content[0].text;

    const cleanJson = rawText.trim().replace(/```json|```/g, '').trim();
    let extractedData: ExtractedData;
    try {
      extractedData = JSON.parse(cleanJson);
    } catch {
      logger.error('JSON parse failed', { mission_id: missionId, raw: cleanJson.slice(0, 200) });
      updateMission(missionId, {
        status: 'needs_review',
        alerts: [{ type: 'extraction_failed', message: 'JSON malformé retourné par l\'IA', severity: 'error' }],
        _event: 'extraction_failed',
      } as any);
      return null;
    }

    // Calculer la confiance moyenne
    const scores = Object.values(extractedData)
      .map(f => f?.confidence || 0)
      .filter(s => s > 0);
    const avgConfidence = scores.length ? scores.reduce((a, b) => a + b, 0) / scores.length : 0;

    // Générer les alertes
    const alerts = generateAlerts(extractedData);

    // Coût estimé
    const costEur = provider === 'claude'
      ? (1500 * 3 + 300 * 15) / 1_000_000  // Sonnet
      : (1500 * 2 + 300 * 6) / 1_000_000;  // Mistral Large

    // Déterminer le statut
    const status = avgConfidence >= 70 && alerts.filter(a => a.severity === 'error').length === 0
      ? 'ready_to_fill'
      : 'needs_review';

    const now = new Date().toISOString();
    const updated = updateMission(missionId, {
      status,
      data: extractedData,
      alerts,
      extraction: {
        provider,
        model: provider === 'claude' ? 'claude-sonnet-4-6' : 'mistral-large-latest',
        prompt_version: 'v3',
        duration_ms: durationMs,
        cost_eur: costEur,
        raw_response: cleanJson,
      },
      timestamps: {
        ...mission.timestamps,
        extracted: now,
      },
      _event: 'extraction_done',
    } as any);

    logger.info('Extraction complete', {
      mission_id: missionId,
      provider,
      duration_ms: durationMs,
      avg_confidence: Math.round(avgConfidence),
      status,
      alerts_count: alerts.length,
    });

    // Si prête → sortir le PDF "Traité-Soon-xxx" dans le dossier parent
    if (status === 'ready_to_fill') {
      stampValidated(missionId);
    }

    return updated;

  } catch (err) {
    const durationMs = Date.now() - startTime;
    logger.error('Extraction failed', {
      mission_id: missionId,
      provider,
      duration_ms: durationMs,
      error: String(err),
    });
    updateMission(missionId, {
      status: 'needs_review',
      alerts: [{ type: 'extraction_error', message: String(err), severity: 'error' }],
      _event: 'extraction_error',
    } as any);
    return null;
  }
}

function generateAlerts(data: ExtractedData): Array<{ type: string; field?: string; message: string; severity: 'info' | 'warning' | 'error' }> {
  const alerts: Array<{ type: string; field?: string; message: string; severity: 'info' | 'warning' | 'error' }> = [];

  // Champs requis manquants
  const required = ['patient_nom', 'patient_prenom'] as const;
  for (const f of required) {
    if (!data[f]?.value) {
      alerts.push({ type: 'missing_required', field: f, message: `${f} absent`, severity: 'error' });
    }
  }

  // Confiance faible
  for (const [field, val] of Object.entries(data)) {
    if (val?.value && val.confidence > 0 && val.confidence < 70) {
      alerts.push({ type: 'low_confidence', field, message: `Confiance ${val.confidence}%`, severity: 'warning' });
    }
  }

  // Date dans le futur
  for (const f of ['date_sinistre', 'date_souscription'] as const) {
    if (data[f]?.value) {
      const parts = data[f].value!.split('/');
      if (parts.length === 3) {
        const d = new Date(`${parts[2]}-${parts[1]}-${parts[0]}`);
        if (d > new Date()) {
          alerts.push({ type: 'date_future', field: f, message: 'Date dans le futur', severity: 'error' });
        }
      }
    }
  }

  // Patient mineur
  if (data.patient_dob?.value) {
    const parts = data.patient_dob.value.split('/');
    if (parts.length === 3) {
      const dob = new Date(`${parts[2]}-${parts[1]}-${parts[0]}`);
      const age = (Date.now() - dob.getTime()) / (365.25 * 24 * 60 * 60 * 1000);
      if (age < 18) {
        alerts.push({ type: 'possible_minor', field: 'patient_dob', message: `Patient mineur (~${Math.floor(age)} ans)`, severity: 'warning' });
      }
    }
  }

  return alerts;
}

async function callClaude(base64: string, mime: string) {
  const isPdf = mime === 'application/pdf';
  const content = isPdf
    ? [
        { type: 'document', source: { type: 'base64', media_type: mime, data: base64 } },
        { type: 'text', text: PROMPT },
      ]
    : [
        { type: 'image', source: { type: 'base64', media_type: mime, data: base64 } },
        { type: 'text', text: PROMPT },
      ];

  const resp = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': config.claudeApiKey,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: 'claude-sonnet-4-6',
      max_tokens: 2048,
      messages: [{ role: 'user', content }],
    }),
  });

  if (!resp.ok) {
    const err = await resp.json().catch(() => ({}));
    throw new Error((err as any).error?.message || `Claude HTTP ${resp.status}`);
  }
  return resp.json();
}

async function callMistral(base64: string, mime: string) {
  const content = [
    { type: 'image_url', image_url: { url: `data:${mime};base64,${base64}` } },
    { type: 'text', text: PROMPT },
  ];

  const resp = await fetch('https://api.mistral.ai/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${config.mistralApiKey}`,
    },
    body: JSON.stringify({
      model: 'mistral-large-latest',
      max_tokens: 2048,
      messages: [{ role: 'user', content }],
    }),
  });

  if (!resp.ok) {
    const err = await resp.json().catch(() => ({}));
    throw new Error((err as any).message || `Mistral HTTP ${resp.status}`);
  }
  return resp.json();
}

function getMimeType(filename: string): string {
  const ext = path.extname(filename).toLowerCase();
  const mimes: Record<string, string> = {
    '.pdf': 'application/pdf',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.webp': 'image/webp',
  };
  return mimes[ext] || 'application/pdf';
}
