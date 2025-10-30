/*
  Digital Field Book – QA/QC GPS (Fresh Start)
  Mobile-first, Android/iOS friendly
  - Editable inputs only (station, knownElev[BS], bs[BS], fs[FS], gps[FS])
  - Calculated cells locked (hi, elev, delta)
  - Median/Mean HI toggle
  - Per-setup lock toggle
  - LocalStorage persistence
*/
(function(){
  const APP_VERSION = '2025.10.30-1';
  const STORAGE_KEY = 'dfb_v3_state';

  const els = {
    title: byId('jobTitle'),
    date: byId('jobDate'),
    status: byId('statusChip'),
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
    meta: { title:'', date: todayISO(), thresholds:{ green:0.030, yellow:0.040 }, appVersion: APP_VERSION },
    settings: { useMedian: true },
    setups: [],
    active: 0, // index
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

  // Ensure at least one setup
  if(state.setups.length === 0) addSetup();
  render();

  // -------- Core data helpers --------
  function addSetup(){
    state.setups.push({ locked:false, rows:[] });
    state.active = state.setups.length - 1;
  }

  function activeSetup(){ return state.setups[state.active]; }

  function addRow(kind){
    const s = activeSetup();
    if(s.locked){ flash('Setup is locked'); return; }
    if(kind === 'BS'){
      s.rows.push({ id: uid(), type:'BS', station:'', knownElev:null, bs:null, hi:null });
    } else {
      s.rows.push({ id: uid(), type:'FS', station:'', fs:null, elev:null, gps:null, delta:null });
    }
    recompute(s);
  }

  function toggleLock(){
    const s = activeSetup();
    s.locked = !s.locked;
  }

  function commitMeta(){
    state.meta.title = els.title.value.trim();
    state.meta.date = els.date.value || todayISO();
    state.meta.appVersion = APP_VERSION; // keep in sync
    saveState();
  }

  function recomputeActive(){ recompute(activeSetup()); }

  function recompute(setup){
    // HI per BS
    setup.rows.forEach(r => {
      if(r.type==='BS'){
        if(isNum(r.knownElev) && isNum(r.bs)) r.hi = round3(r.knownElev + r.bs);
        else r.hi = null;
      }
    });
    // aggregate HI
    const his = setup.rows.filter(r=>r.type==='BS' && isNum(r.hi)).map(r=>r.hi);
    const hiAgg = his.length ? (state.settings.useMedian ? median(his) : mean(his)) : null;

    // ELEV & Δ for FS
    setup.rows.forEach(r => {
      if(r.type==='FS'){
        if(isNum(hiAgg) && isNum(r.fs)) r.elev = round3(hiAgg - r.fs); else r.elev = null;
        if(isNum(r.gps) && isNum(r.elev)) r.delta = round3(Math.abs(r.gps - r.elev)); else r.delta = null;
      }
    });
  }

  // -------- Render --------
  function render(){
    // Tabs
    els.tabs.innerHTML = '';
    state.setups.forEach((s, i) => {
      const b = document.createElement('button');
      b.className = 'chip';
      b.textContent = `Setup ${i+1}${s.locked?' 🔒':''}`;
      if(i===state.active){ b.style.borderColor = '#0ea5e9'; b.style.color = '#7dd3fc'; }
      b.addEventListener('click', ()=>{ state.active = i; render(); saveState(); });
      els.tabs.appendChild(b);
    });

    // Lock button icon
    els.btnLock.textContent = activeSetup().locked ? '🔓 Unlock' : '🔒 Lock';

    // Table body
    els.gridBody.innerHTML='';
    const s = activeSetup();

    s.rows.forEach((r, idx) => {
      const tr = document.createElement('tr');

      // Type pill
      tr.appendChild(tdPill(r.type));

      // Station (editable both types)
      tr.appendChild(makeCell(r, 'station', r.station, s.locked));

      // Known Elev (BS only)
      tr.appendChild(r.type==='BS' ? makeCell(r,'knownElev', r.knownElev, s.locked) : tdDim());

      // BS (m) or dim
      tr.appendChild(r.type==='BS' ? makeCell(r,'bs', r.bs, s.locked) : tdDim());

      // HI (calc)
      tr.appendChild(makeCalc(r.hi));

      // FS (m) or dim
      tr.appendChild(r.type==='FS' ? makeCell(r,'fs', r.fs, s.locked) : tdDim());

      // ELEV (calc)
      tr.appendChild(makeCalc(r.elev));

      // GPS (FS editable)
      tr.appendChild(r.type==='FS' ? makeCell(r,'gps', r.gps, s.locked) : tdDim());

      // Δ GPS (calc + colored)
      tr.appendChild(makeDelta(r.delta));

      // Delete
      const tdDel = document.createElement('td');
      const del = document.createElement('button');
      del.textContent = '✕'; del.className='ghost';
      del.addEventListener('click', ()=>{ if(s.locked) return flash('Setup is locked'); s.rows.splice(idx,1); recompute(s); render(); saveState(); });
      tdDel.appendChild(del);
      tr.appendChild(tdDel);

      els.gridBody.appendChild(tr);
    });

    updateSummary();
  }

  function tdPill(type){
    const td = document.createElement('td');
    const span = document.createElement('span');
    span.className = 'pill ' + (type==='BS'?'type-bs':'type-fs');
    span.textContent = type;
    td.appendChild(span);
    return td;
  }

  function tdDim(){ const td=document.createElement('td'); td.textContent='—'; td.className='cell-calc'; return td; }

  function makeCalc(value){
    const td = document.createElement('td');
    td.className = 'cell-calc';
    td.textContent = isNum(value) ? num3(value) : '—';
    return td;
  }

  function makeDelta(delta){
    const td = makeCalc(delta);
    if(isNum(delta)){
      const cls = qaClass(delta, state.meta.thresholds);
      if(cls) td.classList.add(cls);
    }
    return td;
  }

  function makeCell(row, field, value, locked){
    const td = document.createElement('td');
    const editable = isEditableField(row, field) && !locked;

    if(!editable){
      td.className = 'cell-calc';
      td.textContent = isNum(value) ? num3(value) : (value ?? '');
      return td;
    }

    td.className = 'cell-edit';

    if(field === 'station'){
      const input = document.createElement('input');
      input.type = 'text';
      input.className = 'cell-input';
      input.inputMode = 'text';
      input.autocapitalize = 'characters';
      input.spellcheck = false;
      input.placeholder = '';
      input.value = (value ?? '').toString();
      input.addEventListener('blur', ()=>{
        row.station = input.value.trim();
        saveState();
      });
      td.appendChild(input);
      return td;
    }

    // numeric inputs (BS knownElev, BS, FS, GPS)
    const input = document.createElement('input');
    input.type = 'text';            // keep as text for better control of minus/decimal
    input.className = 'cell-input';
    input.inputMode = 'decimal';    // mobile numeric keypad with decimal
    input.enterKeyHint = 'next';
    input.autocorrect = 'off';
    input.autocomplete = 'off';
    input.spellcheck = false;
    input.placeholder = '';
    input.value = isNum(value) ? String(value) : (value ?? '');

    input.addEventListener('blur', ()=>{
      const v = sanitizeNumber(input.value);
      row[field] = (v === null ? null : v);
      recompute(activeSetup());
      render();
      saveState();
    });

    td.appendChild(input);
    return td;
  }

  function isEditableField(row, field){
    if(field === 'station') return true;
    if(row.type==='BS') return (field==='knownElev' || field==='bs');
    if(row.type==='FS') return (field==='fs' || field==='gps');
    return false;
  }

  function qaClass(delta, thr){
    if(delta <= thr.green) return 'qa-green';
    if(delta <= thr.yellow) return 'qa-yellow';
    return 'qa-red';
  }

  function updateSummary(){
    let bs=0, fs=0, g=0, y=0, r=0;
    state.setups.forEach(s=>{
      s.rows.forEach(row=>{
        if(row.type==='BS') bs++; else fs++;
        if(isNum(row.delta)){
          const cls = qaClass(row.delta, state.meta.thresholds);
          if(cls==='qa-green') g++; else if(cls==='qa-yellow') y++; else r++;
        }
      })
    })
    els.summary.textContent = `Setups: ${state.setups.length} • BS: ${bs} • FS: ${fs} • G/Y/R: ${g}/${y}/${r}`;
  }

  // -------- Storage --------
  function saveState(andStatus){
    try{ localStorage.setItem(STORAGE_KEY, JSON.stringify(state)); if(andStatus) setStatus('Saved'); }
    catch(e){ setStatus('Save failed'); console.error(e); }
  }
  function loadState(){
    try{
      const raw = localStorage.getItem(STORAGE_KEY);
      if(!raw) return null;
      const s = JSON.parse(raw);
      // Version check: if stored version mismatches current app, start fresh
      if(!s?.meta?.appVersion || s.meta.appVersion !== APP_VERSION){
        // Optionally keep a backup for debugging
        try{ localStorage.setItem(STORAGE_KEY + '_backup_' + Date.now(), raw); }catch(e){}
        localStorage.removeItem(STORAGE_KEY);
        return null;
      }
      return s;
    } catch(e){ return null; }
  }
    catch(e){ return null; }
  }

  function hardReset(){
    if(confirm('Reset all data?')){
      localStorage.removeItem(STORAGE_KEY); location.reload();
    }
  }

  // -------- Utils --------
  function byId(id){ return document.getElementById(id); }
  function todayISO(){ return new Date().toISOString().slice(0,10); }
  function uid(){ return Math.random().toString(36).slice(2,9); }
  function isNum(v){ return typeof v==='number' && isFinite(v); }
  function round3(v){ return Math.round(v*1000)/1000; }
  function num3(v){ return (Math.round(v*1000)/1000).toFixed(3); }
  function mean(a){ return a.length ? a.reduce((s,x)=>s+x,0)/a.length : null; }
  function median(a){ if(!a.length) return null; const b=[...a].sort((x,y)=>x-y); const m=Math.floor(b.length/2); return b.length%2? b[m] : (b[m-1]+b[m])/2; }
  function sanitizeNumber(str){
    if(str == null) return null;
    let s = String(str).trim();
    if(!s) return null;
    // Normalize comma decimals to dot
    s = s.replace(',', '.');
    // Allow only digits, optional leading sign, single dot
    const cleaned = s.replace(/[^0-9+\-\.]/g,'');
    if(cleaned === '' || cleaned === '-' || cleaned === '.' || cleaned === '+') return null;
    const n = Number(cleaned);
    return isFinite(n) ? n : null;
  }
  function setStatus(msg){ els.status.textContent = msg; setTimeout(()=>{ els.status.textContent='Ready'; }, 1200); }
  function flash(msg){ setStatus(msg); }
})();