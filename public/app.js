/* QS-Code-Dashboard — app.js */
'use strict';

let DATA = null;
let CURRENT_YEAR = 2025;
const AVAILABLE_YEARS = [2025];
const PAGE_SIZE = 100;
const ALL_CODE_TYPES = ['ops', 'icd', 'gop', 'pzn', 'drg', 'sonstige'];
const COMBO_CODE_RE = /^\d-\d{2,3}\.[0-9a-z]+[A-Z]\d/i;

// === STATE ===
const state = {
    kontext: 'Alle',
    quelle: 'Alle',
    deqs: true,
    kombiExclude: true,
    sortCol: {},
    sortDir: {},
    pages: { listen: 1, code: 1 },
    codeFilter: 'all',
};

let chartsNeedUpdate = true;
const chartTypeFilter = { treemap: '', chord: '', network: '' };

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
    if (Array.isArray(q)) return q.map(quelleBadge).join(' ');
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

function isComboCode(code) {
    return COMBO_CODE_RE.test(code);
}

// Reverse map: module name -> verfahren name
let MODULE_TO_VERF = {};

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

// Check if a code passes global filters (codes have array kontext/quelle)
function codePassesFilter(cData, code) {
    if (state.kombiExclude && code && isComboCode(code)) return false;
    if (state.kontext !== 'Alle') {
        const k = cData.kontext;
        if (Array.isArray(k) && !k.includes(state.kontext)) return false;
        if (typeof k === 'string' && k !== state.kontext) return false;
    }
    if (state.quelle !== 'Alle') {
        const q = cData.quelle;
        if (Array.isArray(q) && !q.includes(state.quelle)) return false;
        if (typeof q === 'string' && q !== state.quelle) return false;
    }
    return true;
}

// Check if a verwendung entry passes the quelle/kontext filter
function verwendungPassesFilter(u) {
    if (state.quelle !== 'Alle' && (u.quelle || '') !== state.quelle) return false;
    if (state.kontext !== 'Alle' && (u.kontext || '') !== state.kontext) return false;
    if (state.deqs && u.verfahren && !isDeqs(u.verfahren)) return false;
    return true;
}

// === Build flat lists from data ===
function buildListenFlat() {
    const rows = [];
    for (const ct of ALL_CODE_TYPES) {
        const listen = DATA.listen[ct] || {};
        for (const [name, info] of Object.entries(listen)) {
            let verf = info.verfahren || '';
            if (!verf) {
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
    for (const ct of ALL_CODE_TYPES) {
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
    try {
        const resp = await fetch(`data/dashboard_${CURRENT_YEAR}.json?v=${Date.now()}`);
        if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
        DATA = await resp.json();

        // Build module->verfahren reverse map
        MODULE_TO_VERF = {};
        for (const [vName, vData] of Object.entries(DATA.verfahren)) {
            for (const mName of (vData.module || [])) {
                MODULE_TO_VERF[mName] = vName;
            }
        }

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

    // Kombi toggle
    $('#kombi-toggle').addEventListener('click', () => {
        state.kombiExclude = !state.kombiExclude;
        const btn = $('#kombi-toggle');
        btn.classList.toggle('active', state.kombiExclude);
        btn.textContent = state.kombiExclude ? 'An' : 'Aus';
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

    // Detail Modal
    $('#modal-close').addEventListener('click', closeModal);
    $('#modal-overlay').addEventListener('click', (e) => {
        if (e.target === $('#modal-overlay')) closeModal();
    });

    // Sankey modal
    $('#sankey-modal').addEventListener('click', (e) => {
        if (e.target === $('#sankey-modal')) closeSankeyModal();
    });

    // Chord fullscreen modal
    $('#chord-fullscreen-modal').addEventListener('click', (e) => {
        if (e.target === $('#chord-fullscreen-modal')) closeChordFullscreen();
    });

    // Close modals on Escape
    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') {
            closeModal();
            closeSankeyModal();
            closeChordFullscreen();
        }
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
            if (tab.dataset.tab === 'analyse' && chartsNeedUpdate) {
                renderAllCharts();
            }
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
    renderChartsIfVisible();
}

// === STATS ===
function renderStats() {
    const s = DATA.meta.statistik;
    const grid = $('#stats-grid');

    // Count filtered
    const fVerf = Object.entries(DATA.verfahren).filter(([name]) => !state.deqs || isDeqs(name));
    const fMod = Object.entries(DATA.module).filter(([, m]) => passesGlobalFilter(m));
    const fListen = LISTEN_FLAT.filter(l => passesGlobalFilter(l));
    const fCodes = CODES_FLAT.filter(c => {
        if (state.kombiExclude && isComboCode(c.code)) return false;
        return passesGlobalFilter(c);
    });

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
        if (state.kombiExclude && isComboCode(c.code)) return false;
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

// ============================
// === CHARTS ===
// ============================

function setChartType(chart, typ) {
    chartTypeFilter[chart] = typ;
    document.querySelectorAll(`#${chart}-type-filter .filter-pill`).forEach(p => {
        p.classList.toggle('active', (p.dataset.typ || '') === typ);
    });
    if (chart === 'treemap') {
        renderTreemap();
    } else if (chart === 'chord') {
        renderChord(computeVerfahrenOverlap(chartTypeFilter.chord));
    } else if (chart === 'network') {
        renderNetwork(computeVerfahrenOverlap(chartTypeFilter.network));
    }
}

function renderChartsIfVisible() {
    const analyseTab = $('#tab-analyse');
    if (analyseTab && analyseTab.classList.contains('active')) {
        renderAllCharts();
    } else {
        chartsNeedUpdate = true;
    }
}

function renderAllCharts() {
    chartsNeedUpdate = false;
    renderStackedBar();
    renderHeatmap();
    renderTreemap();
    const overlap = computeVerfahrenOverlap(chartTypeFilter.chord);
    renderChord(overlap);
    const overlapNet = chartTypeFilter.network === chartTypeFilter.chord ? overlap : computeVerfahrenOverlap(chartTypeFilter.network);
    renderNetwork(overlapNet);
}

function computeVerfahrenOverlap(typeFilter) {
    const verfSizes = {};
    for (const [vName] of Object.entries(DATA.verfahren)) {
        if (state.deqs && !isDeqs(vName)) continue;
        verfSizes[vName] = 0;
    }

    const codeToVerf = [];
    const typesToCheck = typeFilter ? [typeFilter] : ALL_CODE_TYPES;
    for (const ct of typesToCheck) {
        for (const [code, cData] of Object.entries(DATA.codes[ct] || {})) {
            if (!codePassesFilter(cData, code)) continue;
            const verfs = new Set();
            for (const u of (cData.verwendung || [])) {
                if (!verfSizes.hasOwnProperty(u.verfahren)) continue;
                if (!verwendungPassesFilter(u)) continue;
                verfs.add(u.verfahren);
            }
            for (const v of verfs) verfSizes[v]++;
            if (verfs.size > 1) codeToVerf.push(verfs);
        }
    }

    const verfNames = Object.keys(verfSizes).sort();
    const n = verfNames.length;
    const nameToIdx = {};
    verfNames.forEach((name, i) => nameToIdx[name] = i);

    const matrix = Array.from({ length: n }, () => new Array(n).fill(0));
    const chordMatrix = Array.from({ length: n }, () => new Array(n).fill(0));
    const sharedCount = new Array(n).fill(0);

    for (const verfs of codeToVerf) {
        const arr = [...verfs];
        const k = arr.length;
        const weight = 1 / (k - 1);
        for (let i = 0; i < k; i++) {
            sharedCount[nameToIdx[arr[i]]]++;
            for (let j = i + 1; j < k; j++) {
                const a = nameToIdx[arr[i]], b = nameToIdx[arr[j]];
                matrix[a][b]++;
                matrix[b][a]++;
                chordMatrix[a][b] += weight;
                chordMatrix[b][a] += weight;
            }
        }
    }

    // Diagonal = unique codes (not shared with any other Verfahren)
    for (let i = 0; i < n; i++) {
        const total = verfSizes[verfNames[i]] || 0;
        chordMatrix[i][i] = total - sharedCount[i];
    }

    return { verfNames, matrix, chordMatrix, verfSizes };
}

function renderStackedBar() {
    const container = $('#chart-stacked-bar');
    if (!container) return;
    container.innerHTML = '';

    // Dynamically compute per-Verfahren counts respecting filters
    const verfCounts = {};
    for (const [vName] of Object.entries(DATA.verfahren)) {
        if (state.deqs && !isDeqs(vName)) continue;
        if (state.quelle !== 'Alle') {
            const hasModule = DATA.verfahren[vName].module.some(mn => {
                const mod = DATA.module[mn];
                return mod && mod.quelle === state.quelle;
            });
            if (!hasModule) continue;
        }
        verfCounts[vName] = {};
        for (const ct of ALL_CODE_TYPES) verfCounts[vName][ct] = 0;
    }

    for (const ct of ALL_CODE_TYPES) {
        for (const [code, cData] of Object.entries(DATA.codes[ct] || {})) {
            if (!codePassesFilter(cData, code)) continue;
            const counted = new Set();
            for (const u of (cData.verwendung || [])) {
                if (!verfCounts[u.verfahren]) continue;
                if (!verwendungPassesFilter(u)) continue;
                if (!counted.has(u.verfahren)) {
                    counted.add(u.verfahren);
                    verfCounts[u.verfahren][ct]++;
                }
            }
        }
    }

    const rows = [];
    for (const [name, counts] of Object.entries(verfCounts)) {
        const total = Object.values(counts).reduce((s, v) => s + v, 0);
        if (total > 0) rows.push({ name, ...counts, total });
    }
    rows.sort((a, b) => b.total - a.total);

    if (rows.length === 0) { container.innerHTML = '<p class="empty-state">Keine Daten</p>'; return; }

    const margin = { top: 10, right: 100, bottom: 30, left: 120 };
    const barH = 24;
    const width = 600;
    const height = rows.length * barH + margin.top + margin.bottom;

    const svg = d3.select(container).append('svg')
        .attr('viewBox', `0 0 ${width} ${height}`)
        .append('g').attr('transform', `translate(${margin.left},${margin.top})`);

    const types = ALL_CODE_TYPES.filter(ct => rows.some(r => r[ct] > 0));
    const colors = { ops: '#006064', icd: '#7c3aed', gop: '#db2777', pzn: '#5E7F2E', drg: '#ea580c', sonstige: '#656D72' };

    const innerW = width - margin.left - margin.right;
    const innerH = height - margin.top - margin.bottom;

    const x = d3.scaleLinear().domain([0, d3.max(rows, d => d.total)]).range([0, innerW]);
    const y = d3.scaleBand().domain(rows.map(d => d.name)).range([0, innerH]).padding(0.2);

    const stack = d3.stack().keys(types);
    const series = stack(rows);

    svg.append('g').selectAll('g').data(series).join('g')
        .attr('fill', d => colors[d.key])
        .selectAll('rect').data(d => d).join('rect')
        .attr('x', d => x(d[0]))
        .attr('y', d => y(d.data.name))
        .attr('width', d => Math.max(0, x(d[1]) - x(d[0])))
        .attr('height', y.bandwidth())
        .attr('rx', 2);

    svg.append('g').call(d3.axisLeft(y).tickSize(0))
        .selectAll('text').attr('font-size', '9px');
    svg.select('.domain').remove();
    svg.append('g').attr('transform', `translate(0,${innerH})`)
        .call(d3.axisBottom(x).ticks(5)).selectAll('text').attr('font-size', '9px');

    const legend = svg.append('g').attr('transform', `translate(${innerW + 8}, 0)`);
    types.forEach((t, i) => {
        legend.append('rect').attr('x', 0).attr('y', i * 16).attr('width', 10).attr('height', 10).attr('fill', colors[t]).attr('rx', 2);
        legend.append('text').attr('x', 14).attr('y', i * 16 + 9).text(t.toUpperCase()).attr('font-size', '9px').attr('fill', '#333333');
    });
}

function renderHeatmap() {
    const container = $('#chart-heatmap');
    if (!container) return;
    container.innerHTML = '';

    const rows = [];
    for (const [name, data] of Object.entries(DATA.module)) {
        if (state.deqs && !isDeqs(MODULE_TO_VERF[name] || data.verfahren || '')) continue;
        if (state.quelle !== 'Alle' && (data.quelle || '') !== state.quelle) continue;
        if (state.kontext !== 'Alle' && data.kontext !== state.kontext) continue;
        const counts = {};
        let total = 0;
        for (const ct of ALL_CODE_TYPES) {
            const c = (data[ct]?.einschluss_codes_distinct || 0) + (data[ct]?.ausschluss_codes_distinct || 0);
            counts[ct] = c;
            total += c;
        }
        if (total > 0) rows.push({ name, ...counts });
    }
    rows.sort((a, b) => a.name.localeCompare(b.name, 'de'));

    if (rows.length === 0) { container.innerHTML = '<p class="empty-state">Keine Daten</p>'; return; }

    const types = ALL_CODE_TYPES.filter(ct => rows.some(r => r[ct] > 0));
    const maxVal = d3.max(rows, d => d3.max(types, t => d[t]));

    const cellW = 56, cellH = 18;
    const margin = { top: 28, right: 10, bottom: 10, left: 110 };
    const width = types.length * cellW + margin.left + margin.right;
    const height = rows.length * cellH + margin.top + margin.bottom;

    const svg = d3.select(container).append('svg')
        .attr('viewBox', `0 0 ${width} ${height}`)
        .attr('width', width).attr('height', height)
        .append('g').attr('transform', `translate(${margin.left},${margin.top})`);

    const color = d3.scaleSequential(d3.interpolateBlues).domain([0, maxVal]);

    for (let ri = 0; ri < rows.length; ri++) {
        for (let ti = 0; ti < types.length; ti++) {
            const val = rows[ri][types[ti]];
            svg.append('rect')
                .attr('x', ti * cellW).attr('y', ri * cellH)
                .attr('width', cellW - 2).attr('height', cellH - 2)
                .attr('fill', val > 0 ? color(val) : '#f0f0f0')
                .attr('rx', 2);
            if (val > 0) {
                svg.append('text')
                    .attr('x', ti * cellW + cellW / 2 - 1).attr('y', ri * cellH + cellH / 2 + 1)
                    .attr('text-anchor', 'middle').attr('dominant-baseline', 'middle')
                    .attr('font-size', '8px').attr('fill', val > maxVal * 0.6 ? 'white' : '#333333')
                    .text(val);
            }
        }
    }

    rows.forEach((r, i) => {
        svg.append('text').attr('x', -4).attr('y', i * cellH + cellH / 2)
            .attr('text-anchor', 'end').attr('dominant-baseline', 'middle')
            .attr('font-size', '8px').text(r.name);
    });

    types.forEach((t, i) => {
        svg.append('text').attr('x', i * cellW + cellW / 2 - 1).attr('y', -10)
            .attr('text-anchor', 'middle').attr('font-size', '10px').attr('font-weight', 'bold')
            .text(t.toUpperCase());
    });
}

function renderTreemap() {
    const container = $('#chart-treemap');
    if (!container) return;
    container.innerHTML = '';

    const tf = chartTypeFilter.treemap;
    const typesToShow = tf ? [tf] : ALL_CODE_TYPES;

    const children = [];
    for (const [vName, vData] of Object.entries(DATA.verfahren)) {
        if (state.deqs && !isDeqs(vName)) continue;
        const moduleChildren = [];
        for (const mName of vData.module) {
            const mod = DATA.module[mName];
            if (!mod) continue;
            if (state.quelle !== 'Alle' && (mod.quelle || '') !== state.quelle) continue;
            if (state.kontext !== 'Alle' && mod.kontext !== state.kontext) continue;
            let total = 0;
            for (const ct of typesToShow) {
                total += (mod[ct]?.einschluss_codes_distinct || 0) + (mod[ct]?.ausschluss_codes_distinct || 0);
            }
            if (total > 0) moduleChildren.push({ name: mName, value: total });
        }
        if (moduleChildren.length > 0) children.push({ name: vName, children: moduleChildren });
    }

    if (children.length === 0) { container.innerHTML = '<p class="empty-state">Keine Daten</p>'; return; }

    const width = 900, height = 420;
    const root = d3.treemap().size([width, height]).padding(2).paddingTop(16)(
        d3.hierarchy({ name: 'root', children }).sum(d => d.value).sort((a, b) => b.value - a.value)
    );

    const colorScale = d3.scaleOrdinal(d3.schemeTableau10);

    const svg = d3.select(container).append('svg').attr('viewBox', `0 0 ${width} ${height}`);

    const groups = svg.selectAll('.vgroup').data(root.children).join('g').attr('class', 'vgroup');
    groups.append('rect')
        .attr('x', d => d.x0).attr('y', d => d.y0)
        .attr('width', d => d.x1 - d.x0).attr('height', d => d.y1 - d.y0)
        .attr('fill', 'none')
        .attr('stroke', (d, i) => colorScale(i)).attr('stroke-width', 1.5)
        .append('title').text(d => `${d.data.name}\n${d.children.length} Module, ${d.value} Codes`);

    groups.filter(d => (d.x1 - d.x0) > 50).append('text')
        .attr('x', d => d.x0 + 3).attr('y', d => d.y0 + 12)
        .attr('font-size', '9px').attr('font-weight', 'bold')
        .attr('fill', (d, i) => colorScale(i))
        .text(d => d.data.name);

    const leaves = svg.selectAll('.leaf').data(root.leaves()).join('g').attr('class', 'leaf');
    leaves.append('rect')
        .attr('x', d => d.x0).attr('y', d => d.y0)
        .attr('width', d => d.x1 - d.x0).attr('height', d => d.y1 - d.y0)
        .attr('fill', d => {
            const pIdx = root.children.indexOf(d.parent);
            const c = d3.color(colorScale(pIdx));
            c.opacity = 0.35;
            return c + '';
        })
        .attr('rx', 2)
        .append('title').text(d => {
            const mod = DATA.module[d.data.name];
            const bez = mod?.bezeichnung || '';
            return `${d.data.name}\n${bez}\n${d.value} Codes`;
        });

    leaves.filter(d => (d.x1 - d.x0) > 35 && (d.y1 - d.y0) > 14).append('text')
        .attr('x', d => d.x0 + 2).attr('y', d => d.y0 + 11)
        .attr('font-size', '7px').attr('fill', '#333333')
        .text(d => {
            const w = d.x1 - d.x0;
            const name = d.data.name;
            const maxChars = Math.floor(w / 4.5);
            return name.length > maxChars ? name.substring(0, maxChars - 1) + '..' : name;
        });

    leaves.filter(d => (d.x1 - d.x0) > 25 && (d.y1 - d.y0) > 24).append('text')
        .attr('x', d => d.x0 + 2).attr('y', d => d.y0 + 20)
        .attr('font-size', '7px').attr('fill', '#666')
        .text(d => d.value);
}

function renderChord(overlap, targetId) {
    const containerId = targetId || 'chart-chord';
    const container = document.getElementById(containerId);
    if (!container) return;
    container.innerHTML = '';
    const isFullscreen = !!targetId && targetId !== 'chart-chord';

    const { verfNames, matrix, chordMatrix, verfSizes } = overlap;
    const n = verfNames.length;
    if (n < 2) { container.innerHTML = '<p class="empty-state">Zu wenige Verfahren</p>'; return; }

    const hasData = chordMatrix.some(row => row.some(v => v > 0));
    if (!hasData) { container.innerHTML = '<p class="empty-state">Keine Daten</p>'; return; }

    const size = 480;
    const outerRadius = size / 2 - 60;
    const innerRadius = outerRadius - 18;

    const svg = d3.select(container).append('svg')
        .attr('viewBox', `0 0 ${size} ${size}`)
        .append('g').attr('transform', `translate(${size/2},${size/2})`);

    const chord = d3.chord().padAngle(0.04).sortSubgroups(d3.descending);
    const chords = chord(chordMatrix);
    const color = d3.scaleOrdinal(d3.schemeTableau10);
    const arc = d3.arc().innerRadius(innerRadius).outerRadius(outerRadius);
    const ribbon = d3.ribbon().radius(innerRadius);

    const group = svg.append('g').selectAll('g').data(chords.groups).join('g')
        .style('cursor', 'pointer')
        .on('click', (event, d) => {
            if (isFullscreen) closeChordFullscreen();
            showSankeyModal(verfNames[d.index]);
        });
    group.append('path').attr('d', arc).attr('fill', d => color(d.index)).attr('stroke', '#fff');

    group.append('text')
        .each(d => { d.angle = (d.startAngle + d.endAngle) / 2; })
        .attr('dy', '0.35em')
        .attr('transform', d => `rotate(${(d.angle * 180 / Math.PI - 90)}) translate(${outerRadius + 6})${d.angle > Math.PI ? ' rotate(180)' : ''}`)
        .attr('text-anchor', d => d.angle > Math.PI ? 'end' : null)
        .attr('font-size', '8px')
        .text(d => `${verfNames[d.index].replace('QS ', '')} (${verfSizes[verfNames[d.index]] || 0})`);

    svg.append('g').attr('fill-opacity', 0.55)
        .selectAll('path').data(chords.filter(d => d.source.index !== d.target.index)).join('path')
        .attr('d', ribbon)
        .attr('fill', d => color(d.source.index))
        .attr('stroke', '#fff').attr('stroke-width', 0.5)
        .append('title').text(d => `${verfNames[d.source.index]} \u2194 ${verfNames[d.target.index]}: ${matrix[d.source.index][d.target.index]} gemeinsame Codes`);
}

function renderNetwork(overlap) {
    const container = document.getElementById('chart-network');
    if (!container) return;
    container.innerHTML = '';

    const { verfNames, matrix, verfSizes } = overlap;
    if (verfNames.length === 0) { container.innerHTML = '<p class="empty-state">Keine Daten</p>'; return; }

    const nodes = verfNames.map(name => ({ id: name, size: verfSizes[name] || 0 }));
    const links = [];
    for (let i = 0; i < verfNames.length; i++) {
        for (let j = i + 1; j < verfNames.length; j++) {
            if (matrix[i][j] > 0) {
                links.push({ source: verfNames[i], target: verfNames[j], value: matrix[i][j] });
            }
        }
    }

    const width = 500, height = 400;
    const svg = d3.select(container).append('svg').attr('viewBox', `0 0 ${width} ${height}`);

    const maxOverlap = d3.max(links, d => d.value) || 1;
    const maxSize = d3.max(nodes, d => d.size) || 1;
    const color = d3.scaleOrdinal(d3.schemeTableau10);

    const simulation = d3.forceSimulation(nodes)
        .force('link', d3.forceLink(links).id(d => d.id).distance(120))
        .force('charge', d3.forceManyBody().strength(-250))
        .force('center', d3.forceCenter(width / 2, height / 2))
        .force('collision', d3.forceCollide().radius(d => 10 + (d.size / maxSize) * 16))
        .alpha(0.6).alphaDecay(0.05);

    const link = svg.append('g').selectAll('line').data(links).join('line')
        .attr('stroke', '#94a3b8')
        .attr('stroke-width', d => Math.max(1, (d.value / maxOverlap) * 5))
        .attr('stroke-opacity', 0.4);

    const node = svg.append('g').selectAll('g').data(nodes).join('g');
    node.append('circle')
        .attr('r', d => 6 + (d.size / maxSize) * 14)
        .attr('fill', (d, i) => color(i))
        .attr('stroke', '#fff').attr('stroke-width', 1.5);

    node.append('text')
        .attr('dy', d => -(10 + (d.size / maxSize) * 14))
        .attr('text-anchor', 'middle').attr('font-size', '8px').attr('font-weight', 'bold')
        .text(d => d.id.replace('QS ', ''));

    const linkLabel = svg.append('g').selectAll('text').data(links.filter(l => l.value >= 3)).join('text')
        .attr('text-anchor', 'middle').attr('font-size', '7px').attr('fill', '#656D72');

    simulation.on('tick', () => {
        link.attr('x1', d => d.source.x).attr('y1', d => d.source.y)
            .attr('x2', d => d.target.x).attr('y2', d => d.target.y);
        node.attr('transform', d => `translate(${Math.max(20, Math.min(width - 20, d.x))},${Math.max(20, Math.min(height - 20, d.y))})`);
        linkLabel
            .attr('x', d => (d.source.x + d.target.x) / 2)
            .attr('y', d => (d.source.y + d.target.y) / 2)
            .text(d => d.value);
    });
}

// ============================
// === SANKEY MODAL ===
// ============================
let sankeyState = { verfahren: '', typeFilter: '' };
const sankeyCodeTable = {
    allCodes: [],
    sortCol: 'code',
    sortDir: 'asc',
    page: 1,
    perPage: 50,
    activeNode: null,
};

function showSankeyModal(verfahrenName, typeFilter) {
    sankeyState.verfahren = verfahrenName;
    sankeyState.typeFilter = typeFilter || '';
    renderSankey();
    $('#sankey-modal').classList.remove('hidden');
    document.body.style.overflow = 'hidden';
}

function setSankeyType(typ) {
    sankeyState.typeFilter = typ;
    sankeyCodeTable.activeNode = null;
    renderSankey();
}

function renderSankey() {
    const verfahrenName = sankeyState.verfahren;
    const tf = sankeyState.typeFilter;
    const body = $('#sankey-modal-body');
    body.innerHTML = '';
    sankeyCodeTable.activeNode = null;

    $('#sankey-modal-title').textContent = `Code-Sharing: ${verfahrenName}`;

    const typesToShow = tf ? [tf] : ALL_CODE_TYPES;
    let pillsHtml = '<div class="filter-pills" style="margin-bottom:1rem;">';
    const allTypes = ['', ...ALL_CODE_TYPES];
    for (const t of allTypes) {
        const label = t ? t.toUpperCase() : 'Alle';
        const active = t === tf ? ' active' : '';
        pillsHtml += `<span class="filter-pill${active}" onclick="setSankeyType('${t}')">${label}</span>`;
    }
    pillsHtml += '</div>';
    body.innerHTML = pillsHtml;

    const typeColors = { OPS: '#006064', ICD: '#7c3aed', GOP: '#db2777', PZN: '#5E7F2E', DRG: '#ea580c', Sonstige: '#656D72' };
    const sharing = {};
    const distinctPerType = {};

    for (const ct of typesToShow) {
        const label = ct.toUpperCase();
        distinctPerType[label] = new Set();
        for (const [code, cData] of Object.entries(DATA.codes[ct] || {})) {
            if (!codePassesFilter(cData, code)) continue;
            let inClicked = false;
            const others = new Set();
            for (const u of (cData.verwendung || [])) {
                if (!verwendungPassesFilter(u)) continue;
                if (u.verfahren === verfahrenName) inClicked = true;
                else if (u.verfahren) others.add(u.verfahren);
            }
            if (inClicked && others.size > 0) {
                distinctPerType[label].add(code);
                for (const ov of others) {
                    if (!sharing[ov]) sharing[ov] = {};
                    sharing[ov][label] = (sharing[ov][label] || 0) + 1;
                }
            }
        }
    }

    const otherVerfs = Object.keys(sharing).sort((a, b) => {
        const sa = Object.values(sharing[a]).reduce((s, v) => s + v, 0);
        const sb = Object.values(sharing[b]).reduce((s, v) => s + v, 0);
        return sb - sa;
    });

    if (otherVerfs.length === 0) {
        body.innerHTML += '<p class="empty-state">Keine geteilten Codes mit anderen Verfahren</p>';
        return;
    }

    // Build sankey nodes and links
    const activeTypes = new Set();
    for (const ov of otherVerfs) {
        for (const t of Object.keys(sharing[ov])) activeTypes.add(t);
    }
    const typeList = ALL_CODE_TYPES.map(ct => ct.toUpperCase()).filter(t => activeTypes.has(t));

    const nodes = [];
    const nodeIdx = {};
    for (const t of typeList) {
        nodeIdx[t] = nodes.length;
        nodes.push({ name: t, side: 'left' });
    }
    for (const ov of otherVerfs) {
        nodeIdx[ov] = nodes.length;
        nodes.push({ name: ov, side: 'right' });
    }

    const links = [];
    for (const ov of otherVerfs) {
        for (const t of typeList) {
            const val = sharing[ov][t] || 0;
            if (val > 0) links.push({ source: nodeIdx[t], target: nodeIdx[ov], value: val });
        }
    }

    const totalDistinct = new Set();
    for (const s of Object.values(distinctPerType)) { for (const c of s) totalDistinct.add(c); }
    const totalRelations = links.reduce((s, l) => s + l.value, 0);
    body.innerHTML += `<div style="font-size:0.8rem;color:var(--text-light);margin-bottom:0.5rem;">${totalDistinct.size} distinkte Codes geteilt in ${totalRelations.toLocaleString()} Beziehungen mit ${otherVerfs.length} Verfahren</div>`;

    // Render Sankey diagram
    const margin = { top: 10, right: 180, bottom: 10, left: 100 };
    const height = Math.max(300, Math.max(typeList.length, otherVerfs.length) * 40 + 40);
    const width = 920;
    const innerW = width - margin.left - margin.right;
    const innerH = height - margin.top - margin.bottom;

    const svg = d3.select('#sankey-modal-body').append('svg')
        .attr('viewBox', `0 0 ${width} ${height}`)
        .append('g').attr('transform', `translate(${margin.left},${margin.top})`);

    const sankey = d3.sankey()
        .nodeId(d => d.index)
        .nodeWidth(16)
        .nodePadding(12)
        .nodeAlign(d3.sankeyLeft)
        .extent([[0, 0], [innerW, innerH]]);

    const graph = sankey({ nodes: nodes.map(d => ({...d})), links: links.map(d => ({...d})) });

    // Links
    svg.append('g').attr('fill', 'none')
        .selectAll('path').data(graph.links).join('path')
        .attr('d', d3.sankeyLinkHorizontal())
        .attr('stroke', d => typeColors[graph.nodes[d.source.index].name] || '#94a3b8')
        .attr('stroke-opacity', 0.4)
        .attr('stroke-width', d => Math.max(1, d.width))
        .append('title').text(d => `${graph.nodes[d.source.index].name} \u2192 ${graph.nodes[d.target.index].name}: ${d.value} Codes`);

    // Nodes
    svg.append('g').selectAll('rect').data(graph.nodes).join('rect')
        .attr('class', 'sankey-node-rect')
        .attr('x', d => d.x0).attr('y', d => d.y0)
        .attr('height', d => d.y1 - d.y0)
        .attr('width', d => d.x1 - d.x0)
        .attr('fill', d => d.side === 'left' ? (typeColors[d.name] || '#94a3b8') : '#006064')
        .attr('rx', 2)
        .attr('opacity', 0.85)
        .style('cursor', 'pointer')
        .on('click', (event, d) => {
            event.stopPropagation();
            showSankeyCodes(d.side, d.name);
        });

    // Labels
    const labelG = svg.append('g').selectAll('g').data(graph.nodes).join('g')
        .attr('class', 'sankey-label-g')
        .style('cursor', 'pointer')
        .on('click', (event, d) => {
            event.stopPropagation();
            showSankeyCodes(d.side, d.name);
        });

    labelG.each(function(d) {
        const g = d3.select(this);
        const xPos = d.side === 'left' ? d.x0 - 6 : d.x1 + 6;
        const yPos = (d.y0 + d.y1) / 2;
        const anchor = d.side === 'left' ? 'end' : 'start';
        if (d.side === 'left') {
            const relations = graph.links.filter(l => l.source.index === d.index).reduce((s, l) => s + l.value, 0);
            const distinct = distinctPerType[d.name]?.size || 0;
            const t = g.append('text').attr('x', xPos).attr('y', yPos).attr('text-anchor', anchor).attr('font-size', '10px');
            t.append('tspan').attr('x', xPos).attr('dy', '-0.4em').attr('font-weight', 'bold').text(`${d.name} (${distinct} dist.`);
            t.append('tspan').attr('x', xPos).attr('dy', '1.2em').text(`/ ${relations} Bez.)`);
        } else {
            const relations = graph.links.filter(l => l.target.index === d.index).reduce((s, l) => s + l.value, 0);
            g.append('text').attr('x', xPos).attr('y', yPos).attr('dy', '0.35em').attr('text-anchor', anchor).attr('font-size', '10px').text(`${d.name} (${relations})`);
        }
    });
}

function showSankeyCodes(side, name) {
    if (sankeyCodeTable.activeNode && sankeyCodeTable.activeNode.side === side && sankeyCodeTable.activeNode.name === name) {
        sankeyCodeTable.activeNode = null;
        const existing = document.getElementById('sankey-code-table');
        if (existing) existing.remove();
        d3.selectAll('#sankey-modal-body .sankey-node-rect').attr('opacity', 0.85).attr('stroke', 'none');
        d3.selectAll('#sankey-modal-body .sankey-label-g').attr('opacity', 1);
        return;
    }

    sankeyCodeTable.activeNode = { side, name };
    const verfahrenName = sankeyState.verfahren;
    const tf = sankeyState.typeFilter;
    const typesToShow = tf ? [tf] : ALL_CODE_TYPES;

    const codeMap = new Map();

    if (side === 'left') {
        const ct = name.toLowerCase();
        for (const [code, cData] of Object.entries(DATA.codes[ct] || {})) {
            if (!codePassesFilter(cData, code)) continue;
            let inSource = false;
            const roles = new Set();
            const quellen = new Set();
            const others = new Set();
            for (const u of (cData.verwendung || [])) {
                if (!verwendungPassesFilter(u)) continue;
                if (u.verfahren === verfahrenName) {
                    inSource = true;
                    if (u.rolle) roles.add(u.rolle);
                    if (u.quelle) quellen.add(u.quelle);
                } else if (u.verfahren) {
                    others.add(u.verfahren);
                }
            }
            if (inSource && others.size > 0) {
                const g = cData.katalog?.gueltigkeit;
                const gueltig = g ? g[String(CURRENT_YEAR)] : null;
                codeMap.set(ct + ':' + code, {
                    code,
                    bezeichnung: cData.katalog?.bezeichnung || '',
                    codeTyp: ct,
                    rolle: [...roles],
                    quelle: [...quellen],
                    geteiltMit: [...others].sort(),
                    gueltig,
                });
            }
        }
    } else {
        const targetVerf = name;
        for (const ct of typesToShow) {
            for (const [code, cData] of Object.entries(DATA.codes[ct] || {})) {
                if (!codePassesFilter(cData, code)) continue;
                let inSource = false;
                let inTarget = false;
                const roles = new Set();
                const quellen = new Set();
                const others = new Set();
                for (const u of (cData.verwendung || [])) {
                    if (!verwendungPassesFilter(u)) continue;
                    if (u.verfahren === verfahrenName) {
                        inSource = true;
                        if (u.rolle) roles.add(u.rolle);
                        if (u.quelle) quellen.add(u.quelle);
                    } else {
                        if (u.verfahren === targetVerf) inTarget = true;
                        if (u.verfahren) others.add(u.verfahren);
                    }
                }
                if (inSource && inTarget) {
                    const key = ct + ':' + code;
                    if (!codeMap.has(key)) {
                        const g = cData.katalog?.gueltigkeit;
                        const gueltig = g ? g[String(CURRENT_YEAR)] : null;
                        codeMap.set(key, {
                            code,
                            bezeichnung: cData.katalog?.bezeichnung || '',
                            codeTyp: ct,
                            rolle: [...roles],
                            quelle: [...quellen],
                            geteiltMit: [...others].sort(),
                            gueltig,
                        });
                    }
                }
            }
        }
    }

    sankeyCodeTable.allCodes = Array.from(codeMap.values());
    sankeyCodeTable.sortCol = 'code';
    sankeyCodeTable.sortDir = 'asc';
    sankeyCodeTable.page = 1;
    sortSankeyCodeTable();
    renderSankeyCodePage();

    d3.selectAll('#sankey-modal-body .sankey-node-rect')
        .attr('opacity', d => (d.side === side && d.name === name) ? 1 : 0.3)
        .attr('stroke', d => (d.side === side && d.name === name) ? '#006064' : 'none')
        .attr('stroke-width', d => (d.side === side && d.name === name) ? 2 : 0);
    d3.selectAll('#sankey-modal-body .sankey-label-g')
        .attr('opacity', d => (d.side === side && d.name === name) ? 1 : 0.5);
}

function sortSankeyCodeTable() {
    const mul = sankeyCodeTable.sortDir === 'asc' ? 1 : -1;
    const col = sankeyCodeTable.sortCol;
    sankeyCodeTable.allCodes.sort((a, b) => {
        switch (col) {
            case 'code': return mul * a.code.localeCompare(b.code);
            case 'bezeichnung': return mul * (a.bezeichnung || '').localeCompare(b.bezeichnung || '', 'de');
            case 'codeTyp': return mul * a.codeTyp.localeCompare(b.codeTyp);
            case 'rolle': return mul * a.rolle.join(',').localeCompare(b.rolle.join(','));
            case 'quelle': return mul * a.quelle.join(',').localeCompare(b.quelle.join(','));
            case 'gueltig': {
                const va = a.gueltig === true ? 1 : a.gueltig === false ? -1 : 0;
                const vb = b.gueltig === true ? 1 : b.gueltig === false ? -1 : 0;
                return mul * (va - vb);
            }
            default: return 0;
        }
    });
}

function handleSankeyCodeSort(col) {
    if (sankeyCodeTable.sortCol === col) {
        sankeyCodeTable.sortDir = sankeyCodeTable.sortDir === 'asc' ? 'desc' : 'asc';
    } else {
        sankeyCodeTable.sortCol = col;
        sankeyCodeTable.sortDir = (col === 'code' || col === 'bezeichnung' || col === 'codeTyp') ? 'asc' : 'desc';
    }
    sortSankeyCodeTable();
    sankeyCodeTable.page = 1;
    renderSankeyCodePage();
}

function renderSankeyCodePage() {
    const total = sankeyCodeTable.allCodes.length;
    const totalPages = Math.max(1, Math.ceil(total / sankeyCodeTable.perPage));
    const page = Math.min(sankeyCodeTable.page, totalPages);
    const start = (page - 1) * sankeyCodeTable.perPage;
    const pageItems = sankeyCodeTable.allCodes.slice(start, start + sankeyCodeTable.perPage);

    let container = document.getElementById('sankey-code-table');
    if (!container) {
        container = document.createElement('div');
        container.id = 'sankey-code-table';
        document.getElementById('sankey-modal-body').appendChild(container);
    }

    if (total === 0) {
        container.innerHTML = '<p class="empty-state" style="margin-top:1rem;">Keine geteilten Codes gefunden</p>';
        return;
    }

    const an = sankeyCodeTable.activeNode;
    const title = an.side === 'left'
        ? `Geteilte ${an.name}-Codes von ${sankeyState.verfahren}`
        : `Gemeinsame Codes: ${sankeyState.verfahren} \u2194 ${an.name}`;

    const cols = [
        { key: 'code', label: 'Code' },
        { key: 'bezeichnung', label: 'Bezeichnung' },
        { key: 'codeTyp', label: 'Code-Typ' },
        { key: 'rolle', label: 'Rolle' },
        { key: 'quelle', label: 'Quelle' },
        { key: 'geteiltMit', label: 'Geteilt mit' },
        { key: 'gueltig', label: String(CURRENT_YEAR) },
    ];

    let html = `<div style="font-weight:600;font-size:0.8rem;color:var(--text-light);margin-top:1.5rem;margin-bottom:0.5rem;text-transform:uppercase;border-bottom:1px solid var(--border);padding-bottom:0.5rem;">${title}</div>`;
    html += `<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:0.5rem;">
        <span style="font-size:0.8rem;color:var(--text-light);">${total.toLocaleString()} Codes | Seite ${page} von ${totalPages}</span>
    </div>`;
    html += '<div style="max-height: 400px; overflow-y: auto;"><table class="data-table"><thead><tr>';
    for (const c of cols) {
        if (c.key === 'geteiltMit') {
            html += `<th>${c.label}</th>`;
        } else {
            html += `<th style="cursor:pointer" onclick="handleSankeyCodeSort('${c.key}')">${c.label}</th>`;
        }
    }
    html += '</tr></thead><tbody>';

    for (const item of pageItems) {
        const rolleHtml = item.rolle.map(r => {
            const b = r === 'EINSIN' ? 'ein' : 'aus';
            const label = r === 'EINSIN' ? 'Einschluss' : 'Ausschluss';
            return badge(b, label);
        }).join(' ');

        const quelleHtml = item.quelle.map(q => quelleBadge(q)).join(' ');
        const bezShort = (item.bezeichnung || '').length > 40 ? item.bezeichnung.substring(0, 40) + '...' : (item.bezeichnung || '');
        const gueltigIcon = item.gueltig === true ? badge('ein', '\u2713') :
                            item.gueltig === false ? badge('aus', '\u2717') :
                            '<span class="badge" style="background:#9e9e9e">?</span>';
        const geteiltMitFull = item.geteiltMit.join(', ');
        const geteiltMitStr = item.geteiltMit.length <= 3
            ? geteiltMitFull
            : item.geteiltMit.slice(0, 2).join(', ') + ` +${item.geteiltMit.length - 2}`;

        html += `<tr>
            <td><span style="cursor:pointer;color:var(--primary);font-weight:500" onclick="closeSankeyModal();openCodeModal('${item.code}','${item.codeTyp}')">${item.code}</span></td>
            <td style="font-size:0.8rem;max-width:200px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;" title="${item.bezeichnung || ''}">${bezShort}</td>
            <td>${item.codeTyp.toUpperCase()}</td>
            <td>${rolleHtml}</td>
            <td>${quelleHtml}</td>
            <td style="font-size:0.75rem;" title="${geteiltMitFull}">${geteiltMitStr}</td>
            <td>${gueltigIcon}</td>
        </tr>`;
    }
    html += '</tbody></table></div>';

    if (totalPages > 1) {
        html += '<div class="pagination">';
        html += `<button onclick="goSankeyCodePage(1)" ${page === 1 ? 'disabled' : ''}>&laquo;</button>`;
        html += `<button onclick="goSankeyCodePage(${page - 1})" ${page === 1 ? 'disabled' : ''}>&lsaquo;</button>`;
        let rs = Math.max(1, page - 3), re = Math.min(totalPages, page + 3);
        if (rs > 1) html += '<span class="page-info">...</span>';
        for (let i = rs; i <= re; i++) {
            html += `<button class="${i === page ? 'active' : ''}" onclick="goSankeyCodePage(${i})">${i}</button>`;
        }
        if (re < totalPages) html += '<span class="page-info">...</span>';
        html += `<button onclick="goSankeyCodePage(${page + 1})" ${page === totalPages ? 'disabled' : ''}>&rsaquo;</button>`;
        html += `<button onclick="goSankeyCodePage(${totalPages})" ${page === totalPages ? 'disabled' : ''}>&raquo;</button>`;
        html += '</div>';
    }

    container.innerHTML = html;
    setTimeout(() => container.scrollIntoView({ behavior: 'smooth', block: 'nearest' }), 50);
}

function goSankeyCodePage(p) {
    const totalPages = Math.ceil(sankeyCodeTable.allCodes.length / sankeyCodeTable.perPage);
    sankeyCodeTable.page = Math.max(1, Math.min(p, totalPages));
    renderSankeyCodePage();
}

function closeSankeyModal() {
    $('#sankey-modal').classList.add('hidden');
    document.body.style.overflow = '';
}

// ============================
// === CHORD FULLSCREEN ===
// ============================
let chordFullscreenType = '';

function openChordFullscreen() {
    chordFullscreenType = chartTypeFilter.chord;
    const body = document.getElementById('chord-fullscreen-body');
    let pillsHtml = '<div class="filter-pills" style="margin-bottom:1rem;">';
    const types = [{ key: '', label: 'Alle' }, ...ALL_CODE_TYPES.map(t => ({ key: t, label: t.toUpperCase() }))];
    for (const t of types) {
        const active = (t.key === chordFullscreenType) ? ' active' : '';
        pillsHtml += `<span class="filter-pill${active}" data-typ="${t.key}" onclick="setChordFullscreenType('${t.key}')">${t.label}</span>`;
    }
    pillsHtml += '</div>';
    body.innerHTML = pillsHtml + '<div id="chord-fullscreen-chart"></div>';
    const overlap = computeVerfahrenOverlap(chordFullscreenType);
    renderChord(overlap, 'chord-fullscreen-chart');
    $('#chord-fullscreen-modal').classList.remove('hidden');
    document.body.style.overflow = 'hidden';
}

function setChordFullscreenType(typ) {
    chordFullscreenType = typ;
    document.querySelectorAll('#chord-fullscreen-body .filter-pill').forEach(p => {
        p.classList.toggle('active', (p.dataset.typ || '') === typ);
    });
    const overlap = computeVerfahrenOverlap(typ);
    renderChord(overlap, 'chord-fullscreen-chart');
    setChartType('chord', typ);
}

function closeChordFullscreen() {
    $('#chord-fullscreen-modal').classList.add('hidden');
    document.body.style.overflow = '';
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
