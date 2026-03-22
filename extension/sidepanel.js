// sidepanel.js — Soon Expertise v3.0 Inbox & Detail

const API = 'http://127.0.0.1:9721';
let token = '';
let currentTab = 'inbox';
let currentMissionId = null;
let missions = [];

const FIELD_LABELS = {
  client_type: 'Type', client_name: 'Assureur', contact_gestionnaire: 'Gestionnaire',
  reference_client: 'Réf. client', date_sinistre: 'Sinistre', date_souscription: 'Souscrip.',
  patient_civilite: 'Civilité', patient_sexe: 'Sexe', patient_prenom: 'Prénom', patient_nom: 'Nom',
  patient_dob: 'Naissance', patient_adresse: 'Adresse', patient_telephone: 'Tél.',
  patient_telephone2: 'Tél. 2', patient_email: 'Email', representant_legal: 'Repr. légal',
  blessures: 'Blessures',
  type_expertise: 'Type expertise'
};

const STATUS_FILTERS = {
  inbox: 'new,queued',
  review: 'needs_review',
  ready: 'ready_to_fill',
  done: 'filled,validated,rejected,duplicate,archived',
};

// ── Init ──
chrome.storage.local.get(['agentToken'], (res) => {
  token = res.agentToken || '';
  loadMissions();
});

// ── API helper ──
async function api(path, options = {}) {
  const headers = { 'Content-Type': 'application/json' };
  if (token) headers['Authorization'] = `Bearer ${token}`;
  const resp = await fetch(`${API}${path}`, { ...options, headers });
  if (!resp.ok) {
    const err = await resp.json().catch(() => ({}));
    throw new Error(err.error || `HTTP ${resp.status}`);
  }
  return resp.json();
}

// ── Tabs ──
document.querySelectorAll('.sp-tab').forEach(tab => {
  tab.addEventListener('click', () => {
    document.querySelectorAll('.sp-tab').forEach(t => t.classList.remove('active'));
    tab.classList.add('active');
    currentTab = tab.dataset.tab;
    currentMissionId = null;

    document.getElementById('missionList').style.display = '';
    document.getElementById('missionDetail').style.display = 'none';
    document.getElementById('statsPanel').style.display = 'none';
    document.querySelector('.sp-search').style.display = '';

    if (currentTab === 'stats') {
      document.getElementById('missionList').style.display = 'none';
      document.getElementById('statsPanel').style.display = '';
      document.querySelector('.sp-search').style.display = 'none';
      loadStats();
    } else {
      loadMissions();
    }
  });
});

// ── Search ──
let searchTimeout;
document.getElementById('searchInput').addEventListener('input', (e) => {
  clearTimeout(searchTimeout);
  searchTimeout = setTimeout(() => loadMissions(e.target.value), 300);
});

// ── Load Missions ──
async function loadMissions(search = '') {
  const listEl = document.getElementById('missionList');
  try {
    const statusFilter = STATUS_FILTERS[currentTab] || '';
    const params = new URLSearchParams();
    if (statusFilter) params.set('status', statusFilter);
    if (search) params.set('search', search);
    params.set('limit', '100');

    const data = await api(`/missions?${params}`);
    missions = data.missions;
    renderMissionList(missions);
    updateBadges();
    updateConnStatus(true);
  } catch (err) {
    listEl.innerHTML = `<div class="sp-empty">Agent déconnecté<br><small style="color:var(--muted)">${err.message}</small></div>`;
    updateConnStatus(false);
  }
}

function renderMissionList(list) {
  const el = document.getElementById('missionList');
  if (!list.length) {
    el.innerHTML = '<div class="sp-empty">Aucune mission</div>';
    return;
  }
  el.innerHTML = list.map(m => {
    const name = m.data
      ? `${m.data.patient_prenom?.value || ''} ${m.data.patient_nom?.value || ''}`.trim() || m.source.original_name
      : m.source.original_name;
    const client = m.data?.client_name?.value || '—';
    const conf = getAvgConfidence(m);
    const confClass = conf >= 80 ? 'high' : conf >= 60 ? 'medium' : 'low';
    const time = timeAgo(m.timestamps.arrived);
    const icon = getStatusIcon(m.status);
    const alertDots = (m.alerts || []).map(a =>
      `<span class="sp-alert-dot ${a.severity === 'error' ? 'err' : 'warn'}"></span>`
    ).join('');

    return `<div class="sp-mission" data-id="${m.id}">
      <span class="sp-mission-icon">${icon}</span>
      <div class="sp-mission-info">
        <div class="sp-mission-name">${esc(name)}</div>
        <div class="sp-mission-meta">
          <span>${esc(client)}</span>
          ${m.data ? `<span class="sp-mission-conf ${confClass}">${conf}%</span>` : ''}
          <span class="sp-mission-alerts">${alertDots}</span>
        </div>
      </div>
      <span class="sp-mission-time">${time}</span>
    </div>`;
  }).join('');

  el.querySelectorAll('.sp-mission').forEach(item => {
    item.addEventListener('click', () => openDetail(item.dataset.id));
  });
}

// ── Detail ──
async function openDetail(id) {
  currentMissionId = id;
  try {
    const m = await api(`/missions/${id}`);
    renderDetail(m);
    document.getElementById('missionList').style.display = 'none';
    document.getElementById('missionDetail').style.display = '';
    document.querySelector('.sp-search').style.display = 'none';
  } catch (err) {
    console.error('Failed to load mission', err);
  }
}

function renderDetail(m) {
  // Status
  const statusEl = document.getElementById('detailStatus');
  statusEl.textContent = m.status.replace('_', ' ');
  statusEl.className = 'sp-detail-status ' + m.status;

  // Patient header
  const patientEl = document.getElementById('detailPatient');
  if (m.data) {
    const civ = m.data.patient_civilite?.value || '';
    const prenom = m.data.patient_prenom?.value || '';
    const nom = m.data.patient_nom?.value || '';
    const dob = m.data.patient_dob?.value || '';
    const sexe = m.data.patient_sexe?.value === 'F' ? 'Féminin' : m.data.patient_sexe?.value === 'M' ? 'Masculin' : '';
    patientEl.innerHTML = `<h2>${esc(civ)} ${esc(prenom)} ${esc(nom)}</h2>
      <div class="sub">${[dob && `Né(e) le ${dob}`, sexe, m.data.client_name?.value].filter(Boolean).join(' · ')}</div>`;
  } else {
    patientEl.innerHTML = `<h2>${esc(m.source.original_name)}</h2><div class="sub">En attente d'extraction</div>`;
  }

  // PDF Preview
  loadPdfPreview(m);

  // Copy all button
  const copyBtn = document.getElementById('btnCopyAll');
  if (m.data) {
    copyBtn.style.display = '';
    const newCopy = copyBtn.cloneNode(true);
    copyBtn.replaceWith(newCopy);
    newCopy.addEventListener('click', () => {
      const d = m.data;
      const lines = [];
      if (d.type_expertise?.value) lines.push(`Type : ${d.type_expertise.value}`);
      if (d.patient_civilite?.value) lines.push(`${d.patient_civilite.value} ${d.patient_prenom?.value || ''} ${d.patient_nom?.value || ''}`);
      if (d.patient_sexe?.value) lines.push(`Sexe : ${d.patient_sexe.value === 'F' ? 'Féminin' : 'Masculin'}`);
      if (d.patient_dob?.value) lines.push(`Né(e) le : ${d.patient_dob.value}`);
      if (d.patient_adresse?.value) lines.push(`Adresse : ${d.patient_adresse.value}`);
      if (d.patient_telephone?.value) lines.push(`Tél : ${d.patient_telephone.value}`);
      if (d.patient_telephone2?.value) lines.push(`Tél 2 : ${d.patient_telephone2.value}`);
      if (d.patient_email?.value) lines.push(`Email : ${d.patient_email.value}`);
      if (d.representant_legal?.value) lines.push(`Repr. légal : ${d.representant_legal.value}`);
      lines.push('');
      if (d.client_type?.value) lines.push(`Type client : ${d.client_type.value}`);
      if (d.client_name?.value) lines.push(`Assureur : ${d.client_name.value}`);
      if (d.contact_gestionnaire?.value) lines.push(`Gestionnaire : ${d.contact_gestionnaire.value}`);
      if (d.reference_client?.value) lines.push(`Réf. client : ${d.reference_client.value}`);
      if (d.date_sinistre?.value) lines.push(`Date sinistre : ${d.date_sinistre.value}`);
      if (d.date_souscription?.value) lines.push(`Date souscription : ${d.date_souscription.value}`);
      if (d.blessures?.value) lines.push(`Blessures : ${d.blessures.value}`);

      navigator.clipboard.writeText(lines.join('\n')).then(() => {
        newCopy.textContent = '✓ Copié !';
        newCopy.classList.add('copied');
        setTimeout(() => { newCopy.textContent = '📋 Copier tout'; newCopy.classList.remove('copied'); }, 1500);
      });
    });
  } else {
    copyBtn.style.display = 'none';
  }

  // Fields
  const fieldsEl = document.getElementById('detailFields');
  if (m.data) {
    fieldsEl.innerHTML = Object.entries(m.data).map(([key, field]) => {
      if (!field?.value) return '';
      const conf = field.confidence || 0;
      const dotClass = conf >= 80 ? 'high' : conf >= 60 ? 'medium' : 'low';
      return `<div class="sp-field">
        <span class="sp-field-dot ${dotClass}"></span>
        <span class="sp-field-label">${FIELD_LABELS[key] || key}</span>
        <span class="sp-field-value"><input type="text" value="${esc(field.value)}" data-key="${key}" /></span>
        <span class="sp-field-conf">${conf}%</span>
      </div>`;
    }).join('');

    // Écouter les modifications
    fieldsEl.querySelectorAll('input').forEach(inp => {
      inp.addEventListener('change', async () => {
        const key = inp.dataset.key;
        const newVal = inp.value;
        const oldVal = m.data[key]?.value;
        if (newVal !== oldVal) {
          m.data[key].value = newVal;
          const corrections = [{ at: new Date().toISOString(), field: key, old_value: oldVal, new_value: newVal, machine: 'extension' }];
          await api(`/missions/${m.id}`, { method: 'PATCH', body: JSON.stringify({ data: m.data, corrections }) });
        }
      });
    });
  } else {
    fieldsEl.innerHTML = '<div style="color:var(--muted);font-size:11px;padding:8px 0;">Cliquer "Extraire" pour analyser le document</div>';
  }

  // Alerts
  const alertsSection = document.getElementById('alertsSection');
  const alertsEl = document.getElementById('detailAlerts');
  if (m.alerts?.length) {
    alertsSection.style.display = '';
    alertsEl.innerHTML = m.alerts.map(a =>
      `<div class="sp-alert ${a.severity}">${esc(a.message)}${a.field ? ` <small>(${FIELD_LABELS[a.field] || a.field})</small>` : ''}</div>`
    ).join('');
  } else {
    alertsSection.style.display = 'none';
  }

  // History
  const historyEl = document.getElementById('detailHistory');
  historyEl.innerHTML = (m.history || []).slice(-10).reverse().map(h => {
    const t = new Date(h.at);
    const time = `${t.getHours().toString().padStart(2,'0')}:${t.getMinutes().toString().padStart(2,'0')}`;
    return `<div class="sp-history-item">
      <span class="sp-history-time">${time}</span>
      <span class="sp-history-event">${esc(h.event.replace(/_/g, ' '))}</span>
      <span class="sp-history-machine">${esc(h.machine)}</span>
    </div>`;
  }).join('');

  // Meta
  const metaEl = document.getElementById('detailMeta');
  const rows = [
    ['Fichier', m.source.original_name],
    ['Taille', formatSize(m.source.size)],
    ['Hash', m.source.hash?.slice(0, 16) + '...'],
  ];
  if (m.extraction) {
    rows.push(['Provider', m.extraction.provider]);
    rows.push(['Modèle', m.extraction.model]);
    rows.push(['Durée', `${((m.extraction.duration_ms || 0) / 1000).toFixed(1)}s`]);
    rows.push(['Coût', `~${(m.extraction.cost_eur || 0).toFixed(4)}€`]);
    rows.push(['Prompt', m.extraction.prompt_version]);
  }
  rows.push(['Machine', m.meta.updated_by]);
  metaEl.innerHTML = rows.map(([l, v]) =>
    `<div class="sp-meta-row"><span class="sp-meta-label">${l}</span><span class="sp-meta-value">${esc(String(v || '—'))}</span></div>`
  ).join('');

  // Actions visibility
  const btnExtract = document.getElementById('btnExtract');
  const btnPreview = document.getElementById('btnPreview');
  const btnFill = document.getElementById('btnFill');
  const btnValidate = document.getElementById('btnValidate');
  const btnReject = document.getElementById('btnReject');
  const btnReview = document.getElementById('btnNeedsReview');

  btnExtract.style.display = ['new', 'queued', 'needs_review'].includes(m.status) ? '' : 'none';
  btnPreview.style.display = m.data ? '' : 'none';
  btnFill.style.display = ['ready_to_fill', 'needs_review'].includes(m.status) && m.data ? '' : 'none';
  btnValidate.style.display = ['filled', 'ready_to_fill'].includes(m.status) ? '' : 'none';
  btnReject.style.display = ['needs_review', 'ready_to_fill', 'filled'].includes(m.status) ? '' : 'none';
  btnReview.style.display = ['ready_to_fill', 'filled'].includes(m.status) ? '' : 'none';

  const btnRestore = document.getElementById('btnRestore');
  btnRestore.style.display = ['validated', 'rejected', 'filled', 'archived', 'duplicate'].includes(m.status) ? '' : 'none';

  // Wire actions
  wireActions(m);
}

function wireActions(m) {
  const btnExtract = document.getElementById('btnExtract');
  const btnPreview = document.getElementById('btnPreview');
  const btnFill = document.getElementById('btnFill');
  const btnValidate = document.getElementById('btnValidate');
  const btnReject = document.getElementById('btnReject');
  const btnReview = document.getElementById('btnNeedsReview');

  // Remove old listeners by cloning
  replaceBtn('btnExtract').addEventListener('click', async () => {
    const btn = document.getElementById('btnExtract');
    btn.disabled = true; btn.textContent = '⏳ Extraction...';
    try {
      await api(`/missions/${m.id}/extract`, { method: 'POST', body: JSON.stringify({ provider: 'claude' }) });
      // Poll until done
      await pollUntilExtracted(m.id);
      openDetail(m.id);
    } catch (err) {
      btn.textContent = '❌ ' + err.message;
    }
    btn.disabled = false;
  });

  replaceBtn('btnPreview').addEventListener('click', async () => {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab?.url?.includes('soon-expertise.fr')) {
      alert('Ouvrez soon-expertise.fr dans un onglet');
      return;
    }
    const flatData = flattenData(m.data);
    chrome.tabs.sendMessage(tab.id, { action: 'previewForm', data: flatData });
  });

  replaceBtn('btnFill').addEventListener('click', async () => {
    const btn = document.getElementById('btnFill');
    btn.disabled = true; btn.textContent = '⏳ Remplissage...';

    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab?.url?.includes('soon-expertise.fr')) {
      alert('Ouvrez soon-expertise.fr dans un onglet');
      btn.disabled = false; btn.textContent = '⚡ Remplir SOON';
      return;
    }

    const flatData = flattenData(m.data);
    chrome.storage.local.set({ currentMissionData: flatData });

    chrome.tabs.sendMessage(tab.id, { action: 'fillForm', data: flatData }, async (resp) => {
      if (chrome.runtime.lastError) {
        // Auto-reload
        chrome.runtime.sendMessage({ action: 'reloadAndFill', tabId: tab.id, data: flatData }, async (reloadResp) => {
          await handleFillResult(m.id, reloadResp);
          btn.disabled = false;
        });
      } else {
        await handleFillResult(m.id, resp);
        btn.disabled = false;
      }
    });
  });

  replaceBtn('btnValidate').addEventListener('click', async () => {
    await api(`/missions/${m.id}`, { method: 'PATCH', body: JSON.stringify({ status: 'validated' }) });
    openDetail(m.id);
  });

  replaceBtn('btnReject').addEventListener('click', async () => {
    await api(`/missions/${m.id}`, { method: 'PATCH', body: JSON.stringify({ status: 'rejected' }) });
    openDetail(m.id);
  });

  replaceBtn('btnNeedsReview').addEventListener('click', async () => {
    await api(`/missions/${m.id}`, { method: 'PATCH', body: JSON.stringify({ status: 'needs_review' }) });
    openDetail(m.id);
  });

  replaceBtn('btnRestore').addEventListener('click', async () => {
    await api(`/missions/${m.id}`, { method: 'PATCH', body: JSON.stringify({ status: 'ready_to_fill' }) });
    openDetail(m.id);
  });
}

async function handleFillResult(missionId, resp) {
  if (resp?.success) {
    await api(`/missions/${missionId}`, { method: 'PATCH', body: JSON.stringify({ status: 'filled' }) });
    openDetail(missionId);
  } else {
    const btn = document.getElementById('btnFill');
    btn.textContent = '❌ Erreur : ' + (resp?.error || 'inconnue');
    setTimeout(() => { btn.textContent = '⚡ Remplir SOON'; }, 3000);
  }
}

async function pollUntilExtracted(id, maxWait = 60000) {
  const start = Date.now();
  while (Date.now() - start < maxWait) {
    await new Promise(r => setTimeout(r, 2000));
    const m = await api(`/missions/${id}`);
    if (!['processing', 'queued'].includes(m.status)) return m;
  }
  throw new Error('Timeout extraction');
}

// ── Back button ──
document.getElementById('btnBack').addEventListener('click', () => {
  currentMissionId = null;
  document.getElementById('missionDetail').style.display = 'none';
  document.getElementById('missionList').style.display = '';
  document.querySelector('.sp-search').style.display = '';
  loadMissions();
});

// ── Stats ──
async function loadStats() {
  try {
    const s = await api('/stats');
    document.getElementById('sTotal').textContent = s.total;
    document.getElementById('sMonth').textContent = s.this_month;
    document.getElementById('sCost').textContent = (s.avg_cost_eur * s.total).toFixed(2) + '€';
    document.getElementById('sAvgTime').textContent = ((s.avg_duration_ms || 0) / 1000).toFixed(1) + 's';

    const barsEl = document.getElementById('sAssurers');
    const entries = Object.entries(s.by_assurer || {}).sort((a, b) => b[1] - a[1]);
    const max = entries[0]?.[1] || 1;
    barsEl.innerHTML = entries.map(([name, count]) =>
      `<div class="sp-bar-row">
        <span class="sp-bar-label">${esc(name)}</span>
        <div class="sp-bar-wrap"><div class="sp-bar-fill" style="width:${(count / max * 100).toFixed(0)}%"></div></div>
        <span class="sp-bar-count">${count}</span>
      </div>`
    ).join('') || '<div style="color:var(--muted);font-size:11px;">Aucune donnée</div>';
  } catch {}
}

// ── Badges ──
async function updateBadges() {
  try {
    const data = await api('/health');
    const s = data.missions_by_status || {};
    document.getElementById('badgeInbox').textContent = (s.new || 0) + (s.queued || 0);
    document.getElementById('badgeReview').textContent = s.needs_review || 0;
    document.getElementById('badgeReady').textContent = s.ready_to_fill || 0;
  } catch {}
}

// ── Connection status ──
function updateConnStatus(connected) {
  const dot = document.getElementById('connDot');
  const label = document.getElementById('connLabel');
  dot.className = 'sp-dot ' + (connected ? 'green' : 'red');
  label.textContent = connected ? 'Connecté' : 'Déconnecté';
}

// ── Auto-refresh ──
setInterval(() => {
  if (!currentMissionId) loadMissions(document.getElementById('searchInput').value);
  updateBadges();
}, 5000);

// ── Listen for background updates ──
chrome.runtime.onMessage.addListener((msg) => {
  if (msg.action === 'agentStatus') {
    updateConnStatus(msg.connected);
    if (msg.connected && msg.counts) {
      document.getElementById('badgeInbox').textContent = msg.counts.new || 0;
      document.getElementById('badgeReview').textContent = msg.counts.review || 0;
      document.getElementById('badgeReady').textContent = msg.counts.ready || 0;
    }
  }
});

// ── Helpers ──
function flattenData(data) {
  if (!data) return {};
  const flat = {};
  for (const [key, field] of Object.entries(data)) {
    flat[key] = field?.value || null;
  }
  return flat;
}

function getAvgConfidence(m) {
  if (!m.data) return 0;
  const scores = Object.values(m.data).map(f => f?.confidence || 0).filter(s => s > 0);
  return scores.length ? Math.round(scores.reduce((a, b) => a + b, 0) / scores.length) : 0;
}

function getStatusIcon(status) {
  const icons = { new: '📥', queued: '⏳', processing: '🔄', needs_review: '⚠️', ready_to_fill: '✅', filled: '📝', validated: '✓', rejected: '❌', duplicate: '🔁', archived: '📦' };
  return icons[status] || '📄';
}

function timeAgo(isoDate) {
  const diff = Date.now() - new Date(isoDate).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'à l\'instant';
  if (mins < 60) return `${mins}m`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h`;
  const days = Math.floor(hours / 24);
  return `${days}j`;
}

function formatSize(bytes) {
  if (bytes < 1024) return bytes + ' o';
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' Ko';
  return (bytes / (1024 * 1024)).toFixed(1) + ' Mo';
}

function esc(s) { const d = document.createElement('div'); d.textContent = s || ''; return d.innerHTML; }

// ── PDF Preview ──
async function loadPdfPreview(m) {
  const section = document.getElementById('pdfSection');
  const container = document.getElementById('pdfContainer');
  const frame = document.getElementById('pdfFrame');
  const toggle = document.getElementById('pdfToggle');

  try {
    const fileData = await api(`/missions/${m.id}/file-base64`);

    if (fileData.mime === 'application/pdf') {
      // PDF → afficher dans un iframe avec data URL
      frame.src = `data:application/pdf;base64,${fileData.base64}`;
      frame.style.display = '';
      // Supprimer une éventuelle image précédente
      container.querySelector('.sp-pdf-img')?.remove();
    } else {
      // Image → afficher directement
      frame.style.display = 'none';
      container.querySelector('.sp-pdf-img')?.remove();
      const img = document.createElement('img');
      img.className = 'sp-pdf-img';
      img.src = `data:${fileData.mime};base64,${fileData.base64}`;
      container.appendChild(img);
    }

    section.style.display = '';
    container.classList.remove('collapsed');
    toggle.textContent = '▼ Masquer';

    // Toggle
    const newToggle = toggle.cloneNode(true);
    toggle.replaceWith(newToggle);
    newToggle.addEventListener('click', () => {
      const collapsed = container.classList.toggle('collapsed');
      newToggle.textContent = collapsed ? '▶ Afficher' : '▼ Masquer';
    });

  } catch (err) {
    section.style.display = 'none';
    console.warn('Could not load PDF preview', err);
  }
}

function replaceBtn(id) {
  const old = document.getElementById(id);
  const clone = old.cloneNode(true);
  old.replaceWith(clone);
  return clone;
}
