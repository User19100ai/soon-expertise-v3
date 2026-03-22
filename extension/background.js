// background.js — Soon Expertise v3.0 Service Worker

const API_BASE = 'http://127.0.0.1:9721';
let authToken = '';
let lastMissionCount = 0;

// ── Init ──
chrome.storage.local.get(['agentToken'], (res) => {
  authToken = res.agentToken || '';
  pollAgent();
});

// ── Polling agent toutes les 5s ──
setInterval(pollAgent, 5000);

async function pollAgent() {
  try {
    const resp = await fetch(`${API_BASE}/health`);
    if (!resp.ok) throw new Error('not ok');
    const data = await resp.json();

    const newCount = (data.missions_by_status?.new || 0) + (data.missions_by_status?.queued || 0);
    const reviewCount = data.missions_by_status?.needs_review || 0;
    const readyCount = data.missions_by_status?.ready_to_fill || 0;

    // Badge
    const total = newCount + reviewCount + readyCount;
    if (total > 0) {
      chrome.action.setBadgeText({ text: String(total) });
      chrome.action.setBadgeBackgroundColor({ color: reviewCount > 0 ? '#f0a030' : '#00d4aa' });
    } else {
      chrome.action.setBadgeText({ text: '' });
    }

    // Notifier le side panel si ouvert
    chrome.runtime.sendMessage({
      action: 'agentStatus',
      connected: true,
      counts: { new: newCount, review: reviewCount, ready: readyCount, total: data.missions_count },
    }).catch(() => {});

    lastMissionCount = data.missions_count;
  } catch {
    chrome.action.setBadgeText({ text: '!' });
    chrome.action.setBadgeBackgroundColor({ color: '#ff6b6b' });
    chrome.runtime.sendMessage({ action: 'agentStatus', connected: false }).catch(() => {});
  }
}

// ── Messages ──
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.action === 'openSidePanel') {
    chrome.sidePanel.open({ windowId: sender.tab?.windowId || chrome.windows.WINDOW_ID_CURRENT });
  }
  if (msg.action === 'reloadAndFill') {
    reloadAndFill(msg.tabId, msg.data).then(sendResponse);
    return true;
  }
  if (msg.action === 'getAgentToken') {
    sendResponse({ token: authToken });
  }
  if (msg.action === 'setAgentToken') {
    authToken = msg.token;
    chrome.storage.local.set({ agentToken: msg.token });
    pollAgent();
  }
});

// ── Raccourci clavier ──
chrome.commands.onCommand.addListener(async (command) => {
  if (command === 'fill-form') {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab?.url?.includes('soon-expertise.fr')) return;
    const res = await chrome.storage.local.get(['currentMissionData']);
    if (!res.currentMissionData) return;
    try {
      await chrome.tabs.sendMessage(tab.id, { action: 'fillForm', data: res.currentMissionData });
    } catch {
      await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ['content.js'] });
      await new Promise(r => setTimeout(r, 500));
      await chrome.tabs.sendMessage(tab.id, { action: 'fillForm', data: res.currentMissionData });
    }
  }
});

// ── Auto-reload ──
async function reloadAndFill(tabId, data) {
  try {
    await chrome.tabs.reload(tabId);
    await new Promise((resolve) => {
      const listener = (id, info) => {
        if (id === tabId && info.status === 'complete') {
          chrome.tabs.onUpdated.removeListener(listener);
          resolve();
        }
      };
      chrome.tabs.onUpdated.addListener(listener);
      setTimeout(() => { chrome.tabs.onUpdated.removeListener(listener); resolve(); }, 10000);
    });
    await new Promise(r => setTimeout(r, 1500));
    await chrome.scripting.executeScript({ target: { tabId }, files: ['content.js'] });
    await new Promise(r => setTimeout(r, 500));
    return await chrome.tabs.sendMessage(tabId, { action: 'fillForm', data });
  } catch (err) {
    return { success: false, error: err.message };
  }
}
