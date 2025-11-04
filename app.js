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
    const SLOPE_STORAGE_KEY = 'dfb_slopecalc_v1';

    const els = {
        title: byId('jobTitle'),
        date: byId('jobDate'),
        tabs: byId('setupTabs'),
        gridBody: byId('gridBody'),
        btnNewSetup: byId('newSetupBtn'),
        btnAddBs: byId('addBsBtn'),
        btnAddFs: byId('addFsBtn'),
        btnLock: byId('lockToggle'),
        // btnSave: byId('saveBtn'),
        btnExportAll: byId('exportAllBtn'),
        btnReset: byId('resetBtn'),
        // btnExport: byId('exportPrintBtn'),
        aggMedian: byId('aggMedian'),
        aggMean: byId('aggMean'),
        summary: byId('summary'),

        // --- Tools Flyout ---
        toolsBtn: byId('toolsBtn'),
        toolsSheet: byId('toolsSheet'),
        toolsBackdrop: byId('toolsBackdrop'),
        toolsClose: byId('toolsClose'),

        // --- Slope Checker Fields ---
        scStartSta: byId('scStartSta'),
        scEndSta: byId('scEndSta'),
        scDStart: byId('scDStart'),
        scDEnd: byId('scDEnd'),
        scAStart: byId('scAStart'),
        scAEnd: byId('scAEnd'),
        scLen: byId('scLen'),
        scResults: byId('scResults'),
        scCompute: byId('scCompute'),
        scClear: byId('scClear'),

        // --- Existing BS Picker ---
        existingBsBar: byId('existingBsBar'),
        btnAddExistingBs: byId('addExistingBsBtn'),
        bsPickerSheet: byId('bsPickerSheet'),
        bsPickerBackdrop: byId('bsPickerBackdrop'),
        bsPickerClose: byId('bsPickerClose'),
        bsPickerList: byId('bsPickerList'),
        bsPickerUse: byId('bsPickerUse'),
        bsPickerCancel: byId('bsPickerCancel'),

    };

    function toast(msg) {
        const t = document.createElement('div');
        t.textContent = msg;
        t.style.cssText = `
            position: fixed;
            bottom: 16px;
            left: 50%;
            transform: translateX(-50%);
            background: #1f2937;
            color: #ffffff;
            padding: 10px 16px;
            border-radius: 8px;
            font-size: 14px;
            z-index: 9999;
            opacity: 0;
            text-align: center;
            transition: opacity 0.2s, transform 0.2s;
            pointer-events: none;
        `;
        document.body.appendChild(t);

        requestAnimationFrame(() => {
            t.style.opacity = 1;
            t.style.transform = 'translateX(-50%) translateY(-4px)';
        });

        setTimeout(() => {
            t.style.opacity = 0;
            t.style.transform = 'translateX(-50%) translateY(0)';
            setTimeout(() => t.remove(), 200);
        }, 1400);
    }


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
    // els.btnSave.addEventListener('click', () => { saveState(true); flash('Saved'); });
    els.btnExportAll.addEventListener('click', exportAllPrintable);
    els.btnReset.addEventListener('click', hardReset);
    // els.btnExport.addEventListener('click', exportPrintable);

    // --- Tools Flyout ---
    els.toolsBtn?.addEventListener('click', openTools);
    els.toolsBackdrop?.addEventListener('click', closeTools);
    els.toolsClose?.addEventListener('click', closeTools);

    // --- Slope Checker actions (placeholder for now) ---
    els.scCompute?.addEventListener('click', computeSlopeCheck);
    els.scClear?.addEventListener('click', clearSlopeCheck);

    // Open picker
    els.btnAddExistingBs?.addEventListener('click', openBsPicker);

    // Close picker
    els.bsPickerBackdrop?.addEventListener('click', closeBsPicker);
    els.bsPickerClose?.addEventListener('click', closeBsPicker);
    els.bsPickerCancel?.addEventListener('click', closeBsPicker);

    // Confirm/Insert
    // els.bsPickerUse?.addEventListener('click', insertBsFromPicker);

    els.bsPickerList?.addEventListener('click', (e) => {
        const btn = e.target.closest('button.bs-btn');
        if (!btn) return;
        insertBsFromData(btn.dataset.station, sanitizeNumber(btn.dataset.elev));
    });


    els.aggMedian.addEventListener('change', () => {
        const s = activeSetup();
        s.useMedian = true;
        recompute(s);
        render();
        saveState();
    });

    els.aggMean.addEventListener('change', () => {
        const s = activeSetup();
        s.useMedian = false;
        recompute(s);
        render();
        saveState();
    });

    if (state.setups.length === 0) addSetup();
    render();

    // --- Core
    function addSetup() {
        state.setups.push({ locked: false, rows: [], useMedian: true });
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
        const hiAgg = his.length ? (setup.useMedian ? median(his) : mean(his)) : null;


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

        // Show the bar only when not on Setup 1
        if (els.existingBsBar) {
            if (state.active > 0) {
                els.existingBsBar.classList.remove('hidden');
            } else {
                els.existingBsBar.classList.add('hidden');
            }
        }

        // lock label
        els.btnLock.textContent = activeSetup().locked ? '🔓 Unlock' : '🔒 Lock';

        // table
        els.gridBody.innerHTML = '';
        const s = activeSetup();
        els.aggMedian.checked = !!s.useMedian;
        els.aggMean.checked = !s.useMedian;

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
        const lines = state.setups.map((s, i) => {
            const bsRows = s.rows.filter(r => r.type === 'BS');
            const his = bsRows.filter(r => isNum(r.hi)).map(r => r.hi);
            const med = his.length ? median(his) : null;
            const avg = his.length ? mean(his) : null;

            const medPart = s.useMedian
                ? `<span class="hi-active">Median HI: <b>${isNum(med) ? num3(med) : '—'}</b></span>`
                : `Median HI: <b>${isNum(med) ? num3(med) : '—'}</b>`;

            const avgPart = !s.useMedian
                ? `<span class="hi-active">Mean HI: <b>${isNum(avg) ? num3(avg) : '—'}</b></span>`
                : `Mean HI: <b>${isNum(avg) ? num3(avg) : '—'}</b>`;

            return `Setup ${i + 1} • BS: <b>${bsRows.length}</b> • ${medPart} • ${avgPart}`;
        });

        els.summary.innerHTML = lines.join('<br>');
    }

    // --- helpers ---
    function escapeHtml(s) {
        return String(s).replace(/[&<>"']/g, m => (
            { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[m]
        ));
    }

    function exportAllPrintable() {
        const thr = state.meta.thresholds;
        const title = state.meta.title || 'Field Book';
        const date = state.meta.date || todayISO();
        const fmt = v => isNum(v) ? num3(v) : '—';

        // Build one printable HTML with a section per setup (page break between)
        const sections = state.setups.map((s, i) => {
            // HI summary for this setup
            const his = s.rows.filter(r => r.type === 'BS' && isNum(r.hi)).map(r => r.hi);
            const med = his.length ? median(his) : null;
            const avg = his.length ? mean(his) : null;
            const mode = s.useMedian ? 'Median' : 'Mean';

            // Table rows
            const rowsHtml = s.rows.map(r => {
                const tds = [];
                tds.push(`<td>${escapeHtml(r.station ?? '')}</td>`);
                tds.push(`<td>${r.type === 'BS' ? fmt(r.bs) : '—'}</td>`);
                tds.push(`<td>${r.type === 'BS' ? fmt(r.hi) : '—'}</td>`);
                tds.push(`<td>${r.type === 'FS' ? fmt(r.fs) : '—'}</td>`);
                tds.push(`<td>${r.type === 'BS' ? fmt(r.knownElev) : (r.type === 'FS' ? fmt(r.elev) : '—')}</td>`);

                // GPS with Δ-based coloring (only for FS rows)
                let gpsHtml = r.type === 'FS' ? fmt(r.gps) : '—';
                let cellStyle = '';
                if (r.type === 'FS' && isNum(r.delta)) {
                    cellStyle =
                        r.delta <= thr.green ? ' style="background:#dcfce7"' :   /* green-100 */
                            r.delta <= thr.yellow ? ' style="background:#fef3c7"' :   /* amber-100 */
                                ' style="background:#fee2e2"';    /* red-100   */
                }
                tds.push(`<td${cellStyle}>${gpsHtml}</td>`);
                return `<tr>${tds.join('')}</tr>`;
            }).join('');

            return `
            <section class="page">
                <h2>${escapeHtml(title)} — Setup ${i + 1}</h2>
                <div class="meta">
                <div><b>Date:</b> ${escapeHtml(date)}</div>
                <div><b>HI Mode:</b> ${mode}
                    &nbsp; <b>Median HI:</b> ${isNum(med) ? num3(med) : '—'}
                    &nbsp; <b>Mean HI:</b> ${isNum(avg) ? num3(avg) : '—'}</div>
                <div class="muted">GPS Δ thresholds: green ≤ ${num3(thr.green)} • yellow ≤ ${num3(thr.yellow)}</div>
                </div>
                <table>
                <thead><tr><th>STA</th><th>BS</th><th>HI</th><th>FS</th><th>ELEV</th><th>GPS</th></tr></thead>
                <tbody>${rowsHtml}</tbody>
                </table>
            </section>`;
        }).join('');

        const html = `<!doctype html><html><head><meta charset="utf-8">
        <title>${escapeHtml(title)} — All Setups</title>
        <style>
            body{font-family:Inter,system-ui,-apple-system,Segoe UI,Roboto,Arial,sans-serif;color:#111;margin:24px;}
            h1,h2{margin:0 0 6px;}
            h2{font-size:18px;}
            .meta{margin:0 0 12px;color:#444}
            .muted{color:#555}
            table{width:100%;border-collapse:collapse;font-size:14px}
            th,td{border:1px solid #ccc;padding:6px 8px;text-align:left}
            th{background:#f3f4f6}
            .page{margin-bottom:24px;}
            @media print{
            body{margin:0.5in;}
            .page{page-break-after: always;}
            .page:last-of-type{page-break-after: auto;}
            button{display:none}
            }
        </style>
        </head>
        <body>
            <h1>${escapeHtml(title)} — All Setups</h1>
            ${sections}
            <button onclick="window.print()">Print / Save as PDF</button>
        </body></html>`;

        const win = window.open('', '_blank');
        win.document.open();
        win.document.write(html);
        win.document.close();
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

    // --- Tools Flyout Control ---
    function openTools() {
        const sheet = els.toolsSheet;
        if (!sheet) { console.warn('Tools sheet not found in HTML'); return; }
        sheet.classList.remove('hidden');
        sheet.setAttribute('aria-hidden', 'false');

        // Restore last computed inputs (if any) and show results
        try {
            const raw = localStorage.getItem(SLOPE_STORAGE_KEY);
            if (raw) {
                const s = JSON.parse(raw);
                if (s) {
                    if (els.scDStart) els.scDStart.value = s.dStart ?? '';
                    if (els.scDEnd) els.scDEnd.value = s.dEnd ?? '';
                    if (els.scAStart) els.scAStart.value = s.aStart ?? '';
                    if (els.scAEnd) els.scAEnd.value = s.aEnd ?? '';
                    if (els.scLen) els.scLen.value = s.len ?? '';
                    if (els.scStartSta) els.scStartSta.value = s.startSta ?? '';
                    if (els.scEndSta) els.scEndSta.value = s.endSta ?? '';
                    computeSlopeCheck(); // render results immediately
                }
            }
        } catch (e) { console.warn('Slope calc restore failed', e); }
    }

    function closeTools() {
        const sheet = els.toolsSheet;
        if (!sheet) { console.warn('Tools sheet not found in HTML'); return; }
        sheet.classList.add('hidden');
        sheet.setAttribute('aria-hidden', 'true');
    }


    // Helpers for the slope checker
    function mmToMeters(raw) {
        const str = String(raw ?? '').trim();
        const v = sanitizeNumber(str);
        if (v === null) return null;
        // Elevations: allow mm shorthand (no decimal/comma => divide by 1000)
        return /[.,]/.test(str) ? v : v / 1000;
    }
    function fmtRatioFromPercent(pct) {
        if (!isNum(pct) || pct === 0) return '—';
        const r = Math.round(100 / Math.abs(pct)); // 1 in X (integer)
        return `1 in ${r}`;
    }

    // Replace your placeholder with this:
    function computeSlopeCheck() {
        // Read inputs
        const dStart = mmToMeters(els.scDStart.value);
        const dEnd = mmToMeters(els.scDEnd.value);
        const aStart = mmToMeters(els.scAStart.value);
        const aEnd = mmToMeters(els.scAEnd.value);

        // Length is in meters (no mm auto-convert here)
        const lenRaw = String(els.scLen.value ?? '').trim();
        const len = sanitizeNumber(lenRaw); // meters

        // Compute slopes: % = ((start - end) / length) * 100
        // const dPct = (isNum(dStart) && isNum(dEnd) && isNum(len) && len !== 0)
        //     ? ((dStart - dEnd) / len) * 100 : null;
        // const aPct = (isNum(aStart) && isNum(aEnd) && isNum(len) && len !== 0)
        //     ? ((aStart - aEnd) / len) * 100 : null;

        // Compute slopes: POSITIVE when Top > Bottom (design convention)
        const dPct = (isNum(dStart) && isNum(dEnd) && isNum(len) && len !== 0)
            ? ((dEnd - dStart) / len) * 100   // Design: Top - Bottom
            : null;

        const aPct = (isNum(aStart) && isNum(aEnd) && isNum(len) && len !== 0)
            ? ((aEnd - aStart) / len) * 100   // ASB: Top - Bottom
            : null;


        const dPctTxt = isNum(dPct) ? `${num3(dPct)}%` : '—';
        const aPctTxt = isNum(aPct) ? `${num3(aPct)}%` : '—';

        const dRatio = fmtRatioFromPercent(dPct);
        const aRatio = fmtRatioFromPercent(aPct);

        // Deltas
        const deltaPct = (isNum(dPct) && isNum(aPct)) ? (aPct - dPct) : null; // ASB - Design
        const deltaEnd = (isNum(aEnd) && isNum(dEnd)) ? (aEnd - dEnd) : null;  // ASB end vs Design end

        const deltaStart = (isNum(aStart) && isNum(dStart)) ? (aStart - dStart) : null;

        const thr = { green: 0.05, yellow: 0.10 }; // % thresholds you requested
        let deltaClass = '';
        if (isNum(deltaPct)) {
            deltaClass = Math.abs(deltaPct) <= thr.green ? 'qa-green'
                : Math.abs(deltaPct) <= thr.yellow ? 'qa-yellow'
                    : 'qa-red';
        }

        const deltaPctTxt = isNum(deltaPct) ? `${num3(deltaPct)}%` : '—';
        const deltaEndTxt = isNum(deltaEnd) ? `${num3(deltaEnd)} m` : '—';

        // Render results
        els.scResults.innerHTML = `
            <div><b>Design Slope:</b> ${dPctTxt} &nbsp; <span class="muted">(${dRatio})</span></div>
            <div><b>ASB Slope:</b> ${aPctTxt} &nbsp; <span class="muted">(${aRatio})</span></div>
            <div><b>Δ Slope:</b> <span class="${deltaClass}">${deltaPctTxt}</span></div>
            <div><b>Δ Start:</b> ${isNum(deltaStart) ? deltaMmText(aStart, dStart) : '—'}</div>
            <div><b>Δ End:</b> ${isNum(deltaEnd) ? deltaMmText(aEnd, dEnd) : '—'}</div>
            `;

        // Persist inputs so the last computed calc survives refresh
        try {
            localStorage.setItem(SLOPE_STORAGE_KEY, JSON.stringify({
                dStart, dEnd, aStart, aEnd, len,
                startSta: els.scStartSta?.value ?? '',
                endSta: els.scEndSta?.value ?? ''
            }));
        } catch (e) { console.warn('Slope calc save failed', e); }


    }

    function clearSlopeCheck() {
        [
            els.scStartSta, els.scEndSta,
            els.scDStart, els.scDEnd,
            els.scAStart, els.scAEnd,
            els.scLen
        ].forEach(i => i && (i.value = ''));

        // Clear results UI
        els.scResults.innerHTML = '';

        // Remove persisted calc
        try { localStorage.removeItem(SLOPE_STORAGE_KEY); } catch (e) { }
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

    function setStatus(msg) { toast(msg); }
    function flash(msg) { toast(msg); }

    // function deltaMmText(asb, design) {
    //     if (!isNum(asb) || !isNum(design)) return '—';
    //     const mm = Math.round((asb - design) * 1000); // + = HIGH, - = LOW
    //     if (mm === 0) return '0 mm OK';
    //     return `${Math.abs(mm)} mm ${mm > 0 ? '<br class="text-small">HIGH</b>' : '<b class="text-small">LOW</b>'}`;
    // }

    function deltaMmText(asb, design) {
        if (!isNum(asb) || !isNum(design)) return '—';
        const mm = Math.round((asb - design) * 1000); // + = HIGH (asb above design)
        if (mm === 0) return `<span class="delta-zero">0 mm OK</span>`;
        const cls = mm > 0 ? 'delta-up' : 'delta-down';
        const arrow = mm > 0 ? '▲' : '▼';
        return `<span class="${cls}">${Math.abs(mm)} mm ${arrow}</span>`;
    }

    function openBsPicker() {
        const options = gatherElevStations();
        if (!options.length) { toast('No prior stations with elevation found'); return; }

        els.bsPickerList.className = 'bs-grid';
        els.bsPickerList.innerHTML = options.map(opt => `
            <button class="bs-btn" 
                    data-station="${escapeHtml(opt.station)}" 
                    data-elev="${opt.elev}">
            <div>${escapeHtml(opt.station || '(no STA)')}</div>
            <span class="bs-meta">Elev ${num3(opt.elev)} • Setup ${opt.setup + 1} • ${opt.source}</span>
            </button>
        `).join('');

        els.bsPickerSheet.classList.remove('hidden');
        els.bsPickerSheet.setAttribute('aria-hidden', 'false');
    }


    function closeBsPicker() {
        els.bsPickerSheet.classList.add('hidden');
        els.bsPickerSheet.setAttribute('aria-hidden', 'true');
    }

    function gatherElevStations() {
        const out = [];
        // Collect from ALL setups BEFORE the active one
        state.setups.forEach((s, si) => {
            if (si >= state.active) return; // prior setups only
            s.rows.forEach((r, ri) => {
                // BS rows: take knownElev if present
                if (r.type === 'BS' && isNum(r.knownElev)) {
                    out.push({
                        setup: si,
                        index: ri,
                        station: r.station || '',
                        elev: r.knownElev,
                        source: 'BS'
                    });
                }
                // FS rows: take computed elev if present
                if (r.type === 'FS' && isNum(r.elev)) {
                    out.push({
                        setup: si,
                        index: ri,
                        station: r.station || '',
                        elev: r.elev,
                        source: 'FS'
                    });
                }
            });
        });

        // Sort: newest setup first, then by row order
        out.sort((a, b) => (b.setup - a.setup) || (a.index - b.index));
        return out;
    }

    function insertBsFromPicker() {
        const checked = document.querySelector('input[name="bsPick"]:checked');
        if (!checked) { flash('Select a station first'); return; }

        const station = checked.getAttribute('data-station') || '';
        const elevStr = checked.getAttribute('data-elev');
        const elev = sanitizeNumber(elevStr);

        const s = activeSetup();
        if (s.locked) { flash('Setup is locked'); return; }

        // Insert a BS row at the TOP of the current setup
        s.rows.splice(0, 0, {
            id: uid(),
            type: 'BS',
            station: station,
            knownElev: isNum(elev) ? elev : null,
            bs: null,
            hi: null
        });

        recompute(s);
        render();
        saveState();
        closeBsPicker();
        flash('Existing BS added');
    }

    function insertBsFromData(station, elev) {
        const s = activeSetup();
        if (s.locked) return toast('Setup is locked');

        // Insert BS at the top of the active setup
        s.rows.splice(0, 0, {
            id: uid(),
            type: 'BS',
            station: station || '',
            knownElev: isNum(elev) ? elev : null,
            bs: null,
            hi: null
        });

        recompute(s);
        render();
        saveState();
        closeBsPicker();
        toast('Existing BS added');
    }




})();
