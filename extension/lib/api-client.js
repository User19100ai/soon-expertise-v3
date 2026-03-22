// lib/api-client.js — Communication avec l'agent local

const API_BASE = 'http://127.0.0.1:9721';

let authToken = '';

export async function initToken() {
  const res = await chrome.storage.local.get(['agentToken']);
  authToken = res.agentToken || '';
}

export function setToken(token) {
  authToken = token;
  chrome.storage.local.set({ agentToken: token });
}

async function request(path, options = {}) {
  const url = `${API_BASE}${path}`;
  const headers = { 'Content-Type': 'application/json' };
  if (authToken) headers['Authorization'] = `Bearer ${authToken}`;

  const resp = await fetch(url, { ...options, headers: { ...headers, ...(options.headers || {}) } });

  if (!resp.ok) {
    const err = await resp.json().catch(() => ({}));
    throw new Error(err.error || `HTTP ${resp.status}`);
  }
  return resp.json();
}

// ── Health ──
export async function checkHealth() {
  try {
    const data = await request('/health');
    return { connected: true, ...data };
  } catch {
    return { connected: false };
  }
}

// ── Missions ──
export function getMissions(params = {}) {
  const qs = new URLSearchParams();
  if (params.status) qs.set('status', params.status);
  if (params.search) qs.set('search', params.search);
  if (params.limit) qs.set('limit', String(params.limit));
  if (params.offset) qs.set('offset', String(params.offset));
  const query = qs.toString();
  return request(`/missions${query ? '?' + query : ''}`);
}

export function getMission(id) {
  return request(`/missions/${id}`);
}

export function updateMission(id, updates) {
  return request(`/missions/${id}`, {
    method: 'PATCH',
    body: JSON.stringify(updates),
  });
}

export function extractMission(id, provider = 'claude') {
  return request(`/missions/${id}/extract`, {
    method: 'POST',
    body: JSON.stringify({ provider }),
  });
}

export function getMissionFileBase64(id) {
  return request(`/missions/${id}/file-base64`);
}

export function markDuplicate(id, ofMission) {
  return request(`/missions/${id}/duplicate`, {
    method: 'POST',
    body: JSON.stringify({ of_mission: ofMission }),
  });
}

export function groupMissions(missionIds) {
  return request('/missions/group', {
    method: 'POST',
    body: JSON.stringify({ mission_ids: missionIds }),
  });
}

export function getStats() {
  return request('/stats');
}
