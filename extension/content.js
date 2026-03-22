// content.js - Soon Expertise v3.0

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.action === 'fillForm') {
    fillForm(msg.data)
      .then((feedback) => sendResponse({ success: true, feedback }))
      .catch(err => sendResponse({ success: false, error: err.message }));
  }
  if (msg.action === 'previewForm') {
    previewForm(msg.data);
    sendResponse({ success: true });
  }
  return true;
});

// ── Feedback tracker ──
class FillTracker {
  constructor() { this.filled = []; this.skipped = []; }
  ok(label) { this.filled.push(label); }
  skip(label, reason) { this.skipped.push(label + (reason ? ' — ' + reason : '')); }
  result() { return { filled: this.filled, skipped: this.skipped }; }
}

// ── Utilitaires React ──
function waitForReact(ms = 300) { return new Promise(r => setTimeout(r, ms)); }

function setReactInput(el, value) {
  if (!el || value === null || value === undefined) return false;
  const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
  const setter = Object.getOwnPropertyDescriptor(proto, 'value')?.set;
  if (setter) setter.call(el, value); else el.value = value;
  el.dispatchEvent(new Event('input', { bubbles: true }));
  el.dispatchEvent(new Event('change', { bubbles: true }));
  el.dispatchEvent(new Event('blur', { bubbles: true }));
  return true;
}

function setReactSelect(sel, target) {
  if (!sel || !target) return false;
  const ct = clean(target);
  for (const opt of sel.options) {
    if (clean(opt.text).includes(ct) || clean(opt.value).includes(ct)) {
      sel.value = opt.value;
      sel.dispatchEvent(new Event('change', { bubbles: true }));
      return true;
    }
  }
  return false;
}

// Fuzzy match pour les noms d'assureurs
function fuzzyMatchAssurer(extracted, optionText) {
  const a = clean(extracted), b = clean(optionText);
  if (!a || !b) return false;
  if (a === b) return true;
  if (b.includes(a) || a.includes(b)) return true;
  // Match sur les 3 premiers caractères (MAIF, AXA, MMA, GMF...)
  if (a.length >= 3 && b.startsWith(a.slice(0, 3))) return true;
  if (b.length >= 3 && a.startsWith(b.slice(0, 3))) return true;
  return false;
}

async function selectCustomDropdown(containerLabel, targetText) {
  if (!targetText) return false;
  const normalTarget = clean(targetText);
  const wrappers = document.querySelectorAll(
    '[class*="select"], [class*="Select"], [class*="dropdown"], [class*="Dropdown"], [role="combobox"], [role="listbox"]'
  );
  for (const wrapper of wrappers) {
    const label = getLabelFor(wrapper);
    if (!label.includes(containerLabel.toLowerCase())) continue;
    const click = wrapper.querySelector('[class*="control"], [class*="indicator"], [class*="placeholder"], [class*="value"]') || wrapper;
    click.click();
    await waitForReact(400);
    const options = document.querySelectorAll('[class*="option"], [class*="Option"], [role="option"], [class*="menu"] div[id], [class*="Menu"] div[id]');
    for (const opt of options) {
      if (fuzzyMatchAssurer(targetText, opt.textContent)) {
        opt.click(); await waitForReact(300); return true;
      }
    }
    // Recherche dans input
    const si = wrapper.querySelector('input');
    if (si) {
      setReactInput(si, targetText);
      await waitForReact(600);
      const opts2 = document.querySelectorAll('[class*="option"], [class*="Option"], [role="option"]');
      for (const opt of opts2) {
        if (fuzzyMatchAssurer(targetText, opt.textContent)) {
          opt.click(); await waitForReact(300); return true;
        }
      }
    }
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    await waitForReact(200);
  }
  return false;
}

function clickRadio(labelText) {
  if (!labelText) return false;
  const t = labelText.trim();
  // Méthode 1 : input[type="radio"]
  for (const radio of document.querySelectorAll('input[type="radio"]')) {
    if (radio.id) {
      const lbl = document.querySelector('label[for="' + radio.id + '"]');
      if (lbl?.textContent.trim() === t) { radio.click(); return true; }
    }
    const p = radio.parentElement;
    if (p) {
      if (p.textContent.trim() === t || p.textContent.trim().startsWith(t)) { radio.click(); return true; }
      const next = radio.nextElementSibling;
      if (next?.textContent.trim() === t) { radio.click(); return true; }
      const cont = radio.closest('label, [class*="radio"], [class*="Radio"]');
      if (cont?.textContent.trim() === t) { radio.click(); return true; }
    }
  }
  // Méthode 2 : texte leaf → parent radio
  for (const el of document.querySelectorAll('label, span, div, p')) {
    if (el.children.length === 0 && el.textContent.trim() === t) {
      const c = el.closest('div, label');
      if (c) { const r = c.querySelector('input[type="radio"]'); if (r) { r.click(); return true; } }
      const prev = el.previousElementSibling;
      if (prev?.type === 'radio') { prev.click(); return true; }
    }
  }
  // Méthode 3 : custom radio
  for (const cr of document.querySelectorAll('[role="radio"], [class*="radio-option"]')) {
    if (cr.textContent.trim() === t) { cr.click(); return true; }
  }
  return false;
}

function getLabelFor(el) {
  if (el.id) { const l = document.querySelector(`label[for="${el.id}"]`); if (l) return l.textContent.trim().toLowerCase(); }
  const al = el.getAttribute('aria-label'); if (al) return al.toLowerCase();
  let p = el.parentElement;
  for (let i = 0; i < 6 && p; i++) {
    const l = p.querySelector('label, [class*="label"], [class*="Label"]');
    if (l && !l.contains(el)) { const t = l.textContent.trim().toLowerCase(); if (t) return t; }
    const prev = p.previousElementSibling;
    if (prev?.children.length < 4) { const t = prev.textContent.trim().toLowerCase(); if (t) return t; }
    p = p.parentElement;
  }
  return '';
}

function clean(s) { return (s||'').toUpperCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/[^A-Z0-9]/g,''); }
function indexToRef(n) { return String.fromCharCode(65+Math.floor(n/99)) + String((n%99)+1).padStart(2,'0'); }

async function generateExpertRef(data) {
  const nom = clean(data.patient_nom).slice(0,2)||'XX';
  const prenom = clean(data.patient_prenom).slice(0,1)||'X';
  const assur = clean(data.client_name).slice(0,3)||'XXX';
  const y = String(new Date().getFullYear()).slice(-2);
  const prefix = `${nom}${prenom}-${assur}-${y}`;
  return new Promise(resolve => {
    chrome.storage.local.get(['expertRefIndex','expertRefYear'], r => {
      const cy = new Date().getFullYear();
      let i = 0;
      if (r.expertRefYear === cy && r.expertRefIndex !== undefined) i = r.expertRefIndex + 1;
      chrome.storage.local.set({ expertRefIndex: i, expertRefYear: cy });
      resolve(`${prefix}-${indexToRef(i)}`);
    });
  });
}

function escapeHtml(s) { const d = document.createElement('div'); d.textContent = s; return d.innerHTML; }

// Applique le template de notes
function applyNoteTemplate(template, data) {
  if (!template) return 'Blessures signalées : ' + (data.blessures || '');
  return template.replace(/\{(\w+)\}/g, (_, key) => data[key] || '');
}

// ── PREVIEW MODE ──
function previewForm(data) {
  // Supprimer un ancien preview
  document.getElementById('soon-preview-overlay')?.remove();

  const overlay = document.createElement('div');
  overlay.id = 'soon-preview-overlay';
  overlay.style.cssText = 'position:fixed;top:0;right:0;width:320px;height:100vh;background:rgba(13,17,23,0.95);z-index:99999;overflow-y:auto;font-family:system-ui,sans-serif;color:#e6edf3;border-left:2px solid #00d4aa;padding:16px;';

  const LABELS = {
    client_type:'Type client', client_name:'Assureur', contact_gestionnaire:'Gestionnaire',
    reference_client:'Réf. client', date_sinistre:'Date sinistre', date_souscription:'Souscription',
    patient_civilite:'Civilité', patient_sexe:'Sexe', patient_prenom:'Prénom', patient_nom:'Nom',
    patient_dob:'Naissance', patient_adresse:'Adresse', patient_telephone:'Tél.',
    patient_telephone2:'Tél. 2', patient_email:'Email', representant_legal:'Repr. légal', blessures:'Blessures'
  };

  let html = '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px;">';
  html += '<div style="font-size:14px;font-weight:700;color:#00d4aa;">👁 Prévisualisation</div>';
  html += '<button id="soon-preview-close" style="background:none;border:none;color:#7d8590;font-size:18px;cursor:pointer;">✕</button></div>';

  for (const [key, val] of Object.entries(data)) {
    if (!val || key.startsWith('_')) continue;
    html += `<div style="margin-bottom:8px;padding:8px 10px;background:rgba(255,255,255,0.05);border-radius:6px;">`;
    html += `<div style="font-size:9px;color:#7d8590;text-transform:uppercase;margin-bottom:2px;">${LABELS[key]||key}</div>`;
    html += `<div style="font-size:12px;font-weight:600;">${escapeHtml(String(val))}</div></div>`;
  }

  html += '<div style="display:flex;gap:8px;margin-top:16px;">';
  html += '<button id="soon-preview-confirm" style="flex:1;padding:10px;background:linear-gradient(135deg,#00d4aa,#0099ff);border:none;border-radius:8px;color:#0d1117;font-weight:700;font-size:12px;cursor:pointer;">⚡ Confirmer et remplir</button>';
  html += '<button id="soon-preview-cancel" style="padding:10px 14px;background:#21262d;border:none;border-radius:8px;color:#7d8590;font-size:12px;cursor:pointer;">Annuler</button>';
  html += '</div>';

  overlay.innerHTML = html;
  document.body.appendChild(overlay);

  document.getElementById('soon-preview-close').addEventListener('click', () => overlay.remove());
  document.getElementById('soon-preview-cancel').addEventListener('click', () => overlay.remove());
  document.getElementById('soon-preview-confirm').addEventListener('click', () => {
    overlay.remove();
    fillForm(data).then(fb => {
      chrome.runtime.sendMessage({ action: 'fillDone', feedback: fb });
    });
  });
}

// ── FILL FORM ──
async function fillForm(data) {
  const t = new FillTracker();
  const noteTemplate = data._noteTemplate || '';

  // 1. Type client
  if (data.client_type) {
    if (clickRadio(data.client_type)) t.ok('Type : ' + data.client_type);
    else t.skip('Type client', 'non trouvé');
    await waitForReact(500);
  }

  // 2. Client dropdown (assureur) — fuzzy match
  if (data.client_name) {
    let filled = false;
    for (const sel of document.querySelectorAll('select')) {
      const label = getLabelFor(sel);
      if (label.includes('client') && !label.includes('contact')) {
        // Fuzzy match sur les options
        for (const opt of sel.options) {
          if (fuzzyMatchAssurer(data.client_name, opt.text)) {
            sel.value = opt.value;
            sel.dispatchEvent(new Event('change', { bubbles: true }));
            filled = true; break;
          }
        }
        if (filled) break;
      }
    }
    if (!filled) filled = await selectCustomDropdown('client', data.client_name);
    if (filled) t.ok('Client : ' + data.client_name);
    else t.skip('Client dropdown', 'non trouvé');
    await waitForReact(400);
  }

  // 3. Contact gestionnaire
  if (data.contact_gestionnaire) {
    let filled = false;
    for (const sel of document.querySelectorAll('select')) {
      const label = getLabelFor(sel);
      if (label.includes('contact') && label.includes('client')) {
        filled = setReactSelect(sel, data.contact_gestionnaire);
        if (filled) break;
      }
    }
    if (!filled) filled = await selectCustomDropdown('contact', data.contact_gestionnaire);
    if (filled) t.ok('Gestionnaire : ' + data.contact_gestionnaire);
    else t.skip('Gestionnaire', 'non trouvé dans le dropdown');
    await waitForReact(300);
  }

  // 4. Civilité
  if (data.patient_civilite) {
    if (clickRadio(data.patient_civilite)) t.ok('Civilité : ' + data.patient_civilite);
    else t.skip('Civilité', 'non trouvé');
    await waitForReact(300);
  }

  // 5. Sexe
  const isFemale = data.patient_sexe === 'F' || data.patient_civilite === 'Madame';
  const isMale = data.patient_sexe === 'M' || data.patient_civilite === 'Monsieur';
  if (isFemale || isMale) {
    const labels = isFemale ? ['Féminin','Femme','F','féminin','femme'] : ['Masculin','Homme','M','masculin','homme'];
    let filled = false;
    for (const l of labels) { if (clickRadio(l)) { filled = true; break; } }
    if (!filled) {
      for (const sel of document.querySelectorAll('select')) {
        const sl = getLabelFor(sel);
        if (sl.includes('sexe') || sl.includes('genre')) {
          const targets = isFemale ? ['F','FEMININ','FEMME','2'] : ['M','MASCULIN','HOMME','1'];
          for (const opt of sel.options) {
            if (targets.some(v => opt.value.toUpperCase().includes(v) || opt.text.toUpperCase().includes(v))) {
              sel.value = opt.value; sel.dispatchEvent(new Event('change', { bubbles: true }));
              filled = true; break;
            }
          }
          if (filled) break;
        }
      }
    }
    if (!filled) filled = await selectCustomDropdown('sexe', isFemale ? 'Féminin' : 'Masculin');
    if (filled) t.ok('Sexe : ' + (isFemale ? 'F' : 'M'));
    else t.skip('Sexe', 'champ non trouvé');
    await waitForReact(200);
  }

  // 6. Référence expert
  const expertRef = await generateExpertRef(data);

  // 7. Inputs texte
  const allInputs = Array.from(document.querySelectorAll(
    'input[type="text"], input[type="tel"], input[type="email"], input[type="number"], input:not([type])'
  )).filter(el => el.offsetParent !== null && !['radio','checkbox','hidden'].includes(el.type));

  let telFilled = false, tel2Filled = false;

  for (const input of allInputs) {
    const ph = (input.getAttribute('placeholder')||'').toLowerCase();
    const lb = getLabelFor(input);
    const c = lb + ' ' + ph;

    if (c.includes('complément') || c.includes('complement')) continue;

    if (c.includes('référence client') || c.includes('reference client')) {
      if (data.reference_client) { setReactInput(input, data.reference_client); t.ok('Réf. client'); } else t.skip('Réf. client', 'absent');
    }
    else if (c.includes('référence expert') || c.includes('reference expert')) {
      setReactInput(input, expertRef); t.ok('Réf. expert : ' + expertRef);
    }
    else if (c.includes('autre référence') || c.includes('autre reference')) { /* skip */ }
    else if (c.includes('prénom') || c.includes('prenom') || ph.includes('prénom')) {
      if (data.patient_prenom) { setReactInput(input, data.patient_prenom); t.ok('Prénom'); } else t.skip('Prénom', 'absent');
    }
    else if (c.includes('nom de famille') || c.includes('lastname') || (c.includes('nom') && !c.includes('prénom') && !c.includes('prenom') && !c.includes('référence') && !c.includes('reference'))) {
      if (data.patient_nom) { setReactInput(input, data.patient_nom); t.ok('Nom'); } else t.skip('Nom', 'absent');
    }
    else if (c.includes('représentant') || c.includes('representant') || c.includes('légal') || c.includes('legal')) {
      if (data.representant_legal) { setReactInput(input, data.representant_legal); t.ok('Repr. légal'); }
    }
    else if ((c.includes('autre') && (c.includes('téléphone') || c.includes('telephone') || c.includes('phone'))) && !tel2Filled) {
      if (data.patient_telephone2) { setReactInput(input, data.patient_telephone2); t.ok('Tél. 2'); tel2Filled = true; }
    }
    else if ((c.includes('téléphone') || c.includes('telephone') || c.includes('phone') || input.type === 'tel') && !telFilled) {
      if (data.patient_telephone) { setReactInput(input, data.patient_telephone); t.ok('Téléphone'); } else t.skip('Téléphone', 'absent');
      telFilled = true;
    }
    else if (c.includes('adresse') || ph.includes('adresse') || ph.includes('saisiss')) {
      if (data.patient_adresse) {
        setReactInput(input, data.patient_adresse); t.ok('Adresse');
        await waitForReact(600);
        const sugg = document.querySelectorAll('[class*="suggestion"], [class*="Suggestion"], [class*="autocomplete"] li, [role="option"], [class*="pac-item"]');
        if (sugg.length > 0) { sugg[0].click(); await waitForReact(300); }
      } else t.skip('Adresse', 'absente');
    }
    else if ((c.includes('email') || c.includes('mail') || input.type === 'email') && data.patient_email) {
      setReactInput(input, data.patient_email); t.ok('Email');
    }
    await waitForReact(80);
  }

  // 8. Dates
  const dateInputs = Array.from(document.querySelectorAll(
    'input[placeholder="JJ/MM/AAAA"], input[type="date"], input[placeholder*="jj/mm"]'
  )).filter(el => el.offsetParent !== null);

  const dm = {};
  for (const di of dateInputs) {
    const lb = getLabelFor(di);
    if ((lb.includes('sinistre') || lb.includes('accident')) && data.date_sinistre) { setReactInput(di, data.date_sinistre); dm.s = true; t.ok('Date sinistre'); }
    else if ((lb.includes('naissance') || lb.includes('birth')) && data.patient_dob) { setReactInput(di, data.patient_dob); dm.n = true; t.ok('Date naissance'); }
    else if ((lb.includes('souscription')) && data.date_souscription) { setReactInput(di, data.date_souscription); dm.sub = true; t.ok('Date souscription'); }
    await waitForReact(100);
  }
  // Fallback positionnel
  if (!dm.s && dateInputs[0] && data.date_sinistre) { setReactInput(dateInputs[0], data.date_sinistre); t.ok('Date sinistre (pos.)'); }
  if (!dm.sub && dateInputs[1] && !dateInputs[1].value && data.date_souscription) { setReactInput(dateInputs[1], data.date_souscription); t.ok('Date souscription (pos.)'); }
  if (!dm.n && dateInputs[2] && !dateInputs[2].value && data.patient_dob) { setReactInput(dateInputs[2], data.patient_dob); t.ok('Date naissance (pos.)'); }
  if (!data.date_sinistre) t.skip('Date sinistre', 'absente');
  if (!data.patient_dob) t.skip('Date naissance', 'absente');

  // 9. Notes (template configurable)
  if (data.blessures) {
    const noteText = applyNoteTemplate(noteTemplate, data);
    let filled = false;

    // Textarea
    const tas = Array.from(document.querySelectorAll('textarea')).filter(el => el.offsetParent !== null);
    for (const ta of tas) {
      const lb = getLabelFor(ta);
      if (lb.includes('note') || lb.includes('remarque') || lb.includes('commentaire')) {
        setReactInput(ta, noteText); t.ok('Notes'); filled = true; break;
      }
    }
    // Rich text
    if (!filled) {
      const eds = document.querySelectorAll('[contenteditable="true"], .ProseMirror, .ql-editor, [role="textbox"]');
      for (const ed of eds) {
        const lb = getLabelFor(ed);
        if (lb.includes('note') || lb.includes('mes notes') || eds.length === 1) {
          ed.focus();
          ed.innerHTML = '<p>' + escapeHtml(noteText) + '</p>';
          ed.dispatchEvent(new Event('input', { bubbles: true }));
          t.ok('Notes (rich text)'); filled = true; break;
        }
      }
    }
    // Fallback
    if (!filled && tas.length > 0) { setReactInput(tas[tas.length - 1], noteText); t.ok('Notes (fallback)'); filled = true; }
    if (!filled) t.skip('Notes', 'éditeur non trouvé');
  }

  await waitForReact(300);
  return t.result();
}
