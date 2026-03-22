// shared/schema.ts — Types partagés agent + extension

export interface FieldValue {
  value: string | null;
  confidence: number; // 0-100
}

export interface ExtractedData {
  client_type: FieldValue;
  client_name: FieldValue;
  contact_gestionnaire: FieldValue;
  reference_client: FieldValue;
  date_sinistre: FieldValue;
  date_souscription: FieldValue;
  patient_civilite: FieldValue;
  patient_sexe: FieldValue;
  patient_prenom: FieldValue;
  patient_nom: FieldValue;
  patient_dob: FieldValue;
  patient_adresse: FieldValue;
  patient_telephone: FieldValue;
  patient_telephone2: FieldValue;
  patient_email: FieldValue;
  representant_legal: FieldValue;
  blessures: FieldValue;
  [key: string]: FieldValue;
}

export interface Alert {
  type: string;
  field?: string;
  message: string;
  severity: 'info' | 'warning' | 'error';
}

export interface HistoryEntry {
  at: string;
  event: string;
  machine: string;
  details?: Record<string, unknown>;
}

export interface Mission {
  id: string;
  status: string;

  source: {
    files: string[];
    hash: string;
    type: string;
    size: number;
    original_name: string;
  };

  timestamps: {
    arrived: string;
    queued: string | null;
    extracted: string | null;
    filled: string | null;
    validated: string | null;
  };

  extraction: {
    provider: string | null;
    model: string | null;
    prompt_version: string;
    duration_ms: number | null;
    cost_eur: number | null;
    raw_response: string | null;
  } | null;

  data: ExtractedData | null;
  alerts: Alert[];

  duplicate: {
    is_duplicate: boolean;
    of_mission: string | null;
    score: number;
  };

  group: {
    id: string | null;
    order: number;
  };

  corrections: Array<{
    at: string;
    field: string;
    old_value: string | null;
    new_value: string | null;
    machine: string;
  }>;

  meta: {
    created_by: string;
    updated_by: string;
    updated_at: string;
    extension_version: string;
    mapping_version: string;
  };

  history: HistoryEntry[];
}
