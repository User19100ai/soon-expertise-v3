// popup.js — Soon Expertise v3.0 Mini Dashboard

const statusEl = document.getElementById('agentStatus');
const statusDot = document.getElementById('statusDot');
const statusLabel = document.getElementById('statusLabel');
const cNew = document.getElementById('cNew');
const cReview = document.getElementById('cReview');
const cReady = document.getElementById('cReady');
const tokenInput = document.getElementById('tokenInput');
const saveTokenBtn = document.getElementById('saveToken');

// Charger le token
chrome.storage.local.get(['agentToken'], (res) => {
  if (res.agentToken) tokenInput.value = res.agentToken;
});

// Sauvegarder le token
saveTokenBtn.addEventListener('click', () => {
  const token = tokenInput.value.trim();
  if (token) {
    chrome.runtime.sendMessage({ action: 'setAgentToken', token });
    saveTokenBtn.textContent = '✓';
    setTimeout(() => saveTokenBtn.textContent = 'OK', 1200);
  }
});

// Ouvrir le Side Panel
document.getElementById('btnOpen').addEventListener('click', async () => {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (tab) {
    chrome.sidePanel.open({ tabId: tab.id });
    window.close();
  }
});

// Écouter les updates du background
chrome.runtime.onMessage.addListener((msg) => {
  if (msg.action === 'agentStatus') {
    updateStatus(msg);
  }
});

// Check initial
checkStatus();

async function checkStatus() {
  try {
    const resp = await fetch('http://127.0.0.1:9721/health');
    if (!resp.ok) throw new Error();
    const data = await resp.json();
    updateStatus({
      connected: true,
      counts: {
        new: (data.missions_by_status?.new || 0) + (data.missions_by_status?.queued || 0),
        review: data.missions_by_status?.needs_review || 0,
        ready: data.missions_by_status?.ready_to_fill || 0,
      }
    });
  } catch {
    updateStatus({ connected: false });
  }
}

function updateStatus(msg) {
  if (msg.connected) {
    statusEl.className = 'status ok';
    statusDot.className = 'dot green';
    statusLabel.textContent = 'Agent connecté';
    if (msg.counts) {
      cNew.textContent = msg.counts.new || 0;
      cReview.textContent = msg.counts.review || 0;
      cReady.textContent = msg.counts.ready || 0;
    }
  } else {
    statusEl.className = 'status err';
    statusDot.className = 'dot red';
    statusLabel.textContent = 'Agent déconnecté';
    cNew.textContent = '-';
    cReview.textContent = '-';
    cReady.textContent = '-';
  }
}
