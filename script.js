/* ─── Global State ─── */
let STATES = [];
let ICAO_C = {};
let currentCountry = null;
let manualEntry = false;
let acFocusIdx = -1;
let icaoEmail = '';

/* ─── Utility: Email Sanitization ─── */
function sanitizeForEmail(str) {
  if (!str) return '';
  return str
    .trim()
    .toLowerCase()
    .normalize("NFD")                   
    .replace(/[\u0300-\u036f]/g, "")    
    .replace(/[^a-z0-9]/g, "");         
}

function parseAlternateNames(note) {
  if (!note) return [];
  const matches = [];
  const regex = /alternate(?:s)?[:\s]+([^.;]+)/ig;
  let match;
  while ((match = regex.exec(note))) {
    const names = match[1].split(/[,;&]/).map(name => name.trim().replace(/^(?:and|or)\s+/i, '')).filter(Boolean);
    for (const name of names) {
      if (!/verify|note|chief|representative|alternate/i.test(name)) {
        matches.push(name);
      } else if (/^[A-Z][a-z]+\s+[A-Z][a-z]+/.test(name)) {
        matches.push(name);
      }
    }
  }
  return matches;
}

/* ─── Database Initialization ─── */
async function init() {
  try {
    const response = await fetch('https://acbrown98109.github.io/ICAO/icao-contacts-database.json');
    if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);
    
    const data = await response.json();
    STATES = data.member_states;
    ICAO_C = data.icao_offices;

    ['un-country', 'fmt-country'].forEach(id => {
      const s = document.getElementById(id);
      STATES.forEach(st => {
        const o = document.createElement('option');
        o.value = st.slug; 
        o.textContent = st.name + (st.council ? ' (Council Member)' : '');
        s.appendChild(o);
        
        if (st.rep && st.rep.note) {
          st.rep.alternates = parseAlternateNames(st.rep.note);
        }
      });
    });
  } catch (error) {
    console.error("Database load failed:", error);
    document.querySelector('.tab-bar').insertAdjacentHTML('afterend', 
      `<div class="warn-box show" style="max-width:1200px; margin:0 auto 24px;">⚠️ Error loading database. Please verify the URL path and JSON formatting.</div>`
    );
  }
}

/* ─── Country → Auto-fill Name ─── */
function countrySelected() {
  const slug = document.getElementById('un-country').value;
  if (!slug) { currentCountry = null; resetForm(); return; }
  
  currentCountry = STATES.find(s => s.slug === slug);
  manualEntry = false;

  const lookup = document.getElementById('lookup-box');
  const warn = document.getElementById('warn-box');

  if (currentCountry.rep) {
    const r = currentCountry.rep;
    setName(r.first, r.last, true);
    lookup.classList.remove('show');
    warn.classList.remove('show');
    if (r.note) {
      warn.innerHTML = `<strong>Registry Note:</strong> ${r.note}`;
      warn.classList.add('show');
    }
  } else {
    setName('', '', false);
    lookup.classList.add('show');
    warn.classList.remove('show');
  }
  buildEmail();
}

function setName(first, last, autofilled) {
  document.getElementById('un-first').value = first;
  document.getElementById('un-last').value = last;
  const show = autofilled ? 'inline-block' : 'none';
  document.getElementById('first-src').style.display = show;
  document.getElementById('last-src').style.display = show;
}

/* ─── Name Autocomplete ─── */
function nameSearch(val) {
  const dd = document.getElementById('ac-dropdown');
  if (!val || val.length < 2) { dd.classList.remove('open'); return; }
  
  const q = val.toLowerCase();
  const matches = STATES.filter(s => {
    if (!s.rep) return false;
    const full = (s.rep.first + ' ' + s.rep.last).toLowerCase();
    const alternateMatches = (s.rep.alternates || []).some(a => a.toLowerCase().includes(q));
    return full.includes(q) || s.rep.first.toLowerCase().includes(q) || s.rep.last.toLowerCase().includes(q) || alternateMatches;
  });
  
  if (!matches.length) { dd.classList.remove('open'); return; }
  
  dd.innerHTML = matches.map((s, i) => {
    const altLabel = s.rep.alternates && s.rep.alternates.length 
      ? `<span class="badge badge-gray">Alt: ${s.rep.alternates.slice(0,2).join(', ')}</span>` : '';
    return `<div class="ac-item" data-slug="${s.slug}" data-idx="${i}" 
      onclick="selectAcItem('${s.slug}')" 
      onmouseenter="acFocusIdx=${i};renderAc()">
      <div class="ac-country">${s.rep.first} ${s.rep.last} 
        ${s.council ? '<span class="badge badge-green">Council</span>' : ''} 
        ${altLabel}
      </div>
      <div class="ac-title">${s.name} | ${s.slug}un.int</div>
    </div>`;
  }).join('');
  
  dd.classList.add('open');
  acFocusIdx = -1;
}

function renderAc() {
  document.querySelectorAll('.ac-item').forEach((el, i) => {
    el.classList.toggle('focused', i === acFocusIdx);
  });
}

function acKeydown(e) {
  const dd = document.getElementById('ac-dropdown');
  const items = dd.querySelectorAll('.ac-item');
  if (!items.length) return;
  
  if (e.key === 'ArrowDown') { acFocusIdx = Math.min(acFocusIdx + 1, items.length - 1); e.preventDefault(); }
  else if (e.key === 'ArrowUp') { acFocusIdx = Math.max(acFocusIdx - 1, 0); e.preventDefault(); }
  else if (e.key === 'Enter' && acFocusIdx >= 0) { items[acFocusIdx].click(); e.preventDefault(); return; }
  else if (e.key === 'Escape') { dd.classList.remove('open'); return; }
  renderAc();
}

function selectAcItem(slug) {
  currentCountry = STATES.find(x => x.slug === slug);
  manualEntry = false;
  document.getElementById('un-country').value = slug;
  document.getElementById('name-search').value = '';
  document.getElementById('ac-dropdown').classList.remove('open');
  
  setName(currentCountry.rep.first, currentCountry.rep.last, true);
  document.getElementById('lookup-box').classList.remove('show');
  
  const warn = document.getElementById('warn-box');
  if (currentCountry.rep.note) {
    warn.innerHTML = `<strong>Registry Note:</strong> ${currentCountry.rep.note}`;
    warn.classList.add('show');
  } else {
    warn.classList.remove('show');
  }
  buildEmail();
}

/* ─── Build UN Mission Email ─── */
function buildEmail() {
  const firstInput = document.getElementById('un-first').value;
  const lastInput = document.getElementById('un-last').value;
  
  const first = sanitizeForEmail(firstInput);
  const last = sanitizeForEmail(lastInput);
  
  const country = currentCountry;
  const subj = document.getElementById('un-subject').value.trim();
  const box = document.getElementById('un-result');

  if (!first || !last || !country) { box.classList.remove('show'); return; }

  const primary = `${first}.${last}@${country.slug}un.int`;

  document.getElementById('primary-email').textContent = primary;
  document.getElementById('alt-emails').innerHTML = `
    <div class="alt-row">
       <span class="alt-label">CAA Routing</span>
       <span class="alt-addr">${first}.${last}@${country.caa}</span>
    </div>
    <div class="alt-row">
       <span class="alt-label">MFA Routing</span>
       <span class="alt-addr">${first}.${last}@${country.mfa}</span>
    </div>`;

  let delegationHtml = '';
  if (country.delegation_group) {
    delegationHtml = `
      <div style="background:#EBF3FA; border-left:3px solid #005BBB; padding:10px 14px; margin:12px 0; border-radius:2px;">
        <strong style="color:#002D62; text-transform:uppercase; font-size:0.8rem;">🌍 ${country.delegation_group.name} Member</strong><br>
        <span style="font-size:0.85rem; color:#546E7A;">
          On the ICAO Council, this state is currently represented by <strong>${country.delegation_group.represented_by}</strong> 
          (${country.delegation_group.council_rep}).
        </span>
      </div>
    `;
  }

  const isManual = !currentCountry.rep || (
    firstInput.trim().toLowerCase() !== currentCountry.rep.first.toLowerCase() ||
    lastInput.trim().toLowerCase() !== currentCountry.rep.last.toLowerCase()
  );

  document.getElementById('un-meta').innerHTML = `
    <strong>Member State:</strong> ${country.name} 
    ${country.council ? '&nbsp;<span class="badge badge-green">Council Member</span>' : ''}<br>
    <strong>Mission Domain:</strong> @${country.slug}un.int<br>
    <strong>Header Subject:</strong> ${subj || 'Not Specified'}
    ${delegationHtml}
  `;

  const w = document.getElementById('warn-box');
  if (isManual && !w.innerHTML.includes('Note:')) {
    w.innerHTML = '<strong>Notice:</strong> Name entered manually. Address verification recommended via <a href="https://www.icao.int/council-state-representatives" target="_blank" style="color:inherit; text-decoration:underline;">registry</a>.';
    w.classList.add('show');
  }

  box.classList.add('show');
  window._currentPrimary = primary;
  window._currentSubject = subj;
}

/* ─── Format Reference ─── */
function showFormats() {
  const slug = document.getElementById('fmt-country').value;
  if (!slug) return;
  const s = STATES.find(x => x.slug === slug);
  document.getElementById('fmt-country-name').textContent = s.name + ' — Routing Syntax';
  
  const known = s.rep
    ? `<p><strong>Cached Rep:</strong> ${s.rep.first} ${s.rep.last}${s.rep.note ? ' <em>(' + s.rep.note + ')</em>' : ''}</p>`
    : `<p style="color:var(--text-muted);font-size:.85rem;">Record unavailable. <br>
       Verify at: <a href="https://www.icao.int/council-state-representatives" target="_blank">Registry</a></p>`;
       
  document.getElementById('fmt-list').innerHTML = `
    <div class="fmt-grid">
      <div class="fmt-card">
        <h4>Mission Routing</h4>
        <code>firstname.lastname@${slug}un.int</code>
        ${known}
      </div>
      <div class="fmt-card">
        <h4>CAA Routing</h4>
        <code>firstname.lastname@${s.caa}</code>
        <p>Civil Aviation Authority domain mapping.</p>
      </div>
      <div class="fmt-card">
        <h4>MFA Routing</h4>
        <code>firstname.lastname@${s.mfa}</code>
        <p>Ministry of Foreign Affairs domain mapping.</p>
      </div>
    </div>`;
  document.getElementById('fmt-results').style.display = 'block';
}

/* ─── ICAO Internal Generator ─── */
function icaoSecondary() {
  const type = document.getElementById('icao-type').value;
  const sec = document.getElementById('icao-sec2');
  sec.innerHTML = '';
  document.getElementById('icao-result').classList.remove('show');
  
  if (type === 'hq') { buildIcaoEmail(); return; }
  
  const src = { regional: ICAO_C.regional, department: ICAO_C.department, leadership: ICAO_C.leadership };
  if (!src[type]) return;
  
  let html = `
    <div class="form-row">
      <label>Select ${type.charAt(0).toUpperCase() + type.slice(1)}</label>
      <select id="icao-dynamic-select" onchange="buildIcaoEmail()">
        <option value="">-- Select --</option>`;
  
  for (const k in src[type]) { html += `<option value="${k}">${k}</option>`; }
  html += `</select></div>`;
  sec.innerHTML = html;
}

function buildIcaoEmail() {
  const type = document.getElementById('icao-type').value;
  if (!type) return;
  
  let c = null, label = '';
  
  if (type === 'hq') {
    c = ICAO_C.hq; 
    label = 'Headquarters';
  } else {
    const src = { regional: ICAO_C.regional, department: ICAO_C.department, leadership: ICAO_C.leadership };
    const sel = document.getElementById('icao-dynamic-select');
    if (!sel || !sel.value) return;
    c = src[type][sel.value];
    label = sel.value;
  }
  
  if (!c) return;
  
  icaoEmail = c.email;
  document.getElementById('icao-email-disp').textContent = c.email;
  
  let m = `<strong>Target:</strong> ${label}<br>`;
  if (c.phone) m += `<strong>Switchboard:</strong> ${c.phone}<br>`;
  if (c.addr) m += `<strong>Location:</strong> ${c.addr}<br>`;
  if (c.note) m += `<strong>Directive:</strong> ${c.note}`;
  
  document.getElementById('icao-meta').innerHTML = m;
  document.getElementById('icao-result').classList.add('show');
}

/* ─── UI Utilities ─── */
function copyText(elId, toastId) {
  const val = document.getElementById(elId).textContent.trim();
  if (!val || val === '—') return;
  navigator.clipboard.writeText(val).then(() => {
    const t = document.getElementById(toastId);
    t.classList.add('show');
    setTimeout(() => t.classList.remove('show'), 2800);
  });
}

function openMailto() {
  const email = window._currentPrimary;
  if (!email) return;
  const subj = window._currentSubject || '';
  window.location.href = subj ? `mailto:${email}?subject=${encodeURIComponent(subj)}` : `mailto:${email}`;
}

function icaoMailto() {
  if (icaoEmail) window.location.href = `mailto:${icaoEmail}`;
}

function resetForm() {
  ['un-first', 'un-last', 'un-country', 'un-subject', 'name-search'].forEach(id => {
    const e = document.getElementById(id); if (e) e.value = '';
  });
  document.getElementById('un-result').classList.remove('show');
  document.getElementById('lookup-box').classList.remove('show');
  document.getElementById('warn-box').classList.remove('show');
  document.getElementById('ac-dropdown').classList.remove('open');
  document.getElementById('first-src').style.display = 'none';
  document.getElementById('last-src').style.display = 'none';
  currentCountry = null; 
  manualEntry = false; 
  window._currentPrimary = '';
}

function resetIcao() {
  document.getElementById('icao-type').value = '';
  document.getElementById('icao-sec2').innerHTML = '';
  document.getElementById('icao-result').classList.remove('show');
  icaoEmail = '';
}

function showTab(id, btn) {
  document.querySelectorAll('.pane').forEach(p => p.classList.remove('active'));
  document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
  document.getElementById(id).classList.add('active');
  btn.classList.add('active');
  if (id !== 'un-gen') document.getElementById('ac-dropdown').classList.remove('open');
}

function downloadContactsJSON() {
  if (!STATES.length) return; 
  const database = {
    metadata: { title: "ICAO Contact Directory Export" },
    member_states: STATES,
    icao_offices: ICAO_C
  };
  const jsonString = JSON.stringify(database, null, 2);
  const blob = new Blob([jsonString], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'icao-contacts-export.json';
  a.click();
  URL.revokeObjectURL(url);
}

document.addEventListener('click', e => {
  if (!e.target.closest('.ac-wrap')) document.getElementById('ac-dropdown').classList.remove('open');
});

init();