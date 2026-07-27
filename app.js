// Gestão de Plantel — Haras MANP. Vanilla JS SPA, IndexedDB persistence.

// ---------- utils ----------
function uid(){ return (crypto.randomUUID ? crypto.randomUUID() : 'id-'+Date.now()+'-'+Math.random().toString(16).slice(2)); }
function esc(s){ return (s==null?'':String(s)).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }
function parseBR(dstr){
  if(!dstr) return null;
  const m = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(dstr.trim());
  if(!m) return null;
  return new Date(+m[3], +m[2]-1, +m[1]);
}
function fmtBR(date){
  if(!date) return '';
  const d = String(date.getDate()).padStart(2,'0');
  const m = String(date.getMonth()+1).padStart(2,'0');
  return `${d}/${m}/${date.getFullYear()}`;
}
function todayDate(){ const t = new Date(); return new Date(t.getFullYear(), t.getMonth(), t.getDate()); }
function ageYears(nascStr){
  const d = parseBR(nascStr); if(!d) return null;
  const t = todayDate();
  let age = t.getFullYear() - d.getFullYear();
  const m = t.getMonth() - d.getMonth();
  if(m < 0 || (m===0 && t.getDate() < d.getDate())) age--;
  return age;
}
function daysUntil(dstr){
  const d = parseBR(dstr); if(!d) return null;
  return Math.round((d - todayDate())/86400000);
}
const MONTHS_PT = ['JAN','FEV','MAR','ABR','MAI','JUN','JUL','AGO','SET','OUT','NOV','DEZ'];
function initials(nome){
  const parts = (nome||'').trim().split(/\s+/).filter(Boolean);
  if(parts.length===0) return '?';
  if(parts.length===1) return parts[0].slice(0,2).toUpperCase();
  return (parts[0][0]+parts[1][0]).toUpperCase();
}
function sexLabel(s){ return s==='F' ? 'Égua' : s==='M' ? 'Garanhão' : 'Castrado'; }
const AVATAR_COLOR = { F:'#7A8B6F', M:'#8B5E3C', C:'#6E7B87' };
function healthStatus(proximaStr){
  const dd = daysUntil(proximaStr);
  if(dd === null) return {key:'ok', label:'Em dia'};
  if(dd < 0) return {key:'bad', label:'Atrasado'};
  if(dd <= 60) return {key:'warn', label:'Atenção'};
  return {key:'ok', label:'Em dia'};
}
function reproStatusInfo(status){
  if(status==='confirmada') return {key:'ok', label:'Gestante confirmada'};
  if(status==='agendada') return {key:'sched', label:'Cobrição agendada'};
  return {key:'warn', label:'Aguardando confirmação'};
}
function toast(msg){
  let el = document.getElementById('toast');
  if(!el){
    el = document.createElement('div');
    el.id = 'toast'; el.className = 'toast';
    document.body.appendChild(el);
  }
  el.textContent = msg;
  el.classList.add('show');
  clearTimeout(toast._t);
  toast._t = setTimeout(()=> el.classList.remove('show'), 1800);
}

// ---------- IndexedDB ----------
const DB_NAME = 'plantelDB', DB_VERSION = 1;
let _db = null;
function openDB(){
  return new Promise((resolve, reject)=>{
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = (e)=>{
      const db = e.target.result;
      if(!db.objectStoreNames.contains('animais')) db.createObjectStore('animais', {keyPath:'id'});
      if(!db.objectStoreNames.contains('cobricoes')) db.createObjectStore('cobricoes', {keyPath:'id'});
      if(!db.objectStoreNames.contains('saude')) db.createObjectStore('saude', {keyPath:'id'});
    };
    req.onsuccess = ()=>{ _db = req.result; resolve(_db); };
    req.onerror = ()=> reject(req.error);
  });
}
function tx(store, mode){ return _db.transaction(store, mode).objectStore(store); }
function dbGetAll(store){
  return new Promise((resolve,reject)=>{
    const req = tx(store,'readonly').getAll();
    req.onsuccess = ()=> resolve(req.result);
    req.onerror = ()=> reject(req.error);
  });
}
function dbPut(store, obj){
  return new Promise((resolve,reject)=>{
    const req = tx(store,'readwrite').put(obj);
    req.onsuccess = ()=> resolve(obj);
    req.onerror = ()=> reject(req.error);
  });
}

// ---------- state ----------
const state = {
  animais: [], cobricoes: [], saude: [],
  stack: [{screen:'splash'}],
  search: '', sexFilter: 'todos',
};
function cur(){ return state.stack[state.stack.length-1]; }
function navigate(screen, ctx={}){ state.stack.push({screen, ...ctx}); render(); }
function goBack(){ if(state.stack.length>1){ state.stack.pop(); render(); } }
function switchTab(screen){ state.stack = [{screen}]; render(); }

function activeAnimais(){ return state.animais.filter(a=>!a.removido); }
function animalById(id){ return state.animais.find(a=>a.id===id); }

async function loadAll(){
  state.animais = await dbGetAll('animais');
  state.cobricoes = await dbGetAll('cobricoes');
  state.saude = await dbGetAll('saude');
}

async function seedIfEmpty(){
  const existing = await dbGetAll('animais');
  if(existing.length>0) return;
  for(const a of SEED_ANIMAIS){
    await dbPut('animais', {
      id: uid(), nome:a.nome, sexo:a.sexo, nascimento:a.nascimento,
      registro:a.registro, pelagem:a.pelagem, pai:a.pai, mae:a.mae,
      removido:false, motivoRemocao:null, dataRemocao:null,
    });
  }
}

// ---------- mutations ----------
async function addAnimal(data){
  const obj = {id:uid(), removido:false, motivoRemocao:null, dataRemocao:null, ...data};
  await dbPut('animais', obj);
  state.animais.push(obj);
  return obj;
}
async function addCobricao(data){
  const obj = {id:uid(), ...data};
  await dbPut('cobricoes', obj);
  state.cobricoes.push(obj);
  return obj;
}
async function addSaude(data){
  const obj = {id:uid(), ...data};
  await dbPut('saude', obj);
  state.saude.push(obj);
  return obj;
}
async function removeAnimal(id, motivo){
  const a = animalById(id);
  if(!a) return;
  a.removido = true; a.motivoRemocao = motivo; a.dataRemocao = fmtBR(todayDate());
  await dbPut('animais', a);
}

// ---------- rendering ----------
const APP = document.getElementById('app');

function render(){
  const view = cur();
  let html = '';
  switch(view.screen){
    case 'splash': html = renderSplash(); break;
    case 'plantel': html = renderPlantel(); break;
    case 'ficha': html = renderFicha(view.animalId); break;
    case 'novoAnimal': html = renderNovoAnimal(); break;
    case 'novoCobricao': html = renderNovoCobricao(view.animalId); break;
    case 'novoSaude': html = renderNovoSaude(view.animalId); break;
    case 'reproducao': html = renderReproducao(); break;
    case 'saude': html = renderSaude(); break;
    case 'calendario': html = renderCalendario(); break;
    default: html = renderPlantel();
  }
  APP.innerHTML = `<div class="phone">${html}</div>`;
  attachGlobalEvents();
}

function tabBarHTML(active){
  const tabs = [
    {id:'plantel', label:'Plantel', icon:'<rect x="4" y="4" width="16" height="16" rx="3"/>'},
    {id:'reproducao', label:'Reprodução', icon:'<path d="M12 21s-7-4.35-9.5-8.8C.8 8.6 2.6 5 6 5c2 0 3.3 1.1 4 2.2C10.7 6.1 12 5 14 5c3.4 0 5.2 3.6 3.5 7.2C19 16.65 12 21 12 21z"/>'},
    {id:'saude', label:'Saúde', icon:'<path d="M12 4v16M4 12h16"/>'},
    {id:'calendario', label:'Calendário', icon:'<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M3 10h18M8 3v4M16 3v4"/>'},
  ];
  return `<div class="tabbar">${tabs.map(t=>`
    <button class="tab ${t.id===active?'active':''}" data-tab="${t.id}">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${t.icon}</svg>
      <span>${t.label}</span>
    </button>`).join('')}</div>`;
}

function headerHTML({eyebrow='HARAS MANP', title, subtitle, back=false, close=false}={}){
  return `
  <div class="header">
    <div>
      <div class="header-title-row">
        ${back ? `<button class="header-back" data-back="1">‹</button>` : ''}
        <div>
          ${eyebrow ? `<div class="eyebrow">${esc(eyebrow)}</div>` : ''}
          <h1 class="serif">${esc(title)}</h1>
          ${subtitle ? `<div class="subtitle">${esc(subtitle)}</div>` : ''}
        </div>
      </div>
    </div>
    ${close ? `<button class="header-close" data-back="1">×</button>` : `<img class="logo" src="assets/logo-haras.jpeg" alt="">`}
  </div>`;
}

// ---- Splash ----
function renderSplash(){
  return `
  <div class="splash" id="splash-tap">
    <img class="breed-mark" src="assets/logo-abccmm-black.png" alt="ABCCMM">
    <img class="logo" src="assets/logo-haras.jpeg" alt="Haras MANP">
    <div class="divider"></div>
    <div class="label serif">Gestão de Plantel</div>
    <div class="hint">Toque para entrar</div>
  </div>`;
}

// ---- Plantel ----
function renderPlantel(){
  return `
  ${headerHTML({title:'Plantel', subtitle:`${activeAnimais().length} animais no plantel`})}
  <div class="content">
    <div class="searchbar">
      <span>🔍</span>
      <input id="search-input" type="text" placeholder="Buscar animal ou registro" value="${esc(state.search)}">
    </div>
    <div class="chips" id="sex-chips">
      ${['todos','Éguas','Garanhões','Castrados'].map(f=>`
        <button class="chip ${state.sexFilter===f?'active':''}" data-filter="${f}">${f}</button>`).join('')}
    </div>
    <div id="plantel-list"></div>
  </div>
  <button class="fab" data-nav="novoAnimal">+</button>
  ${tabBarHTML('plantel')}
  `;
}
function filterAnimais(){
  const q = state.search.trim().toLowerCase();
  const sexMap = {'Éguas':'F','Garanhões':'M','Castrados':'C'};
  return activeAnimais().filter(a=>{
    if(state.sexFilter!=='todos' && a.sexo !== sexMap[state.sexFilter]) return false;
    if(q && !(a.nome.toLowerCase().includes(q) || (a.registro||'').toLowerCase().includes(q))) return false;
    return true;
  }).sort((a,b)=>a.nome.localeCompare(b.nome));
}
function updatePlantelList(){
  const list = document.getElementById('plantel-list');
  if(!list) return;
  const items = filterAnimais();
  if(items.length===0){
    list.innerHTML = `<div class="empty-state">Nenhum animal encontrado.</div>`;
    return;
  }
  list.innerHTML = items.map(a=>`
    <div class="card animal-card" data-open-animal="${a.id}">
      <div class="avatar" style="background:${AVATAR_COLOR[a.sexo]}">${initials(a.nome)}</div>
      <div class="info">
        <p class="name serif">${esc(a.nome)}</p>
        <p class="sub">${sexLabel(a.sexo)} · ${esc(a.pelagem)} · ${ageYears(a.nascimento)} anos</p>
      </div>
      <span class="chevron">›</span>
    </div>`).join('');
}

// ---- Ficha ----
function renderFicha(animalId){
  const a = animalById(animalId);
  if(!a) return renderPlantel();
  const cobs = state.cobricoes.filter(c => c.femeaId===a.id || c.reprodutorId===a.id)
    .sort((x,y)=> (parseBR(x.dataCobricao)||0) - (parseBR(y.dataCobricao)||0)).reverse();
  const saudeRecs = state.saude.filter(s=>s.animalId===a.id)
    .sort((x,y)=> (parseBR(x.proxima)||0) - (parseBR(y.proxima)||0));
  const isCastrado = a.sexo === 'C';
  const reproTitle = a.sexo === 'F' ? 'Reprodução' : 'Coberturas realizadas';

  return `
  ${headerHTML({title:a.nome, back:true})}
  <div class="content">
    <div class="identity-row">
      <div class="avatar lg" style="background:${AVATAR_COLOR[a.sexo]}">${initials(a.nome)}</div>
      <div class="meta">
        <div><b>Registro ${esc(a.registro)}</b></div>
        <div>${sexLabel(a.sexo)} · ${ageYears(a.nascimento)} anos</div>
      </div>
    </div>

    <div class="info-grid">
      <div class="info-cell"><div class="label">Nascimento</div><div class="value">${esc(a.nascimento)}</div></div>
      <div class="info-cell"><div class="label">Pelagem</div><div class="value">${esc(a.pelagem)}</div></div>
    </div>

    <div class="section-title serif">Genealogia</div>
    <div class="kv-row"><span class="k">Pai</span><span class="v">${esc(a.pai)||'—'}</span></div>
    <div class="kv-row"><span class="k">Mãe</span><span class="v">${esc(a.mae)||'—'}</span></div>

    ${isCastrado ? '' : `
    <div class="section-head">
      <div class="section-title serif">${reproTitle}</div>
      <button class="btn-pill-add" data-nav="novoCobricao" data-animal="${a.id}">+ registrar</button>
    </div>
    ${cobs.length===0 ? `<div class="empty-state">Nenhum registro ainda.</div>` : cobs.map(c=>{
      const partner = a.sexo==='F' ? c.reprodutorNome : c.femeaNome;
      const info = reproStatusInfo(c.status);
      return `<div class="record-card">
        <div class="top">
          <span class="partner">${esc(partner)}</span>
          <span class="pill ${info.key}">${info.label}</span>
        </div>
        <div class="sub">Cobrição ${esc(c.dataCobricao)}${c.previsaoParto ? ' · previsão '+esc(c.previsaoParto) : ''}</div>
      </div>`;
    }).join('')}
    `}

    <div class="section-head">
      <div class="section-title serif">Saúde</div>
      <button class="btn-pill-add" data-nav="novoSaude" data-animal="${a.id}">+ registrar</button>
    </div>
    ${saudeRecs.length===0 ? `<div class="empty-state">Nenhum registro ainda.</div>` : saudeRecs.map(s=>{
      const st = healthStatus(s.proxima);
      return `<div class="health-row">
        <span class="dot ${st.key}"></span>
        <div class="body">
          <div class="title">${esc(s.tipo)}</div>
          <div class="sub">${esc(s.descricao)} · próxima ${esc(s.proxima)}</div>
        </div>
        <span class="pill ${st.key}">${st.label}</span>
      </div>`;
    }).join('')}

    <button class="btn-danger-outline" id="btn-open-delete">Excluir animal (venda / morte)</button>
    <div id="delete-panel"></div>
  </div>
  `;
}

let deleteReason = null;
function renderDeletePanel(animalId){
  const a = animalById(animalId);
  return `
  <div class="confirm-panel">
    <div class="prompt">Remover <b>${esc(a.nome)}</b> do plantel</div>
    <div class="reason-row">
      ${['Venda','Morte','Outro'].map(r=>`<button class="reason-chip ${deleteReason===r?'active':''}" data-reason="${r}">${r}</button>`).join('')}
    </div>
    <div class="confirm-actions">
      <button class="btn-full outline" id="btn-cancel-delete">Cancelar</button>
      <button class="btn-full solid-danger" id="btn-confirm-delete">Confirmar remoção</button>
    </div>
  </div>`;
}

// ---- Novo Animal ----
let novoAnimalSexo = 'F';
function renderNovoAnimal(){
  novoAnimalSexo = 'F';
  return `
  ${headerHTML({title:'Novo Animal', close:true})}
  <div class="content no-tabbar">
    <div class="field">
      <span class="label">Sexo</span>
      <div class="segmented" id="seg-sexo">
        <button class="seg-opt active" data-val="F">Fêmea</button>
        <button class="seg-opt" data-val="M">Macho</button>
        <button class="seg-opt" data-val="C">Castrado</button>
      </div>
    </div>
    <div class="field">
      <span class="label">Nome do animal</span>
      <input id="f-nome" type="text" placeholder="Nome">
    </div>
    <div class="field-row">
      <div class="field"><span class="label">Nascimento</span><input id="f-nasc" type="text" placeholder="dd/mm/aaaa"></div>
      <div class="field"><span class="label">Registro</span><input id="f-reg" type="text" placeholder="Registro"></div>
    </div>
    <div class="field"><span class="label">Pelagem</span><input id="f-pelagem" type="text" placeholder="Pelagem"></div>
    <div class="field"><span class="label">Pai</span><input id="f-pai" type="text" placeholder="Nome do pai"></div>
    <div class="field"><span class="label">Mãe</span><input id="f-mae" type="text" placeholder="Nome da mãe"></div>
    <button class="btn-submit" id="btn-save-animal">Salvar animal</button>
  </div>`;
}

// ---- Novo registro de reprodução ----
let novoCobricaoStatus = 'aguardando';
function renderNovoCobricao(animalId){
  novoCobricaoStatus = 'aguardando';
  const a = animalById(animalId);
  const partnerLabel = a.sexo === 'F' ? 'Reprodutor' : 'Égua coberta';
  return `
  ${headerHTML({title:`Novo registro · ${a.nome}`, back:true})}
  <div class="content no-tabbar">
    <div class="field"><span class="label">${esc(partnerLabel)}</span><input id="f-partner" type="text" placeholder="Nome"></div>
    <div class="field-row">
      <div class="field"><span class="label">Data de cobrição</span><input id="f-data-cob" type="text" placeholder="dd/mm/aaaa"></div>
      <div class="field"><span class="label">Previsão de parto</span><input id="f-previsao" type="text" placeholder="dd/mm/aaaa"></div>
    </div>
    <div class="field">
      <span class="label">Status</span>
      <div class="segmented" id="seg-status-cob">
        <button class="seg-opt active" data-val="aguardando">Aguardando</button>
        <button class="seg-opt" data-val="confirmada">Confirmada</button>
        <button class="seg-opt" data-val="agendada">Agendada</button>
      </div>
    </div>
    <button class="btn-submit" id="btn-save-cobricao" data-animal="${a.id}">Salvar registro</button>
  </div>`;
}

// ---- Novo registro de saúde ----
let novoSaudeTipo = 'Vacina';
function renderNovoSaude(animalId){
  novoSaudeTipo = 'Vacina';
  const a = animalById(animalId);
  return `
  ${headerHTML({title:`Novo registro de saúde · ${a.nome}`, back:true})}
  <div class="content no-tabbar">
    <div class="field">
      <span class="label">Tipo</span>
      <div class="segmented" id="seg-tipo-saude">
        <button class="seg-opt active" data-val="Vacina">Vacina</button>
        <button class="seg-opt" data-val="Vermífugo">Vermífugo</button>
        <button class="seg-opt" data-val="Veterinário">Veterinário</button>
      </div>
    </div>
    <div class="field"><span class="label">Descrição</span><input id="f-descricao" type="text" placeholder="ex: Antitetânica"></div>
    <div class="field-row">
      <div class="field"><span class="label">Data de aplicação</span><input id="f-data-aplic" type="text" placeholder="dd/mm/aaaa"></div>
      <div class="field"><span class="label">Próxima aplicação</span><input id="f-proxima" type="text" placeholder="dd/mm/aaaa"></div>
    </div>
    <button class="btn-submit" id="btn-save-saude" data-animal="${a.id}">Salvar registro</button>
  </div>`;
}

// ---- Reprodução tab ----
function renderReproducao(){
  const rows = state.cobricoes
    .filter(c => activeAnimais().some(a=>a.id===c.femeaId))
    .sort((x,y)=> (parseBR(y.dataCobricao)||0) - (parseBR(x.dataCobricao)||0));
  return `
  ${headerHTML({title:'Reprodução', subtitle:'Cobrições e gestações do plantel'})}
  <div class="content">
    ${rows.length===0 ? `<div class="empty-state">Nenhum registro de reprodução ainda.</div>` : rows.map(c=>{
      const info = reproStatusInfo(c.status);
      return `<div class="mare-card">
        <div class="top">
          <span class="name serif">${esc(c.femeaNome)}</span>
          <span class="pill ${info.key}">${info.label}</span>
        </div>
        <div class="reprodutor">Reprodutor: ${esc(c.reprodutorNome)}</div>
        <div class="cols2">
          <div><div class="label">Cobrição</div><div class="val">${esc(c.dataCobricao)}</div></div>
          <div><div class="label">${c.previsaoParto?'Previsão parto':'Situação'}</div><div class="val">${c.previsaoParto?esc(c.previsaoParto):'A confirmar'}</div></div>
        </div>
      </div>`;
    }).join('')}
  </div>
  ${tabBarHTML('reproducao')}`;
}

// ---- Saúde tab ----
function renderSaude(){
  const rows = state.saude
    .filter(s => activeAnimais().some(a=>a.id===s.animalId))
    .map(s=>({...s, _days: daysUntil(s.proxima)}))
    .sort((x,y)=> (x._days??9e9) - (y._days??9e9));
  const hasOverdue = rows.some(r=> r._days!==null && r._days<0);
  return `
  ${headerHTML({title:'Saúde', subtitle:'Vacinas, vermífugos e check-ups do plantel'})}
  <div class="content">
    ${hasOverdue ? `<div class="alert-banner">Há registros de saúde atrasados no plantel — verifique a lista abaixo.</div>` : ''}
    ${rows.length===0 ? `<div class="empty-state">Nenhum registro de saúde ainda.</div>` : rows.map(s=>{
      const st = healthStatus(s.proxima);
      return `<div class="health-row">
        <span class="dot ${st.key}"></span>
        <div class="body">
          <div class="title">${esc(s.tipo)} · ${esc(s.animalNome)}</div>
          <div class="sub">${esc(s.descricao)} · próxima ${esc(s.proxima)}</div>
        </div>
        <span class="pill ${st.key}">${st.label}</span>
      </div>`;
    }).join('')}
  </div>
  ${tabBarHTML('saude')}`;
}

// ---- Calendário tab ----
function renderCalendario(){
  const events = [];
  for(const c of state.cobricoes){
    if(!activeAnimais().some(a=>a.id===c.femeaId)) continue;
    if(c.previsaoParto){
      events.push({date:parseBR(c.previsaoParto), title:'Parto previsto', sub:c.femeaNome, type:'parto'});
    }
    if(c.status==='agendada'){
      events.push({date:parseBR(c.dataCobricao), title:'Cobrição agendada', sub:`${c.femeaNome} × ${c.reprodutorNome}`, type:'cobricao'});
    }
  }
  for(const s of state.saude){
    if(!activeAnimais().some(a=>a.id===s.animalId)) continue;
    if(s.proxima){
      events.push({date:parseBR(s.proxima), title:`${s.tipo} · ${s.animalNome}`, sub:s.descricao, type:'saude'});
    }
  }
  const today = todayDate();
  const upcoming = events.filter(e=>e.date && e.date >= today).sort((a,b)=>a.date-b.date);

  return `
  ${headerHTML({title:'Calendário', subtitle:'Próximos eventos do plantel'})}
  <div class="content">
    ${upcoming.length===0 ? `<div class="empty-state">Nenhum evento futuro agendado.</div>` : upcoming.map(e=>`
      <div class="cal-row">
        <div class="cal-daybox">
          <div class="day serif">${e.date.getDate()}</div>
          <div class="month">${MONTHS_PT[e.date.getMonth()]}</div>
        </div>
        <div class="cal-divider"></div>
        <div class="body">
          <div class="title">${esc(e.title)}</div>
          <div class="sub">${esc(e.sub)}</div>
        </div>
        <span class="event-dot ${e.type}"></span>
      </div>`).join('')}
  </div>
  ${tabBarHTML('calendario')}`;
}

// ---------- events ----------
// Single delegated click handler on #app, bound once, survives all re-renders
// and dynamic list updates (e.g. updatePlantelList) without needing rebinding.
let _delegationBound = false;
function bindDelegatedEvents(){
  if(_delegationBound) return;
  _delegationBound = true;
  APP.addEventListener('click', (e)=>{
    const splashEl = e.target.closest('#splash-tap');
    if(splashEl){ switchTab('plantel'); return; }
    const tabBtn = e.target.closest('[data-tab]');
    if(tabBtn){ switchTab(tabBtn.dataset.tab); return; }
    const backBtn = e.target.closest('[data-back]');
    if(backBtn){ goBack(); return; }
    const navBtn = e.target.closest('[data-nav]');
    if(navBtn){ navigate(navBtn.dataset.nav, navBtn.dataset.animal ? {animalId:navBtn.dataset.animal} : {}); return; }
    const openAnimal = e.target.closest('[data-open-animal]');
    if(openAnimal){ navigate('ficha', {animalId: openAnimal.dataset.openAnimal}); return; }
  });
}

function attachGlobalEvents(){
  const view = cur();
  bindDelegatedEvents();

  if(view.screen==='plantel'){
    updatePlantelList();
    const searchInput = document.getElementById('search-input');
    searchInput.addEventListener('input', (e)=>{ state.search = e.target.value; updatePlantelList(); });
    APP.querySelectorAll('#sex-chips [data-filter]').forEach(chip=>{
      chip.addEventListener('click', ()=>{
        state.sexFilter = chip.dataset.filter;
        APP.querySelectorAll('#sex-chips [data-filter]').forEach(c=>c.classList.toggle('active', c===chip));
        updatePlantelList();
      });
    });
  }

  if(view.screen==='ficha'){
    const btnOpen = document.getElementById('btn-open-delete');
    if(btnOpen) btnOpen.addEventListener('click', ()=>{
      deleteReason = null;
      document.getElementById('delete-panel').innerHTML = renderDeletePanel(view.animalId);
      bindDeletePanel(view.animalId);
    });
  }

  if(view.screen==='novoAnimal'){
    APP.querySelectorAll('#seg-sexo .seg-opt').forEach(opt=>{
      opt.addEventListener('click', ()=>{
        novoAnimalSexo = opt.dataset.val;
        APP.querySelectorAll('#seg-sexo .seg-opt').forEach(o=>o.classList.toggle('active', o===opt));
      });
    });
    document.getElementById('btn-save-animal').addEventListener('click', async ()=>{
      const nome = document.getElementById('f-nome').value.trim();
      if(!nome){ goBack(); return; }
      await addAnimal({
        nome, sexo:novoAnimalSexo,
        nascimento: document.getElementById('f-nasc').value.trim(),
        registro: document.getElementById('f-reg').value.trim(),
        pelagem: document.getElementById('f-pelagem').value.trim(),
        pai: document.getElementById('f-pai').value.trim(),
        mae: document.getElementById('f-mae').value.trim(),
      });
      toast('Animal salvo');
      goBack();
    });
  }

  if(view.screen==='novoCobricao'){
    APP.querySelectorAll('#seg-status-cob .seg-opt').forEach(opt=>{
      opt.addEventListener('click', ()=>{
        novoCobricaoStatus = opt.dataset.val;
        APP.querySelectorAll('#seg-status-cob .seg-opt').forEach(o=>o.classList.toggle('active', o===opt));
      });
    });
    document.getElementById('btn-save-cobricao').addEventListener('click', async ()=>{
      const a = animalById(view.animalId);
      const partner = document.getElementById('f-partner').value.trim();
      if(!partner){ goBack(); return; }
      const data = {
        dataCobricao: document.getElementById('f-data-cob').value.trim(),
        previsaoParto: document.getElementById('f-previsao').value.trim(),
        status: novoCobricaoStatus,
      };
      if(a.sexo === 'F'){ data.femeaId = a.id; data.femeaNome = a.nome; data.reprodutorNome = partner; }
      else { data.reprodutorId = a.id; data.femeaNome = partner; data.reprodutorNome = a.nome; }
      await addCobricao(data);
      toast('Registro salvo');
      goBack();
    });
  }

  if(view.screen==='novoSaude'){
    APP.querySelectorAll('#seg-tipo-saude .seg-opt').forEach(opt=>{
      opt.addEventListener('click', ()=>{
        novoSaudeTipo = opt.dataset.val;
        APP.querySelectorAll('#seg-tipo-saude .seg-opt').forEach(o=>o.classList.toggle('active', o===opt));
      });
    });
    document.getElementById('btn-save-saude').addEventListener('click', async ()=>{
      const a = animalById(view.animalId);
      const descricao = document.getElementById('f-descricao').value.trim();
      await addSaude({
        animalId:a.id, animalNome:a.nome, tipo:novoSaudeTipo,
        descricao,
        data: document.getElementById('f-data-aplic').value.trim(),
        proxima: document.getElementById('f-proxima').value.trim(),
      });
      toast('Registro salvo');
      goBack();
    });
  }
}

function bindDeletePanel(animalId){
  const panel = document.getElementById('delete-panel');
  panel.querySelectorAll('[data-reason]').forEach(chip=>{
    chip.addEventListener('click', ()=>{
      deleteReason = chip.dataset.reason;
      panel.querySelectorAll('[data-reason]').forEach(c=>c.classList.toggle('active', c===chip));
    });
  });
  document.getElementById('btn-cancel-delete').addEventListener('click', ()=>{
    panel.innerHTML = '';
  });
  document.getElementById('btn-confirm-delete').addEventListener('click', async ()=>{
    await removeAnimal(animalId, deleteReason || 'Outro');
    toast('Animal removido do plantel');
    state.stack = [{screen:'plantel'}];
    render();
  });
}

// ---------- boot ----------
(async function init(){
  await openDB();
  await seedIfEmpty();
  await loadAll();
  render();
  if('serviceWorker' in navigator){
    navigator.serviceWorker.register('sw.js').catch(()=>{});
  }
})();
