// shared/statuses.ts — Statuts métier et transitions autorisées

export type MissionStatus =
  | 'new'
  | 'queued'
  | 'processing'
  | 'needs_review'
  | 'ready_to_fill'
  | 'filled'
  | 'validated'
  | 'rejected'
  | 'duplicate'
  | 'archived';

export const TRANSITIONS: Record<MissionStatus, MissionStatus[]> = {
  new:            ['queued', 'duplicate', 'archived'],
  queued:         ['processing', 'archived'],
  processing:     ['needs_review', 'ready_to_fill', 'duplicate', 'archived'],
  needs_review:   ['ready_to_fill', 'rejected', 'queued', 'archived'],
  ready_to_fill:  ['filled', 'validated', 'needs_review', 'rejected', 'archived'],
  filled:         ['validated', 'rejected', 'needs_review', 'archived'],
  validated:      ['ready_to_fill', 'needs_review', 'queued', 'archived'],
  rejected:       ['queued', 'ready_to_fill', 'needs_review', 'archived'],
  duplicate:      ['queued', 'archived'],
  archived:       ['queued', 'ready_to_fill', 'needs_review'],
};

export function canTransition(from: MissionStatus, to: MissionStatus): boolean {
  return TRANSITIONS[from]?.includes(to) ?? false;
}
