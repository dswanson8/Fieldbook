/*
  Field Book – Mobile-first (Light Mode)
  - 6 columns: STA | BS | HI | FS | ELEV | GPS
  - BS rows: edit STA, BS, ELEV(=Known Elev); HI calc; FS/GPS disabled
  - FS rows: edit STA, FS, GPS; HI/ELEV calc
  - Numeric inputs use inputmode="decimal" for mobile keypad
  - Median/Mean HI toggle
  - Per-setup lock
  - localStorage with version bust
*/
(function () {
    const APP_VERSION = '2025.10.30-4';
    const STORAGE_KEY = 'dfb_v3_state';

    const els = {
        title: byId('jobTitle'),
        date: byId('jobDate'),
        tabs: byId('setupTabs'),
        gridBody: byId('gridBody'),
        btnNewSetup: byId('newSetupBtn'),
        btnAddBs: byId('addBsBtn'),
        btnAddFs: byId('addFsBtn'),
        btnLock: byId('lockToggle'),
        btnSave: byId('saveBtn'),
        btnReset: byId('resetBtn'),
        aggMedian: byId('aggMedian'),
        aggMean: byId('aggMean'),
        summary: byId('summary'),
    };

    const state = loadState() || {
        meta: { title: '', date: todayISO(), thresholds: { green: 0.030, yellow: 0.040 }, appVersion: APP_VERSION },
        settings: { useMedian: true },
        setups: [],
        active: 0,
    };

    // Init
    els.title.value = state.meta.title;
    els.date.value = state.meta.date;
    els.aggMedian.checked = !!state.settings.useMedian;
    els.aggMean.checked = !state.settings.useMedian;

    els.title.addEventListener('input', commitMeta);
    els.date.addEventListener('input', commitMeta);

    els.btnNewSetup.addEventListener('click', () => { addSetup(); render(); saveState(); });
    els.btnAddBs.addEventListener('click', () => { addRow('BS'); render(); saveState(); });
    els.btnAddFs.addEventListener('click', () => { addRow('FS'); render(); saveState(); });
    els.btnLock.addEventListener('click', () => { toggleLock(); render(); saveState(); });
    els.btnSave.addEventListener('click', () => { saveState(true); flash('Saved'); });
    els.btnReset.addEventListener('click', hardReset);

    els.aggMedian.addEventListener('change', () => { state.settings.useMedian = true; recomputeActive(); render(); saveState(); });
    els.aggMean.addEventListener('change', () => { state.settings.useMedian = false; recomputeActive(); render(); saveState(); });

    if (state.setups.length === 0) addSetup();
    render();

    // --- Core
    function addSetup() {
        state.setups.push({ locked: false, rows: [] });
        state.active = state.setups.length - 1;
    }
    function activeSetup() { return state.setups[state.active]; }

    function addRow(kind) {
        const s = activeSetup();
        if (s.locked) { flash('Setup is locked'); return; }
        if (kind === 'BS') {
            // Always insert BS rows at the top
            s.rows.unshift({ id: uid(), type: 'BS', station: '', knownElev: null, bs: null, hi: null });
        } else {
            // FS rows still append to the bottom
            s.rows.push({ id: uid(), type: 'FS', station: '', fs: null, elev: null, gps: null, delta: null });
        }

        recompute(s);
    }

    function toggleLock() { activeSetup().locked = !activeSetup().locked; }
    function commitMeta() {
        state.meta.title = els.title.value.trim();
        state.meta.date = els.date.value || todayISO();
        state.meta.appVersion = APP_VERSION;
        saveState();
    }
    function recomputeActive() { recompute(activeSetup()); }

    function recompute(setup) {
        // HI per BS
        setup.rows.forEach(r => {
            if (r.type === 'BS') {
                if (isNum(r.knownElev) && isNum(r.bs)) r.hi = round3(r.knownElev + r.bs);
                else r.hi = null;
            }
        });
        // aggregate HI
        const his = setup.rows.filter(r => r.type === 'BS' && isNum(r.hi)).map(r => r.hi);
        const hiAgg = his.length ? (state.settings.useMedian ? median(his) : mean(his)) : null;

        // FS elev + delta
        setup.rows.forEach(r => {
            if (r.type === 'FS') {
                r.elev = (isNum(hiAgg) && isNum(r.fs)) ? round3(hiAgg - r.fs) : null;
                r.delta = (isNum(r.gps) && isNum(r.elev)) ? round3(Math.abs(r.gps - r.elev)) : null;
            }
        });
    }

    // --- Render
    function render() {
        // tabs
        els.tabs.innerHTML = '';
        state.setups.forEach((s, i) => {
            const b = document.createElement('button');
            b.className = 'chip';
            b.textContent = `Setup ${i + 1}${s.locked ? ' 🔒' : ''}`;
            if (i === state.active) { b.style.borderColor = '#60a5fa'; b.style.color = '#1d4ed8'; }
            b.addEventListener('click', () => { state.active = i; render(); saveState(); });
            els.tabs.appendChild(b);
        });

        // lock label
        els.btnLock.textContent = activeSetup().locked ? '🔓 Unlock' : '🔒 Lock';

        // table
        els.gridBody.innerHTML = '';
        const s = activeSetup();

        s.rows.forEach((r, idx) => {
            const tr = document.createElement('tr');

            // STA
            const tdSta = makeCell(r, 'station', r.station, s.locked);
            attachRowDelete(tdSta, s, idx);
            tr.appendChild(tdSta);

            // BS (only for BS rows)
            tr.appendChild(r.type === 'BS' ? makeCell(r, 'bs', r.bs, s.locked) : tdDim());

            // HI (calc)
            tr.appendChild(makeCalc(r.hi));

            // FS (only for FS rows)
            tr.appendChild(r.type === 'FS' ? makeCell(r, 'fs', r.fs, s.locked) : tdDim());

            // ELEV: BS=Known Elev (editable), FS=calc elev
            tr.appendChild(r.type === 'BS' ? makeCell(r, 'knownElev', r.knownElev, s.locked) : makeCalc(r.elev));

            // GPS (FS editable + color by Δ = |GPS - ELEV|)
            if (r.type === 'FS') {
                const tdGps = makeCell(r, 'gps', r.gps, s.locked);
                if (isNum(r.delta)) {
                    const thr = state.meta.thresholds; // { green:0.030, yellow:0.040 }
                    tdGps.classList.add(
                        r.delta <= thr.green ? 'qa-green' :
                            r.delta <= thr.yellow ? 'qa-yellow' : 'qa-red'
                    );
                }
                tr.appendChild(tdGps);
            } else {
                tr.appendChild(tdDim());
            }


            els.gridBody.appendChild(tr);
        });

        updateSummary();
    }

    function attachRowDelete(td, setup, idx) {
        let timer = null;
        const start = () => { timer = setTimeout(() => { if (setup.locked) return flash('Setup is locked'); if (confirm('Delete this row?')) { setup.rows.splice(idx, 1); recompute(setup); render(); saveState(); } }, 600); };
        const clear = () => { if (timer) { clearTimeout(timer); timer = null; } };
        td.addEventListener('touchstart', start, { passive: true });
        td.addEventListener('touchend', clear);
        td.addEventListener('touchmove', clear);
        td.addEventListener('mousedown', start);
        td.addEventListener('mouseup', clear);
        td.addEventListener('mouseleave', clear);
        td.addEventListener('contextmenu', (e) => { e.preventDefault(); if (setup.locked) return flash('Setup is locked'); if (confirm('Delete this row?')) { setup.rows.splice(idx, 1); recompute(setup); render(); saveState(); } });
    }

    function tdDim() {
        const td = document.createElement('td');
        td.textContent = '—';
        td.className = 'cell-calc';
        return td;
    }

    function makeCalc(value, delta) {
        const td = document.createElement('td');
        td.className = 'cell-calc';
        td.textContent = isNum(value) ? num3(value) : '—';

        // If it's a GPS delta cell, apply color code
        if (isNum(delta)) {
            if (delta <= 0.030) td.classList.add('qa-green');
            else if (delta <= 0.040) td.classList.add('qa-yellow');
            else td.classList.add('qa-red');
        }

        return td;
    }

    function makeCell(row, field, value, locked) {
        const td = document.createElement('td');
        const editable = isEditableField(row, field) && !locked;

        if (!editable) {
            td.className = 'cell-calc';
            if (isNum(value)) {
                // Always show 3 decimal places, even for whole or single-decimal numbers
                td.textContent = num3(value);
            } else {
                td.textContent = (value ?? '');
            }
            return td;
        }


        td.className = 'cell-edit';

        if (field === 'station') {
            const input = document.createElement('input');
            input.type = 'text';
            input.className = 'cell-input';
            input.inputMode = 'text';
            input.autocapitalize = 'characters';
            input.spellcheck = false;
            input.value = (value ?? '').toString();
            input.addEventListener('blur', () => {
                row.station = input.value.trim();
                saveState();
            });
            td.appendChild(input);
            return td;
        }

        // numeric inputs
        const input = document.createElement('input');
        input.type = 'text';
        input.className = 'cell-input';
        input.inputMode = 'decimal';
        input.enterKeyHint = 'next';
        input.autocorrect = 'off';
        input.autocomplete = 'off';
        input.spellcheck = false;
        input.value = isNum(value) ? String(value) : (value ?? '');

        input.addEventListener('blur', () => {
            const raw = input.value.trim();
            const v = sanitizeNumber(raw);

            // Only auto-convert when the user typed an integer (mm) with NO decimal/comma
            let value = v;
            if (v !== null) {
                const typedHasDecimal = /[.,]/.test(raw); // true if user already typed meters like 681.791 or 0.989
                if (!typedHasDecimal) {
                    value = v / 1000; // e.g., 681791 -> 681.791, 989 -> 0.989
                }
            }

            row[field] = (value === null ? null : value);
            recompute(activeSetup());
            render();
            saveState();
        });

        td.appendChild(input);
        return td;
    }

    function isEditableField(row, field) {
        if (field === 'station') return true;
        if (row.type === 'BS') return (field === 'bs' || field === 'knownElev'); // ELEV column acts as Known Elev for BS rows
        if (row.type === 'FS') return (field === 'fs' || field === 'gps');
        return false;
    }

    function updateSummary() {
        let summaryLines = state.setups.map((s, i) => {
            const bsRows = s.rows.filter(r => r.type === 'BS');
            const his = bsRows.filter(r => isNum(r.hi)).map(r => r.hi);
            const med = his.length ? median(his) : null;
            const avg = his.length ? mean(his) : null;

            return `Setup ${i + 1} • BS: <b>${bsRows.length}</b> • Median HI: <b>${isNum(med) ? num3(med) : '—'}</b> • Mean HI: <b>${isNum(avg) ? num3(avg) : '—'}</b>`;
        });

        els.summary.innerHTML = summaryLines.join('<br>');
    }



    // --- Storage
    function saveState(andStatus) {
        try {
            localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
            if (andStatus) setStatus('Saved');
        } catch (e) { setStatus('Save failed'); console.error(e); }
    }
    function loadState() {
        try {
            const raw = localStorage.getItem(STORAGE_KEY);
            if (!raw) return null;
            const s = JSON.parse(raw);
            if (!s?.meta?.appVersion || s.meta.appVersion !== APP_VERSION) {
                try { localStorage.setItem(STORAGE_KEY + '_backup_' + Date.now(), raw); } catch (_) { }
                localStorage.removeItem(STORAGE_KEY);
                return null;
            }
            return s;
        } catch (e) { return null; }
    }

    function hardReset() {
        if (confirm('Reset all data?')) {
            localStorage.removeItem(STORAGE_KEY);
            location.reload();
        }
    }

    // --- Utils
    function byId(id) { return document.getElementById(id); }
    function todayISO() { return new Date().toISOString().slice(0, 10); }
    function uid() { return Math.random().toString(36).slice(2, 9); }
    function isNum(v) { return typeof v === 'number' && isFinite(v); }
    function round3(v) { return Math.round(v * 1000) / 1000; }
    function num3(v) { return (Math.round(v * 1000) / 1000).toFixed(3); }
    function mean(a) { return a.length ? a.reduce((s, x) => s + x, 0) / a.length : null; }
    function median(a) { if (!a.length) return null; const b = [...a].sort((x, y) => x - y); const m = Math.floor(b.length / 2); return b.length % 2 ? b[m] : (b[m - 1] + b[m]) / 2; }
    function sanitizeNumber(str) {
        if (str == null) return null;
        let s = String(str).trim();
        if (!s) return null;
        s = s.replace(',', '.'); // allow comma decimal
        const cleaned = s.replace(/[^0-9+\-\.]/g, '');
        if (cleaned === '' || cleaned === '-' || cleaned === '.' || cleaned === '+') return null;
        const n = Number(cleaned);
        return isFinite(n) ? n : null;
    }
    function setStatus(msg) { els.status.textContent = msg; setTimeout(() => { els.status.textContent = 'Ready'; }, 1200); }
    function flash(msg) { setStatus(msg); }
})();
