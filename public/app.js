/* QS-Code-Dashboard — app.js */
'use strict';

let DATA = null;
let CURRENT_YEAR = 2025;
const AVAILABLE_YEARS = [2025];
const PAGE_SIZE = 100;

// === STATE ===
const state = {
    kontext: 'Alle',
    quelle: 'Alle',
    deqs: true,
    sortCol: {},
    sortDir: {},
    pages: { listen: 1, code: 1 },
    codeFilter: 'all',
};

// === HELPERS ===
const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => document.querySelectorAll(sel);
const fmt = (n) => Number(n).toLocaleString('de-DE');

// Code normalization for search — allows users to search with any format
function normalizeSearchCode(input) {
    const raw = input.replace(/[^A-Za-z0-9.\-]/g, '');
    if (!raw) return input;
    // ICD: starts with letter
    if (/^[A-Za-z]\d/.test(raw)) {
        let c = raw[0].toUpperCase() + raw.slice(1).toLowerCase();
        if (!c.includes('.') && c.length > 3 && /^[A-Z]\d{2}/.test(c))
            c = c.slice(0, 3) + '.' + c.slice(3);
        return c;
    }
    // OPS: starts with digit
    if (/^\d/.test(raw)) {
        let c = raw;
        if (c.includes('-') && c.includes('.')) return c;
        let m;
        if ((m = c.match(/^(\d)(\d{3})(\d+)$/))) return `${m[1]}-${m[2]}.${m[3]}`;
        if ((m = c.match(/^(\d)(\d{3})([a-zA-Z]{1,2})$/))) return `${m[1]}-${m[2]}.${m[3]}`;
        if ((m = c.match(/^(\d)(\d{3})([a-zA-Z])(\d{1,2})$/))) return `${m[1]}-${m[2]}.${m[3]}${m[4]}`;
        if ((m = c.match(/^(\d)-?(\d+)([a-zA-Z])(\d+)$/))) {
            return m[2].length >= 3 ? `${m[1]}-${m[2]}.${m[3]}${m[4]}` : `${m[1]}-${m[2]}${m[3]}.${m[4]}`;
        }
        if ((m = c.match(/^(\d)(\d{3})(.+)$/)) && /[a-zA-Z]/.test(m[3]) && !c.includes('.') && !c.includes('-'))
            return `${m[1]}-${m[2]}.${m[3]}`;
        if (!c.includes('-') && c[0].match(/\d/) && c.length > 1) c = c[0] + '-' + c.slice(1);
        if (!c.includes('.') && c.length > 5 && (m = c.match(/^(\d-\d{3})(.+)$/))) c = `${m[1]}.${m[2]}`;
        return c;
    }
    return input;
}

function badge(cls, text) {
    return `<span class="badge badge-${cls}">${text}</span>`;
}

function quelleBadge(q) {
    const m = { QSF: 'qsf', SDAT: 'sdat', QIDB: 'qidb' };
    return badge(m[q] || 'qsf', q);
}

function kontextBadge(k) {
    if (Array.isArray(k)) {
        if (k.includes('Spezifikation') && k.includes('Rechenregel')) return badge('beide', 'Spez+RR');
        if (k.includes('Rechenregel')) return badge('rr', 'Rechenregel');
        return badge('spez', 'Spezifikation');
    }
    return k === 'Rechenregel' ? badge('rr', 'Rechenregel') : badge('spez', 'Spezifikation');
}

function typBadge(t) {
    if (!t || t === '–') return '<span class="badge" style="background:#9e9e9e">–</span>';
    if (t === 'Einschluss+Ausschluss') return badge('dual', 'Dual');
    if (t.includes('Ausschluss')) return badge('aus', 'Ausschluss');
    if (t.includes('Einschluss')) return badge('ein', 'Einschluss');
    return badge('unbekannt', t);
}

function gueltigkeitBadges(katalog) {
    if (!katalog?.gueltigkeit) return '';
    const g = katalog.gueltigkeit;
    const years = Object.keys(g).sort().reverse(); // newest first
    return years.map(y => {
        const v = g[y];
        if (v === true) return `<span class="badge badge-ein" title="Gueltig ${y}" style="font-size:0.65rem">${y}</span>`;
        if (v === false) return `<span class="badge badge-aus" title="Nicht gueltig ${y}" style="font-size:0.65rem;opacity:0.5">${y}</span>`;
        return '';
    }).join(' ');
}

function isDeqs(name) {
    return name.startsWith('QS ');
}

// === FILTER LOGIC ===
function passesGlobalFilter(item) {
    // Kontext
    if (state.kontext !== 'Alle') {
        const k = item.kontext;
        if (Array.isArray(k)) {
            if (!k.includes(state.kontext)) return false;
        } else if (k !== state.kontext) return false;
    }
    // Quelle
    if (state.quelle !== 'Alle') {
        const q = item.quelle;
        if (Array.isArray(q)) {
            if (!q.includes(state.quelle)) return false;
        } else if (q !== state.quelle) return false;
    }
    // DeQS
    if (state.deqs) {
        const v = item.verfahren;
        if (typeof v === 'string' && v && !isDeqs(v)) return false;
        if (Array.isArray(v) && v.length > 0 && !v.some(isDeqs)) return false;
    }
    return true;
}

// === Build flat lists from data ===
function buildListenFlat() {
    const rows = [];
    const CODE_TYPES = ['ops', 'icd', 'gop', 'pzn', 'drg', 'sonstige'];
    for (const ct of CODE_TYPES) {
        const listen = DATA.listen[ct] || {};
        for (const [name, info] of Object.entries(listen)) {
            // Determine verfahren for this list
            let verf = info.verfahren || '';
            if (!verf) {
                // Try to find verfahren from modules that use this list
                for (const [mName, mData] of Object.entries(DATA.module)) {
                    if (mData[ct]) {
                        const allLists = [...(mData[ct].einschluss_listen || []), ...(mData[ct].ausschluss_listen || [])];
                        if (allLists.includes(name)) {
                            verf = mData.verfahren || '';
                            break;
                        }
                    }
                }
            }
            rows.push({
                name, codeTyp: ct.toUpperCase(), ...info, verfahren: verf,
            });
        }
    }
    return rows;
}

function buildCodesFlat() {
    const rows = [];
    const CODE_TYPES = ['ops', 'icd', 'gop', 'pzn', 'drg', 'sonstige'];
    for (const ct of CODE_TYPES) {
        const codes = DATA.codes[ct] || {};
        for (const [code, info] of Object.entries(codes)) {
            rows.push({
                code, codeTyp: ct.toUpperCase(), ...info,
            });
        }
    }
    return rows;
}

let LISTEN_FLAT = [];
let CODES_FLAT = [];

// === INIT ===
async function loadData() {
    const yearFiles = AVAILABLE_YEARS.map(y => `data/dashboard_${y}.json`);
    try {
        const resp = await fetch(`data/dashboard_${CURRENT_YEAR}.json?v=${Date.now()}`);
        if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
        DATA = await resp.json();
        LISTEN_FLAT = buildListenFlat();
        CODES_FLAT = buildCodesFlat();
        initDashboard();
    } catch (e) {
        $('#loading').innerHTML = `<p style="color:red">Fehler beim Laden: ${e.message}</p>`;
    }
}

function initDashboard() {
    $('#loading').classList.add('hidden');
    $('#app').classList.remove('hidden');

    // Year select
    const yearSel = $('#year-select');
    AVAILABLE_YEARS.forEach(y => {
        const o = document.createElement('option');
        o.value = y; o.textContent = y;
        if (y === CURRENT_YEAR) o.selected = true;
        yearSel.appendChild(o);
    });

    setupFilters();
    setupTabs();
    updateAll();
}

function setupFilters() {
    // Kontext toggle
    $$('#kontext-filter .toggle').forEach(btn => {
        btn.addEventListener('click', () => {
            $$('#kontext-filter .toggle').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            state.kontext = btn.dataset.value;
            updateAll();
        });
    });

    // Quelle toggle
    $$('#quelle-filter .toggle').forEach(btn => {
        btn.addEventListener('click', () => {
            $$('#quelle-filter .toggle').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            state.quelle = btn.dataset.value;
            updateAll();
        });
    });

    // DeQS toggle
    $('#deqs-toggle').addEventListener('click', () => {
        state.deqs = !state.deqs;
        const btn = $('#deqs-toggle');
        btn.classList.toggle('active', state.deqs);
        btn.textContent = state.deqs ? 'An' : 'Aus';
        updateAll();
    });

    // Tab-level filters
    $('#module-search').addEventListener('input', debounce(() => renderModuleTable(), 200));
    $('#module-verfahren-filter').addEventListener('change', () => renderModuleTable());
    $('#module-quelle-filter').addEventListener('change', () => renderModuleTable());

    $('#listen-search').addEventListener('input', debounce(() => { state.pages.listen = 1; renderListenTable(); }, 200));
    $('#listen-kontext-filter').addEventListener('change', () => { state.pages.listen = 1; renderListenTable(); });
    $('#listen-codetyp-filter').addEventListener('change', () => { state.pages.listen = 1; renderListenTable(); });
    $('#listen-typ-filter').addEventListener('change', () => { state.pages.listen = 1; renderListenTable(); });
    $('#listen-quelle-filter').addEventListener('change', () => { state.pages.listen = 1; renderListenTable(); });

    $('#code-search').addEventListener('input', debounce(() => { state.pages.code = 1; renderCodeTable(); }, 300));
    $('#code-codetyp-filter').addEventListener('change', () => { state.pages.code = 1; renderCodeTable(); });
    $('#code-kontext-filter').addEventListener('change', () => { state.pages.code = 1; renderCodeTable(); });
    $('#code-quelle-filter').addEventListener('change', () => { state.pages.code = 1; renderCodeTable(); });

    // Code pills
    $$('#code-pills .pill').forEach(btn => {
        btn.addEventListener('click', () => {
            $$('#code-pills .pill').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            state.codeFilter = btn.dataset.filter;
            state.pages.code = 1;
            renderCodeTable();
        });
    });

    // Populate filter dropdowns
    populateFilterDropdowns();

    // Modal
    $('#modal-close').addEventListener('click', closeModal);
    $('#modal-overlay').addEventListener('click', (e) => {
        if (e.target === $('#modal-overlay')) closeModal();
    });
}

function populateFilterDropdowns() {
    // Module Verfahren dropdown
    const verfahren = new Set();
    Object.values(DATA.module).forEach(m => { if (m.verfahren) verfahren.add(m.verfahren); });
    Object.keys(DATA.verfahren).forEach(v => verfahren.add(v));
    const vfSel = $('#module-verfahren-filter');
    [...verfahren].sort().forEach(v => {
        const o = document.createElement('option');
        o.value = v; o.textContent = v;
        vfSel.appendChild(o);
    });

    // Module Quelle
    const mq = $('#module-quelle-filter');
    ['QSF', 'SDAT'].forEach(q => {
        const o = document.createElement('option');
        o.value = q; o.textContent = q;
        mq.appendChild(o);
    });

    // Listen dropdowns
    const lk = $('#listen-kontext-filter');
    ['Spezifikation', 'Rechenregel'].forEach(k => {
        const o = document.createElement('option'); o.value = k; o.textContent = k; lk.appendChild(o);
    });
    const lct = $('#listen-codetyp-filter');
    ['OPS', 'ICD', 'GOP', 'PZN', 'DRG', 'Sonstige'].forEach(t => {
        const o = document.createElement('option'); o.value = t; o.textContent = t; lct.appendChild(o);
    });
    const lt = $('#listen-typ-filter');
    ['Einschluss', 'Ausschluss', 'Einschluss+Ausschluss', '–'].forEach(t => {
        const o = document.createElement('option'); o.value = t; o.textContent = t; lt.appendChild(o);
    });
    const lq = $('#listen-quelle-filter');
    ['QSF', 'SDAT', 'QIDB'].forEach(q => {
        const o = document.createElement('option'); o.value = q; o.textContent = q; lq.appendChild(o);
    });

    // Code dropdowns
    const cct = $('#code-codetyp-filter');
    ['OPS', 'ICD', 'GOP', 'PZN', 'DRG', 'Sonstige'].forEach(t => {
        const o = document.createElement('option'); o.value = t; o.textContent = t; cct.appendChild(o);
    });
    const ck = $('#code-kontext-filter');
    ['Spezifikation', 'Rechenregel'].forEach(k => {
        const o = document.createElement('option'); o.value = k; o.textContent = k; ck.appendChild(o);
    });
    const cq = $('#code-quelle-filter');
    ['QSF', 'SDAT', 'QIDB'].forEach(q => {
        const o = document.createElement('option'); o.value = q; o.textContent = q; cq.appendChild(o);
    });
}

function setupTabs() {
    $$('.tab').forEach(tab => {
        tab.addEventListener('click', () => {
            $$('.tab').forEach(t => t.classList.remove('active'));
            $$('.tab-content').forEach(t => t.classList.remove('active'));
            tab.classList.add('active');
            $(`#tab-${tab.dataset.tab}`).classList.add('active');
        });
    });
}

// === UPDATE ALL ===
function updateAll() {
    renderStats();
    renderVerfahrenTable();
    renderModuleTable();
    renderListenTable();
    renderCodeTable();
    renderCharts();
}

// === STATS ===
function renderStats() {
    const s = DATA.meta.statistik;
    const grid = $('#stats-grid');

    // Count filtered
    const fVerf = Object.entries(DATA.verfahren).filter(([name]) => !state.deqs || isDeqs(name));
    const fMod = Object.entries(DATA.module).filter(([, m]) => passesGlobalFilter(m));
    const fListen = LISTEN_FLAT.filter(l => passesGlobalFilter(l));
    const fCodes = CODES_FLAT.filter(c => passesGlobalFilter(c));

    const opsCodes = fCodes.filter(c => c.codeTyp === 'OPS').length;
    const icdCodes = fCodes.filter(c => c.codeTyp === 'ICD').length;
    const gopCodes = fCodes.filter(c => c.codeTyp === 'GOP').length;
    const pznCodes = fCodes.filter(c => c.codeTyp === 'PZN').length;

    const ov = DATA.meta.ueberschneidung || {};

    grid.innerHTML = `
        <div class="stat-card">
            <div class="stat-value">${fmt(fVerf.length)}</div>
            <div class="stat-label">Verfahren</div>
        </div>
        <div class="stat-card">
            <div class="stat-value">${fmt(fMod.length)}</div>
            <div class="stat-label">Module</div>
        </div>
        <div class="stat-card">
            <div class="stat-value">${fmt(fListen.length)}</div>
            <div class="stat-label">Listen</div>
        </div>
        <div class="stat-card">
            <div class="stat-value">${fmt(opsCodes)}</div>
            <div class="stat-label">OPS-Codes</div>
        </div>
        <div class="stat-card">
            <div class="stat-value">${fmt(icdCodes)}</div>
            <div class="stat-label">ICD-Codes</div>
        </div>
        <div class="stat-card">
            <div class="stat-value">${fmt(gopCodes)}</div>
            <div class="stat-label">GOP-Codes</div>
        </div>
        <div class="stat-card">
            <div class="stat-value">${fmt(pznCodes)}</div>
            <div class="stat-label">PZN-Codes</div>
        </div>
        <div class="stat-card">
            <div class="stat-value">${fmt((ov.icd?.beide || 0) + (ov.ops?.beide || 0))}</div>
            <div class="stat-label">Codes Spez+RR</div>
            <div class="stat-detail">in beiden Kontexten</div>
        </div>
    `;
}

// === VERFAHREN TABLE ===
function renderVerfahrenTable() {
    const table = $('#verfahren-table');
    const rows = Object.entries(DATA.verfahren)
        .filter(([name]) => !state.deqs || isDeqs(name))
        .map(([name, v]) => ({ name, ...v }));

    const sortKey = state.sortCol.verfahren || 'name';
    const dir = state.sortDir.verfahren || 1;
    rows.sort((a, b) => {
        let av = a[sortKey], bv = b[sortKey];
        if (typeof av === 'number') return (av - bv) * dir;
        return String(av || '').localeCompare(String(bv || ''), 'de') * dir;
    });

    const cols = [
        { key: 'name', label: 'Verfahren' },
        { key: 'module', label: 'Module', fn: v => v.module?.length || 0 },
        { key: 'ops_einschluss_distinct', label: 'OPS Ein', num: true },
        { key: 'ops_ausschluss_distinct', label: 'OPS Aus', num: true },
        { key: 'icd_einschluss_distinct', label: 'ICD Ein', num: true },
        { key: 'icd_ausschluss_distinct', label: 'ICD Aus', num: true },
        { key: 'rr_listen', label: 'RR-Listen', num: true },
        { key: 'ops_rechenregel_distinct', label: 'RR OPS', num: true },
        { key: 'icd_rechenregel_distinct', label: 'RR ICD', num: true },
    ];

    table.querySelector('thead').innerHTML = '<tr>' + cols.map(c =>
        `<th data-sort="${c.key}" class="${state.sortCol.verfahren === c.key ? 'sorted' : ''}">${c.label}<span class="sort-indicator">${state.sortCol.verfahren === c.key ? (dir > 0 ? '▲' : '▼') : '↕'}</span></th>`
    ).join('') + '</tr>';

    table.querySelector('tbody').innerHTML = rows.map(r => {
        const vals = cols.map(c => {
            const v = c.fn ? c.fn(r) : (r[c.key] ?? 0);
            return `<td class="${c.num ? 'num' : ''}">${c.num ? fmt(v) : v}</td>`;
        });
        return `<tr class="clickable" data-verfahren="${r.name}">${vals.join('')}</tr>`;
    }).join('');

    // Sort handlers
    table.querySelectorAll('th').forEach(th => {
        th.addEventListener('click', () => {
            const key = th.dataset.sort;
            if (state.sortCol.verfahren === key) state.sortDir.verfahren *= -1;
            else { state.sortCol.verfahren = key; state.sortDir.verfahren = 1; }
            renderVerfahrenTable();
        });
    });

    // Row click
    table.querySelectorAll('tr.clickable').forEach(tr => {
        tr.addEventListener('click', () => openVerfahrenModal(tr.dataset.verfahren));
    });
}

// === MODULE TABLE ===
function renderModuleTable() {
    const table = $('#module-table');
    const search = ($('#module-search').value || '').toLowerCase();
    const vFilter = $('#module-verfahren-filter').value;
    const qFilter = $('#module-quelle-filter').value;

    let rows = Object.entries(DATA.module)
        .map(([name, m]) => ({ name, ...m }))
        .filter(m => passesGlobalFilter(m));

    if (search) rows = rows.filter(m =>
        m.name.toLowerCase().includes(search) ||
        (m.bezeichnung || '').toLowerCase().includes(search)
    );
    if (vFilter) rows = rows.filter(m => m.verfahren === vFilter);
    if (qFilter) rows = rows.filter(m => m.quelle === qFilter);

    const sortKey = state.sortCol.module || 'name';
    const dir = state.sortDir.module || 1;
    rows.sort((a, b) => {
        let av = a[sortKey], bv = b[sortKey];
        if (typeof av === 'object') av = JSON.stringify(av);
        if (typeof bv === 'object') bv = JSON.stringify(bv);
        if (typeof av === 'number') return (av - bv) * dir;
        return String(av || '').localeCompare(String(bv || ''), 'de') * dir;
    });

    const cols = [
        { key: 'name', label: 'Modul' },
        { key: 'bezeichnung', label: 'Bezeichnung' },
        { key: 'verfahren', label: 'Verfahren' },
        { key: 'quelle', label: 'Quelle', fn: m => quelleBadge(m.quelle) },
    ];

    table.querySelector('thead').innerHTML = '<tr>' + cols.map(c =>
        `<th data-sort="${c.key}">${c.label}<span class="sort-indicator">↕</span></th>`
    ).join('') + '</tr>';

    table.querySelector('tbody').innerHTML = rows.map(r => {
        const vals = cols.map(c => {
            const v = c.fn ? c.fn(r) : (r[c.key] || '');
            return `<td>${v}</td>`;
        });
        return `<tr class="clickable" data-module="${r.name}">${vals.join('')}</tr>`;
    }).join('');

    table.querySelectorAll('th').forEach(th => {
        th.addEventListener('click', () => {
            const key = th.dataset.sort;
            if (state.sortCol.module === key) state.sortDir.module *= -1;
            else { state.sortCol.module = key; state.sortDir.module = 1; }
            renderModuleTable();
        });
    });

    table.querySelectorAll('tr.clickable').forEach(tr => {
        tr.addEventListener('click', () => openModuleModal(tr.dataset.module));
    });
}

// === LISTEN TABLE ===
function renderListenTable() {
    const table = $('#listen-table');
    const search = ($('#listen-search').value || '').toLowerCase();
    const kFilter = $('#listen-kontext-filter').value;
    const ctFilter = $('#listen-codetyp-filter').value;
    const tFilter = $('#listen-typ-filter').value;
    const qFilter = $('#listen-quelle-filter').value;

    let rows = LISTEN_FLAT.filter(l => passesGlobalFilter(l));
    if (search) rows = rows.filter(l =>
        l.name.toLowerCase().includes(search) ||
        (l.bezeichnung || '').toLowerCase().includes(search)
    );
    if (kFilter) rows = rows.filter(l => l.kontext === kFilter);
    if (ctFilter) rows = rows.filter(l => l.codeTyp === ctFilter.toUpperCase());
    if (tFilter) rows = rows.filter(l => l.typ === tFilter);
    if (qFilter) rows = rows.filter(l => l.quelle === qFilter);

    const sortKey = state.sortCol.listen || 'name';
    const dir = state.sortDir.listen || 1;
    rows.sort((a, b) => {
        let av = a[sortKey], bv = b[sortKey];
        if (typeof av === 'number') return (av - bv) * dir;
        return String(av || '').localeCompare(String(bv || ''), 'de') * dir;
    });

    const total = rows.length;
    const totalPages = Math.ceil(total / PAGE_SIZE);
    const page = Math.min(state.pages.listen, totalPages || 1);
    const start = (page - 1) * PAGE_SIZE;
    const pageRows = rows.slice(start, start + PAGE_SIZE);

    const cols = [
        { key: 'name', label: 'Liste' },
        { key: 'bezeichnung', label: 'Bezeichnung' },
        { key: 'codeTyp', label: 'Code-Typ' },
        { key: 'typ', label: 'Typ', fn: l => typBadge(l.typ) },
        { key: 'anzahl_codes', label: 'Codes', num: true },
        { key: 'quelle', label: 'Quelle', fn: l => quelleBadge(l.quelle) },
        { key: 'kontext', label: 'Kontext', fn: l => kontextBadge(l.kontext) },
    ];

    table.querySelector('thead').innerHTML = '<tr>' + cols.map(c =>
        `<th data-sort="${c.key}">${c.label}<span class="sort-indicator">↕</span></th>`
    ).join('') + '</tr>';

    table.querySelector('tbody').innerHTML = pageRows.map(r => {
        const vals = cols.map(c => {
            const v = c.fn ? c.fn(r) : (c.num ? fmt(r[c.key] || 0) : (r[c.key] || ''));
            return `<td class="${c.num ? 'num' : ''}">${v}</td>`;
        });
        return `<tr class="clickable" data-liste="${r.name}" data-codetyp="${r.codeTyp.toLowerCase()}">${vals.join('')}</tr>`;
    }).join('');

    renderPagination('#listen-pagination', total, page, totalPages, (p) => {
        state.pages.listen = p;
        renderListenTable();
    });

    table.querySelectorAll('th').forEach(th => {
        th.addEventListener('click', () => {
            const key = th.dataset.sort;
            if (state.sortCol.listen === key) state.sortDir.listen *= -1;
            else { state.sortCol.listen = key; state.sortDir.listen = 1; }
            state.pages.listen = 1;
            renderListenTable();
        });
    });

    table.querySelectorAll('tr.clickable').forEach(tr => {
        tr.addEventListener('click', () => openListeModal(tr.dataset.liste, tr.dataset.codetyp));
    });
}

// === CODE TABLE ===
function renderCodeTable() {
    const table = $('#code-table');
    const search = ($('#code-search').value || '').toLowerCase();
    const ctFilter = $('#code-codetyp-filter').value;
    const kFilter = $('#code-kontext-filter').value;
    const qFilter = $('#code-quelle-filter').value;

    let rows = CODES_FLAT.filter(c => {
        // Quelle filter: check if any quelle matches
        if (state.quelle !== 'Alle' && Array.isArray(c.quelle) && !c.quelle.includes(state.quelle)) return false;
        if (state.kontext !== 'Alle' && Array.isArray(c.kontext) && !c.kontext.includes(state.kontext)) return false;
        if (state.deqs && c.verfahren) {
            const verf = Array.isArray(c.verfahren) ? c.verfahren : [c.verfahren];
            if (!verf.some(isDeqs) && verf.length > 0 && verf[0] !== '') return false;
        }
        return true;
    });

    if (search && search.length >= 2) {
        const normalized = normalizeSearchCode(search).toLowerCase();
        rows = rows.filter(c =>
            c.code.toLowerCase().includes(search) ||
            c.code.toLowerCase().includes(normalized) ||
            (c.katalog?.bezeichnung || '').toLowerCase().includes(search)
        );
    }
    if (ctFilter) rows = rows.filter(c => c.codeTyp === ctFilter.toUpperCase());
    if (kFilter) rows = rows.filter(c => c.kontext?.includes(kFilter));
    if (qFilter) rows = rows.filter(c => c.quelle?.includes(qFilter));

    // Pills
    if (state.codeFilter === 'multi-verfahren') rows = rows.filter(c => c.anzahl_verfahren > 1);
    if (state.codeFilter === 'beide-kontexte') rows = rows.filter(c => c.kontext?.includes('Spezifikation') && c.kontext?.includes('Rechenregel'));
    if (state.codeFilter === 'nicht-gueltig') rows = rows.filter(c => {
        const g = c.katalog?.gueltigkeit;
        if (!g) return false;
        const primaryYear = String(CURRENT_YEAR);
        if (g[primaryYear] !== false) return false;
        // Exclude OPS+ICD combination codes (e.g. "5-349.3T81.4") — they never exist as single codes
        if (c.codeTyp === 'OPS' && /^\d-\d{2,3}\.[0-9a-z]+[A-Z]\d/i.test(c.code)) return false;
        return true;
    });

    const sortKey = state.sortCol.code || 'code';
    const dir = state.sortDir.code || 1;
    rows.sort((a, b) => {
        let av = a[sortKey], bv = b[sortKey];
        if (typeof av === 'number') return (av - bv) * dir;
        return String(av || '').localeCompare(String(bv || ''), 'de') * dir;
    });

    const total = rows.length;
    const totalPages = Math.ceil(total / PAGE_SIZE);
    const page = Math.min(state.pages.code, totalPages || 1);
    const start = (page - 1) * PAGE_SIZE;
    const pageRows = rows.slice(start, start + PAGE_SIZE);

    const cols = [
        { key: 'code', label: 'Code' },
        { key: 'codeTyp', label: 'Typ' },
        { key: 'bezeichnung', label: 'Bezeichnung', fn: c => c.katalog?.bezeichnung || '' },
        { key: 'anzahl_listen', label: 'Listen', num: true },
        { key: 'anzahl_verfahren', label: 'Verfahren', num: true },
        { key: 'gueltigkeit', label: 'Gueltigkeit', fn: c => gueltigkeitBadges(c.katalog) },
        { key: 'kontext', label: 'Kontext', fn: c => kontextBadge(c.kontext) },
        { key: 'quelle', label: 'Quelle', fn: c => (c.quelle || []).map(quelleBadge).join(' ') },
    ];

    table.querySelector('thead').innerHTML = '<tr>' + cols.map(c =>
        `<th data-sort="${c.key}">${c.label}<span class="sort-indicator">↕</span></th>`
    ).join('') + '</tr>';

    table.querySelector('tbody').innerHTML = pageRows.map(r => {
        const vals = cols.map(c => {
            const v = c.fn ? c.fn(r) : (c.num ? fmt(r[c.key] || 0) : (r[c.key] || ''));
            return `<td class="${c.num ? 'num' : ''}">${v}</td>`;
        });
        return `<tr class="clickable" data-code="${r.code}" data-codetyp="${r.codeTyp.toLowerCase()}">${vals.join('')}</tr>`;
    }).join('');

    renderPagination('#code-pagination', total, page, totalPages, (p) => {
        state.pages.code = p;
        renderCodeTable();
    });

    table.querySelectorAll('th').forEach(th => {
        th.addEventListener('click', () => {
            const key = th.dataset.sort;
            if (state.sortCol.code === key) state.sortDir.code *= -1;
            else { state.sortCol.code = key; state.sortDir.code = 1; }
            state.pages.code = 1;
            renderCodeTable();
        });
    });

    table.querySelectorAll('tr.clickable').forEach(tr => {
        tr.addEventListener('click', () => openCodeModal(tr.dataset.code, tr.dataset.codetyp));
    });
}

// === PAGINATION ===
function renderPagination(sel, total, page, totalPages, onChange) {
    const el = $(sel);
    if (totalPages <= 1) { el.innerHTML = `<span class="page-info">${fmt(total)} Ergebnis${total !== 1 ? 'se' : ''}</span>`; return; }

    let html = `<span class="page-info">${fmt(total)} Ergebnisse, Seite ${page}/${totalPages}</span>`;
    html += `<button ${page <= 1 ? 'disabled' : ''} data-page="${page - 1}">&laquo;</button>`;

    const range = [];
    for (let i = Math.max(1, page - 2); i <= Math.min(totalPages, page + 2); i++) range.push(i);
    if (range[0] > 1) html += `<button data-page="1">1</button>` + (range[0] > 2 ? '<span>...</span>' : '');
    range.forEach(p => { html += `<button data-page="${p}" class="${p === page ? 'active' : ''}">${p}</button>`; });
    if (range[range.length - 1] < totalPages) html += (range[range.length - 1] < totalPages - 1 ? '<span>...</span>' : '') + `<button data-page="${totalPages}">${totalPages}</button>`;

    html += `<button ${page >= totalPages ? 'disabled' : ''} data-page="${page + 1}">&raquo;</button>`;
    el.innerHTML = html;

    el.querySelectorAll('button[data-page]').forEach(btn => {
        btn.addEventListener('click', () => onChange(parseInt(btn.dataset.page)));
    });
}

// === CHARTS ===
function renderCharts() {
    renderVerfahrenCodesChart();
    renderOverlapChart();
    renderTreemap();
}

function renderVerfahrenCodesChart() {
    const box = $('#chart-verfahren-codes');
    box.innerHTML = '<h3>Codes pro Verfahren (Top 15)</h3>';

    const verf = Object.entries(DATA.verfahren)
        .filter(([name]) => !state.deqs || isDeqs(name))
        .map(([name, v]) => ({
            name,
            ops: (v.ops_einschluss_distinct || 0) + (v.ops_ausschluss_distinct || 0) + (v.ops_rechenregel_distinct || 0),
            icd: (v.icd_einschluss_distinct || 0) + (v.icd_ausschluss_distinct || 0) + (v.icd_rechenregel_distinct || 0),
        }))
        .sort((a, b) => (b.ops + b.icd) - (a.ops + a.icd))
        .slice(0, 15);

    if (!verf.length) { box.innerHTML += '<p>Keine Daten</p>'; return; }

    const margin = { top: 10, right: 20, bottom: 60, left: 50 };
    const width = box.clientWidth - margin.left - margin.right - 32;
    const height = 280 - margin.top - margin.bottom;

    const svg = d3.select(box).append('svg')
        .attr('width', width + margin.left + margin.right)
        .attr('height', height + margin.top + margin.bottom)
        .append('g').attr('transform', `translate(${margin.left},${margin.top})`);

    const x = d3.scaleBand().domain(verf.map(d => d.name)).range([0, width]).padding(0.2);
    const y = d3.scaleLinear().domain([0, d3.max(verf, d => d.ops + d.icd) * 1.1]).range([height, 0]);

    svg.append('g').attr('transform', `translate(0,${height})`).call(d3.axisBottom(x))
        .selectAll('text').attr('transform', 'rotate(-35)').style('text-anchor', 'end').style('font-size', '0.65rem');
    svg.append('g').call(d3.axisLeft(y).ticks(5));

    const colors = { ops: '#00838f', icd: '#e65100' };
    verf.forEach(d => {
        svg.append('rect').attr('x', x(d.name)).attr('y', y(d.ops + d.icd)).attr('width', x.bandwidth())
            .attr('height', height - y(d.ops + d.icd)).attr('fill', colors.ops).attr('rx', 2);
        svg.append('rect').attr('x', x(d.name)).attr('y', y(d.icd)).attr('width', x.bandwidth())
            .attr('height', height - y(d.icd)).attr('fill', colors.icd).attr('rx', 2);
    });

    // Legend
    const legend = d3.select(box).append('div').style('display', 'flex').style('gap', '1rem').style('justify-content', 'center').style('margin-top', '0.5rem').style('font-size', '0.75rem');
    legend.append('span').html(`<span style="display:inline-block;width:12px;height:12px;background:${colors.ops};border-radius:2px;margin-right:4px;vertical-align:middle"></span>OPS`);
    legend.append('span').html(`<span style="display:inline-block;width:12px;height:12px;background:${colors.icd};border-radius:2px;margin-right:4px;vertical-align:middle"></span>ICD`);
}

function renderOverlapChart() {
    const box = $('#chart-overlap');
    box.innerHTML = '<h3>Codes: Spezifikation vs. Rechenregel</h3>';

    const ov = DATA.meta.ueberschneidung || {};
    const data = [];
    for (const [ct, vals] of Object.entries(ov)) {
        if (vals.nur_spezifikation || vals.nur_rechenregel || vals.beide) {
            data.push({ type: ct.toUpperCase(), spez: vals.nur_spezifikation, rr: vals.nur_rechenregel, beide: vals.beide });
        }
    }
    if (!data.length) { box.innerHTML += '<p>Keine Ueberschneidungen</p>'; return; }

    const margin = { top: 10, right: 20, bottom: 40, left: 50 };
    const width = box.clientWidth - margin.left - margin.right - 32;
    const height = 280 - margin.top - margin.bottom;

    const svg = d3.select(box).append('svg')
        .attr('width', width + margin.left + margin.right)
        .attr('height', height + margin.top + margin.bottom)
        .append('g').attr('transform', `translate(${margin.left},${margin.top})`);

    const x = d3.scaleBand().domain(data.map(d => d.type)).range([0, width]).padding(0.3);
    const y = d3.scaleLinear().domain([0, d3.max(data, d => d.spez + d.rr + d.beide) * 1.1]).range([height, 0]);

    svg.append('g').attr('transform', `translate(0,${height})`).call(d3.axisBottom(x)).selectAll('text').style('font-size', '0.75rem');
    svg.append('g').call(d3.axisLeft(y).ticks(5));

    const colors = { spez: '#1565c0', beide: '#7b1fa2', rr: '#e65100' };
    data.forEach(d => {
        let cy = height;
        [['spez', d.spez], ['beide', d.beide], ['rr', d.rr]].forEach(([key, val]) => {
            const h = height - y(val);
            svg.append('rect').attr('x', x(d.type)).attr('y', cy - h).attr('width', x.bandwidth())
                .attr('height', h).attr('fill', colors[key]).attr('rx', 2);
            cy -= h;
        });
    });

    const legend = d3.select(box).append('div').style('display', 'flex').style('gap', '1rem').style('justify-content', 'center').style('margin-top', '0.5rem').style('font-size', '0.75rem');
    legend.append('span').html(`<span style="display:inline-block;width:12px;height:12px;background:${colors.spez};border-radius:2px;margin-right:4px;vertical-align:middle"></span>Nur Spez`);
    legend.append('span').html(`<span style="display:inline-block;width:12px;height:12px;background:${colors.beide};border-radius:2px;margin-right:4px;vertical-align:middle"></span>Beide`);
    legend.append('span').html(`<span style="display:inline-block;width:12px;height:12px;background:${colors.rr};border-radius:2px;margin-right:4px;vertical-align:middle"></span>Nur RR`);
}

function renderTreemap() {
    const box = $('#chart-treemap');
    box.innerHTML = '<h3>Verfahren nach Gesamtcodezahl</h3>';

    const verf = Object.entries(DATA.verfahren)
        .filter(([name]) => !state.deqs || isDeqs(name))
        .map(([name, v]) => {
            let total = 0;
            for (const ct of ['ops', 'icd', 'gop', 'pzn', 'drg', 'sonstige']) {
                total += (v[`${ct}_einschluss_distinct`] || 0) + (v[`${ct}_ausschluss_distinct`] || 0) + (v[`${ct}_rechenregel_distinct`] || 0);
            }
            return { name, value: total };
        })
        .filter(d => d.value > 0);

    if (!verf.length) { box.innerHTML += '<p>Keine Daten</p>'; return; }

    const width = box.clientWidth - 32;
    const height = 250;

    const root = d3.hierarchy({ children: verf }).sum(d => d.value);
    d3.treemap().size([width, height]).padding(2)(root);

    const color = d3.scaleOrdinal(d3.schemeTableau10);
    const svg = d3.select(box).append('svg').attr('width', width).attr('height', height);

    const nodes = svg.selectAll('g').data(root.leaves()).join('g')
        .attr('transform', d => `translate(${d.x0},${d.y0})`);

    nodes.append('rect')
        .attr('width', d => d.x1 - d.x0).attr('height', d => d.y1 - d.y0)
        .attr('fill', d => color(d.data.name)).attr('rx', 3).attr('opacity', 0.85);

    nodes.append('text')
        .attr('x', 4).attr('y', 14).text(d => d.data.name)
        .style('font-size', d => (d.x1 - d.x0) > 80 ? '0.7rem' : '0.55rem')
        .style('fill', '#fff').style('font-weight', '600');

    nodes.append('text')
        .attr('x', 4).attr('y', 28).text(d => fmt(d.data.value))
        .style('font-size', '0.6rem').style('fill', '#fff').style('opacity', 0.8);
}

// === MODALS ===
function openModal(title, bodyHtml) {
    $('#modal-title').textContent = title;
    $('#modal-body').innerHTML = bodyHtml;
    $('#modal-overlay').classList.remove('hidden');
    document.body.style.overflow = 'hidden';
}

function closeModal() {
    $('#modal-overlay').classList.add('hidden');
    document.body.style.overflow = '';
}

function openVerfahrenModal(name) {
    const v = DATA.verfahren[name];
    if (!v) return;

    let html = '<div class="detail-section">';
    html += `<h3>Module (${v.module.length})</h3>`;
    if (v.module.length) {
        html += '<table class="data-table"><thead><tr><th>Modul</th><th>Bezeichnung</th><th>Quelle</th></tr></thead><tbody>';
        v.module.forEach(mName => {
            const m = DATA.module[mName];
            html += `<tr><td>${mName}</td><td>${m?.bezeichnung || ''}</td><td>${m ? quelleBadge(m.quelle) : ''}</td></tr>`;
        });
        html += '</tbody></table>';
    }
    html += '</div>';

    // Code counts
    html += '<div class="detail-section"><h3>Code-Uebersicht</h3>';
    html += '<table class="data-table"><thead><tr><th>Typ</th><th>Spez Ein</th><th>Spez Aus</th><th>RR</th></tr></thead><tbody>';
    for (const ct of ['ops', 'icd', 'gop', 'pzn', 'drg', 'sonstige']) {
        const ein = v[`${ct}_einschluss_distinct`] || 0;
        const aus = v[`${ct}_ausschluss_distinct`] || 0;
        const rr = v[`${ct}_rechenregel_distinct`] || 0;
        if (ein || aus || rr) {
            html += `<tr><td>${ct.toUpperCase()}</td><td class="num">${fmt(ein)}</td><td class="num">${fmt(aus)}</td><td class="num">${fmt(rr)}</td></tr>`;
        }
    }
    html += '</tbody></table></div>';

    openModal(name, html);
}

function openModuleModal(name) {
    const m = DATA.module[name];
    if (!m) return;

    let html = `<div class="badge-row">${quelleBadge(m.quelle)} ${kontextBadge(m.kontext)}</div>`;
    html += `<p>${m.bezeichnung || ''}</p>`;

    html += '<div class="detail-section"><h3>Filterlisten</h3>';
    html += '<table class="data-table"><thead><tr><th>Liste</th><th>Typ</th><th>Rolle</th><th>Codes</th></tr></thead><tbody>';
    for (const ct of ['ops', 'icd', 'gop', 'pzn', 'drg', 'sonstige']) {
        if (!m[ct]) continue;
        const all = [...(m[ct].einschluss_listen || []), ...(m[ct].ausschluss_listen || [])];
        all.forEach(lName => {
            const l = DATA.listen[ct]?.[lName];
            const rolle = (m[ct].einschluss_listen || []).includes(lName) ? 'Einschluss' : 'Ausschluss';
            html += `<tr><td>${lName}</td><td>${ct.toUpperCase()}</td><td>${typBadge(rolle)}</td><td class="num">${l ? fmt(l.anzahl_codes) : '–'}</td></tr>`;
        });
    }
    html += '</tbody></table></div>';

    openModal(`Modul: ${name}`, html);
}

function openListeModal(name, codeTyp) {
    const l = DATA.listen[codeTyp]?.[name];
    if (!l) return;

    let html = `<div class="badge-row">${quelleBadge(l.quelle)} ${kontextBadge(l.kontext)} ${typBadge(l.typ)}</div>`;
    html += `<p>${l.bezeichnung || ''}</p>`;

    html += `<div class="detail-section"><h3>Codes (${l.codes.length})</h3>`;
    html += '<table class="data-table"><thead><tr><th>Code</th><th>Bezeichnung</th><th>Gueltigkeit</th></tr></thead><tbody>';
    l.codes.forEach(code => {
        const ci = DATA.codes[codeTyp]?.[code];
        html += `<tr><td>${code}</td><td>${ci?.katalog?.bezeichnung || ''}</td><td>${gueltigkeitBadges(ci?.katalog)}</td></tr>`;
    });
    html += '</tbody></table></div>';

    openModal(`Liste: ${name}`, html);
}

function openCodeModal(code, codeTyp) {
    const c = DATA.codes[codeTyp]?.[code];
    if (!c) return;

    let html = `<div class="badge-row">${(c.quelle || []).map(quelleBadge).join(' ')} ${kontextBadge(c.kontext)} ${gueltigkeitBadges(c.katalog)}</div>`;
    html += `<p><strong>${code}</strong> (${codeTyp.toUpperCase()})${c.katalog?.bezeichnung ? ' — ' + c.katalog.bezeichnung : ''}</p>`;

    html += `<div class="detail-section"><h3>Verwendung (${c.verwendung.length})</h3>`;
    html += '<table class="data-table"><thead><tr><th>Verfahren</th><th>Modul</th><th>Liste</th><th>Rolle</th><th>Quelle</th><th>Kontext</th></tr></thead><tbody>';
    c.verwendung.forEach(u => {
        html += `<tr><td>${u.verfahren}</td><td>${u.modul}</td><td>${u.liste}</td><td>${u.rolle}</td><td>${quelleBadge(u.quelle)}</td><td>${kontextBadge(u.kontext)}</td></tr>`;
    });
    html += '</tbody></table></div>';

    openModal(`Code: ${code}`, html);
}

// === UTIL ===
function debounce(fn, ms) {
    let timer;
    return (...args) => { clearTimeout(timer); timer = setTimeout(() => fn(...args), ms); };
}

// === BOOT ===
document.addEventListener('DOMContentLoaded', loadData);
