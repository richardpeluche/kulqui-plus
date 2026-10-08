'use strict';
/* ===== Almacenamiento: copia local + sincronización con Supabase ===== */
let KEY = 'cajas_v1'; const DIRTY = 'cajas_v1_dirty';
const SB = 'https://shcbozuzwzkzphkmjfwo.supabase.co/rest/v1/';
const SBK = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InNoY2JvenV6d3prenBoa21qZndvIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTE0Nzc4ODQsImV4cCI6MjEwNzA1Mzg4NH0.AyQ4J-EBDohVaF1NzOb90K0okk-zhiMUOsosxInotQc';
const TBL = ['cajas', 'socios', 'prestamos', 'reuniones', 'ingresos'];
const TB = {
  cajas: { to: c => ({ id: c.id, nombre: c.nombre, tasa: c.tasa, mora: c.mora, aporte: c.aporte }), from: r => ({ id: r.id, nombre: r.nombre, tasa: +r.tasa, mora: +r.mora, aporte: +r.aporte }) },
  socios: { to: s => ({ id: s.id, caja_id: s.cajaId, nombre: s.nombre, cedula: s.cedula || '', telefono: s.telefono || '', rol: s.rol || 'Socio' }), from: r => ({ id: r.id, cajaId: r.caja_id, nombre: r.nombre, cedula: r.cedula, telefono: r.telefono, rol: r.rol }) },
  prestamos: { to: p => ({ id: p.id, caja_id: p.cajaId, socio_id: p.socioId, monto: p.monto, plazo: p.plazo, tasa: p.tasa, mora: p.mora, metodo: p.metodo, gracia: p.gracia || 0, fecha: p.fecha, pagos: p.pagos }), from: r => ({ id: r.id, cajaId: r.caja_id, socioId: r.socio_id, monto: +r.monto, plazo: r.plazo, tasa: +r.tasa, mora: +r.mora, metodo: r.metodo, gracia: r.gracia, fecha: r.fecha, pagos: r.pagos || [] }) },
  reuniones: { to: r => ({ id: r.id, caja_id: r.cajaId, fecha: r.fecha, lugar: r.lugar || '', asistentes: r.asistentes, aportes: r.aportes, acta: r.acta || '' }), from: r => ({ id: r.id, cajaId: r.caja_id, fecha: r.fecha, lugar: r.lugar, asistentes: r.asistentes || [], aportes: r.aportes || {}, acta: r.acta }) },
  ingresos: { to: i => ({ id: i.id, caja_id: i.cajaId, fecha: i.fecha, monto: i.monto, concepto: i.concepto || '' }), from: r => ({ id: r.id, cajaId: r.caja_id, fecha: r.fecha, monto: +r.monto, concepto: r.concepto }) }
};
const seed = () => ({ cajas: [], socios: [], prestamos: [], reuniones: [], ingresos: [], cajaActiva: null });
let db = seed(), modo = null, LIC = null;
function cargarDB(k) {
  KEY = k;
  try { db = JSON.parse(localStorage.getItem(k)) || seed(); } catch (e) { db = seed(); }
  db.ingresos = db.ingresos || [];
}
let PW = '', locked = true, idle, fallos = 0;
const enc = s => btoa(String.fromCharCode(...new TextEncoder().encode(s)));
const setSync = t => { const e = document.querySelector('#sync'); if (e) e.textContent = t; };
async function sb(path, opt = {}) {
  const r = await fetch(SB + path, { ...opt, headers: { apikey: SBK, Authorization: 'Bearer ' + SBK, 'Content-Type': 'application/json', 'x-kulqui-key': enc(PW), ...(opt.headers || {}) } });
  if (!r.ok) throw new Error(await r.text());
  return r.json().catch(() => null);
}
let pushing = false, again = false, timer;
async function push() {
  if (pushing) { again = true; return; }
  pushing = true; setSync('Guardando…');
  try {
    if (!(await claveOk())) { pushing = false; return lock('La contraseña cambió. Ingresa de nuevo.'); }
    for (const t of TBL) {
      const rows = db[t].map(TB[t].to), keep = new Set(rows.map(r => r.id));
      if (rows.length) await sb(t + '?on_conflict=id', { method: 'POST', headers: { Prefer: 'resolution=merge-duplicates,return=minimal' }, body: JSON.stringify(rows) });
      const remote = await sb(t + '?select=id'), del = remote.filter(r => !keep.has(r.id)).map(r => encodeURIComponent(r.id));
      if (del.length) await sb(`${t}?id=in.(${del.join(',')})`, { method: 'DELETE', headers: { Prefer: 'return=minimal' } });
    }
    if (!again) localStorage.removeItem(DIRTY);
    setSync('Sincronizado');
  } catch (e) { setSync('Sin conexión (guardado en el dispositivo)'); }
  pushing = false;
  if (again) { again = false; push(); }
}
function save() {
  localStorage.setItem(KEY, JSON.stringify(db));
  if (modo !== 'nube') return;
  localStorage.setItem(DIRTY, '1'); clearTimeout(timer); timer = setTimeout(push, 600);
}
async function pull() {
  if (localStorage.getItem(DIRTY)) return push();
  try {
    setSync('Sincronizando…');
    if (!(await claveOk())) return lock('La contraseña cambió. Ingresa de nuevo.');
    const d = {};
    for (const t of TBL) d[t] = (await sb(t + '?select=*')).map(TB[t].from);
    const remoteHas = TBL.some(t => d[t].length);
    if (!remoteHas && db.cajas.length) return push();
    if (remoteHas) { db = { ...d, cajaActiva: db.cajaActiva }; localStorage.setItem(KEY, JSON.stringify(db)); render(); }
    setSync('Sincronizado');
  } catch (e) { setSync('Sin conexión'); }
}
window.addEventListener('online', () => { if (!locked && modo === 'nube' && localStorage.getItem(DIRTY)) push(); });

/* ===== Contraseña (verificada por la base de datos) ===== */
const rpc = (fn, args) => sb('rpc/' + fn, { method: 'POST', body: JSON.stringify(args || {}) });
const claveOk = () => rpc('acceso_ok');
const b64 = u8 => btoa(String.fromCharCode(...u8));
async function derive(pw, salt) {
  const k = await crypto.subtle.importKey('raw', new TextEncoder().encode(pw), 'PBKDF2', false, ['deriveBits']);
  return b64(new Uint8Array(await crypto.subtle.deriveBits({ name: 'PBKDF2', salt, iterations: 150000, hash: 'SHA-256' }, k, 256)));
}
async function guardarVerif(pw, k = 'kq_v') {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  localStorage.setItem(k, JSON.stringify({ s: b64(salt), h: await derive(pw, salt) }));
}
async function verifLocal(pw, k = 'kq_v') {
  try {
    const v = JSON.parse(localStorage.getItem(k)); if (!v) return null;
    return (await derive(pw, Uint8Array.from(atob(v.s), c => c.charCodeAt(0)))) === v.h;
  } catch (e) { return null; }
}
const msgErr = x => { try { return JSON.parse(x.message).message || x.message; } catch (e) { return /fetch|network/i.test(x.message) ? 'Sin conexión con el servidor.' : x.message; } };
function resetIdle() { clearTimeout(idle); if (!locked && modo) idle = setTimeout(() => lock('Sesión bloqueada por inactividad.'), 10 * 60 * 1000); }
['pointerdown', 'keydown', 'touchstart'].forEach(ev => window.addEventListener(ev, resetIdle, { passive: true }));
function lock(msg) {
  locked = true; PW = ''; modo = null; LIC = null; db = seed(); sessionStorage.removeItem('kq_pw'); clearTimeout(idle);
  closeModal(); document.body.classList.add('locked'); $('#app').innerHTML = ''; setSync(''); pintarLic();
  entrada(typeof msg === 'string' ? msg : '');
}
function unlock() {
  locked = false; modo = 'nube'; LIC = null; localStorage.setItem('kq_owner', '1'); cargarDB('cajas_v1');
  sessionStorage.setItem('kq_pw', PW);
  document.body.classList.remove('locked'); $('#lock').hidden = true; $('#lock').innerHTML = '';
  $('#bloq').hidden = false; pintarLic(); resetIdle(); render(); pull();
}
async function showLock(msg) {
  const el = $('#lock'); el.hidden = false; el.innerHTML = '<div class="lockbox"><h1>Kulqui+</h1><p class="m">Cargando…</p></div>';
  let modo = 'entrar', offline = false;
  try { modo = (await rpc('hay_acceso')) ? 'entrar' : 'crear'; }
  catch (e) {
    offline = true;
    if (!localStorage.getItem('kq_v')) { el.innerHTML = '<div class="lockbox"><h1>Kulqui+</h1><p class="m">Necesitas conexión a internet para entrar por primera vez en este dispositivo.</p><button onclick="lock()">Reintentar</button></div>'; return; }
  }
  const crear = modo === 'crear';
  el.innerHTML = `<form class="lockbox" onsubmit="enviarClave(event,'${modo}',${offline})">
    <h1>Kulqui+</h1>
    <p class="m">${crear ? 'Crea una contraseña para proteger tus datos (mínimo 8 caracteres, mejor 12 o más). Si la pierdes no se puede recuperar.' : offline ? 'Sin conexión: se verificará en este dispositivo.' : 'Ingresa tu contraseña'}</p>
    <input type="password" name="pw" autocomplete="${crear ? 'new-password' : 'current-password'}" required placeholder="Contraseña" autofocus>
    ${crear ? '<input type="password" name="pw2" autocomplete="new-password" required placeholder="Repite la contraseña">' : ''}
    <div class="err" id="lockErr">${esc(msg || '')}</div>
    <button>${crear ? 'Crear y entrar' : 'Entrar'}</button>
    <a class="lnk" onclick="showLicencia()">Tengo una clave de licencia</a></form>`;
}
async function enviarClave(e, modo, offline) {
  e.preventDefault(); const f = e.target, pw = fv(f, 'pw'), err = $('#lockErr'), btn = f.querySelector('button');
  btn.disabled = true; err.textContent = '';
  try {
    if (modo === 'crear') {
      if (pw.length < 8) throw new Error('Mínimo 8 caracteres.');
      if (pw !== fv(f, 'pw2')) throw new Error('Las contraseñas no coinciden.');
      await rpc('crear_acceso', { p: pw }); PW = pw; await guardarVerif(pw);
    } else if (offline) {
      if ((await verifLocal(pw)) !== true) { PW = ''; throw new Error('Contraseña incorrecta.'); }
      PW = pw;
    } else {
      PW = pw;
      if (!(await claveOk())) { PW = ''; throw new Error('Contraseña incorrecta.'); }
      await guardarVerif(pw);
    }
    fallos = 0; unlock();
  } catch (x) {
    PW = ''; err.textContent = msgErr(x); btn.disabled = false;
    if (err.textContent === 'Contraseña incorrecta.' && ++fallos >= 5) {
      err.textContent = 'Demasiados intentos. Espera 30 segundos.'; btn.disabled = true; fallos = 0; setTimeout(() => { btn.disabled = false; err.textContent = ''; }, 30000);
    }
  }
}
async function boot() {
  const p = sessionStorage.getItem('kq_pw');
  if (p) {
    PW = p;
    try { if (await claveOk()) return unlock(); } catch (e) { if ((await verifLocal(p)) === true) return unlock(); }
    PW = '';
  }
  entrada();
}

/* ===== Licencias (clave free de 5 días / premium anual) ===== */
const WA = '593988928651', SITIO = 'https://richardpeluche.github.io/kulqui-plus/';
const waVenta = txt => `https://wa.me/${WA}?text=${encodeURIComponent(txt)}`;
const PREMIUM_MSG = 'Hola, quiero adquirir Kulqui+ premium (licencia anual).';
const devId = () => { let d = localStorage.getItem('kq_dev'); if (!d) { d = crypto.randomUUID ? crypto.randomUUID() : uid() + uid(); localStorage.setItem('kq_dev', d); } return d; };
const diasRest = v => Math.max(0, Math.ceil((Date.parse(v) - Date.now()) / 864e5));
const tmax = () => +localStorage.getItem('kq_t') || 0;
const marcaTiempo = (t = Date.now()) => localStorage.setItem('kq_t', String(Math.max(tmax(), t)));
function guardarLic(est) {
  LIC = est; localStorage.setItem('kq_lic', JSON.stringify({ codigo: est.codigo, tipo: est.tipo, vence: est.vence }));
  if (est.ahora) marcaTiempo(Date.parse(est.ahora));
}
async function entrada(msg) {
  closeModal();
  if (localStorage.getItem('kq_owner')) return showLock(msg);
  let lic = null; try { lic = JSON.parse(localStorage.getItem('kq_lic')); } catch (e) { }
  if (!lic) return showLicencia(msg);
  let est;
  try {
    est = await rpc('estado_licencia', { p_codigo: lic.codigo, p_dispositivo: devId(), p_activar: false });
    guardarLic(est);
  } catch (e) {
    if (e instanceof TypeError) {
      if (Date.now() < tmax() - 5 * 6e4) return showLicencia('Revisa la fecha y hora de tu dispositivo.');
      est = { ...lic, vigente: Date.now() < Date.parse(lic.vence) };
    } else { localStorage.removeItem('kq_lic'); return showLicencia(msgErr(e)); }
  }
  est.vigente ? puerta(est) : pantallaVencida(est);
}
function showLicencia(msg) {
  const el = $('#lock'); el.hidden = false;
  el.innerHTML = `<form class="lockbox" onsubmit="enviarLicencia(event)">
    <h1>Kulqui+</h1>
    <p class="m">Ingresa tu clave de licencia para usar la app.</p>
    <input name="clave" required placeholder="KQ-XXXX-XXXX-XXXX" autocomplete="off" autocapitalize="characters" autofocus>
    <div class="err" id="lockErr">${esc(msg || '')}</div>
    <button>Activar</button>
    <a class="lnk" href="${waVenta('Hola, quiero una clave para usar Kulqui+.')}" target="_blank" rel="noopener">Solicitar clave por WhatsApp</a>
    <a class="lnk" onclick="showLock()">Acceso propietario</a></form>`;
}
async function enviarLicencia(e) {
  e.preventDefault(); const f = e.target, err = $('#lockErr'), btn = f.querySelector('button');
  btn.disabled = true; err.textContent = '';
  try {
    const est = await rpc('estado_licencia', { p_codigo: fv(f, 'clave'), p_dispositivo: devId(), p_activar: true });
    guardarLic(est); est.vigente ? puerta(est) : pantallaVencida(est);
  } catch (x) { err.textContent = msgErr(x); btn.disabled = false; }
}
function pantallaVencida(est) {
  const el = $('#lock'); el.hidden = false;
  el.innerHTML = `<form class="lockbox" onsubmit="enviarLicencia(event)">
    <h1>Kulqui+</h1>
    <p><b>${est.tipo === 'free' ? 'Tu prueba gratuita de 5 días terminó.' : 'Tu licencia premium venció.'}</b></p>
    <p class="m">Adquiere premium para seguir usando Kulqui+. Tus datos siguen guardados en este dispositivo y volverán a estar disponibles al activar.</p>
    <a class="btn" href="${waVenta(PREMIUM_MSG)}" target="_blank" rel="noopener">Adquirir premium por WhatsApp</a>
    <p class="m">¿Ya tienes tu clave premium?</p>
    <input name="clave" required placeholder="KQ-XXXX-XXXX-XXXX" autocomplete="off" autocapitalize="characters">
    <div class="err" id="lockErr"></div><button>Activar</button></form>`;
}
/* Contraseña personal de cada usuario con licencia (se guarda solo en su dispositivo) */
function puerta(est, msg) {
  const el = $('#lock'); el.hidden = false; LIC = est;
  const crear = !localStorage.getItem('kq_uv');
  el.innerHTML = `<form class="lockbox" onsubmit="enviarClaveUsuario(event,${crear})">
    <h1>Kulqui+</h1>
    <p class="m">${crear ? 'Crea tu contraseña personal para proteger tus datos (mínimo 8 caracteres). Se guarda solo en este dispositivo y si la pierdes no se puede recuperar.' : 'Ingresa tu contraseña'}</p>
    <input type="password" name="pw" autocomplete="${crear ? 'new-password' : 'current-password'}" required placeholder="Contraseña" autofocus>
    ${crear ? '<input type="password" name="pw2" autocomplete="new-password" required placeholder="Repite la contraseña">' : ''}
    <div class="err" id="lockErr">${esc(msg || '')}</div>
    <button>${crear ? 'Crear y entrar' : 'Entrar'}</button>
    ${crear ? '' : '<a class="lnk" onclick="olvideClave()">Olvidé mi contraseña</a>'}</form>`;
}
async function enviarClaveUsuario(e, crear) {
  e.preventDefault(); const f = e.target, pw = fv(f, 'pw'), err = $('#lockErr'), btn = f.querySelector('button');
  btn.disabled = true; err.textContent = '';
  try {
    if (crear) {
      if (pw.length < 8) throw new Error('Mínimo 8 caracteres.');
      if (pw !== fv(f, 'pw2')) throw new Error('Las contraseñas no coinciden.');
      await guardarVerif(pw, 'kq_uv');
    } else if ((await verifLocal(pw, 'kq_uv')) !== true) throw new Error('Contraseña incorrecta.');
    fallos = 0; entrarLocal(LIC);
  } catch (x) {
    err.textContent = x.message; btn.disabled = false;
    if (x.message === 'Contraseña incorrecta.' && ++fallos >= 5) {
      err.textContent = 'Demasiados intentos. Espera 30 segundos.'; btn.disabled = true; fallos = 0; setTimeout(() => { btn.disabled = false; err.textContent = ''; }, 30000);
    }
  }
}
function olvideClave() {
  if (!confirm('Para crear una contraseña nueva se borrarán los datos guardados en este dispositivo (puedes restaurarlos después con una copia JSON de Reportes). ¿Continuar?')) return;
  localStorage.removeItem('kq_uv'); localStorage.removeItem('kq_local_v1'); puerta(LIC);
}
function entrarLocal(est) {
  modo = 'local'; LIC = est; locked = false; cargarDB('kq_local_v1'); marcaTiempo();
  document.body.classList.remove('locked'); $('#lock').hidden = true; $('#lock').innerHTML = '';
  $('#bloq').hidden = false; setSync('Datos solo en este dispositivo'); pintarLic(); resetIdle(); render();
}
function pintarLic() {
  const a = $('#lic'); if (!a) return;
  if (modo !== 'local' || !LIC) { a.hidden = true; return; }
  const d = diasRest(LIC.vence), s = d === 1 ? '' : 's';
  if (LIC.tipo === 'free') { a.textContent = `Prueba: ${d} día${s}`; a.href = waVenta(PREMIUM_MSG); a.hidden = false; }
  else if (d <= 30) { a.textContent = `Premium vence en ${d} día${s}`; a.href = waVenta('Hola, quiero renovar mi licencia de Kulqui+.'); a.hidden = false; }
  else a.hidden = true;
}
function licCard() {
  if (modo !== 'local' || !LIC || LIC.tipo !== 'free') return '';
  const d = diasRest(LIC.vence);
  return `<div class="card aviso"><b>Prueba gratuita: ${d === 0 ? 'último día' : `quedan ${d} día${d === 1 ? '' : 's'}`}.</b>
    <div class="m">Adquiere premium para seguir usando Kulqui+ sin interrupciones. Tus datos no se pierden.</div>
    <div class="bar"><a class="btn sm" href="${waVenta(PREMIUM_MSG)}" target="_blank" rel="noopener">Adquirir premium</a></div></div>`;
}
setInterval(() => {
  if (locked) return;
  marcaTiempo(); pintarLic();
  if (modo === 'local' && LIC && Date.now() >= Date.parse(LIC.vence)) lock();
}, 60000);

/* ===== Panel de licencias (solo propietario) ===== */
const msgClave = (c, tipo) => `Tu clave de Kulqui+ (${tipo === 'free' ? 'prueba de 5 días' : 'premium anual'}): ${c}\n\n1. Abre ${SITIO}\n2. Escribe la clave y toca Activar.`;
async function abrirLicencias() {
  openModal('<h2>Licencias</h2><p class="m">Cargando…</p>');
  try {
    const l = await rpc('listar_licencias');
    openModal(`<h2>Licencias</h2>
    <form onsubmit="nuevaLicencia(event)"><div class="two">
      <div><label>Tipo</label><select name="tipo"><option value="premium">Premium (365 días, 1 dispositivo)</option><option value="free">Free (5 días, varios dispositivos)</option></select></div>
      <div><label>Nota</label><input name="nota" placeholder="Nombre del cliente"></div></div>
      <div class="bar"><button>Generar clave</button><button type="button" class="sec" onclick="closeModal()">Cerrar</button></div></form>
    ${l.map(x => `<div class="row"><div><b>${esc(x.codigo)}</b> <span class="badge ${x.tipo === 'premium' ? 'ok' : ''}">${x.tipo}</span>${x.activa ? '' : ' <span class="badge bad">desactivada</span>'}
      <div class="m">${esc(x.nota)} · ${x.dispositivos} dispositivo(s)${x.primera ? ' · desde ' + fdate(String(x.primera).slice(0, 10)) : ''}</div></div>
      <div class="bar"><button class="sec sm" onclick="copiarClave('${x.codigo}','${x.tipo}')">Copiar</button>${x.tipo === 'premium' ? `<button class="sec sm" onclick="licAccion('liberar_licencia','${x.codigo}')">Liberar</button>` : ''}<button class="sec sm" onclick="licAccion('cambiar_estado_licencia','${x.codigo}',${!x.activa})">${x.activa ? 'Desactivar' : 'Activar'}</button></div></div>`).join('')}`);
  } catch (x) { openModal(`<h2>Licencias</h2><p class="err">${esc(msgErr(x))}</p><button onclick="closeModal()">Cerrar</button>`); }
}
async function copiarClave(c, tipo) {
  try { await navigator.clipboard.writeText(msgClave(c, tipo)); alert('Mensaje copiado. Pégalo en WhatsApp.'); }
  catch (e) { prompt('Copia este mensaje:', msgClave(c, tipo)); }
}
async function nuevaLicencia(e) {
  e.preventDefault(); const f = e.target, tipo = fv(f, 'tipo');
  try {
    const c = await rpc('crear_licencia', { p_tipo: tipo, p_nota: fv(f, 'nota').trim() });
    await abrirLicencias(); await copiarClave(c, tipo);
  } catch (x) { alert(msgErr(x)); }
}
async function licAccion(fn, codigo, activa) {
  if (fn === 'liberar_licencia' && !confirm('Se libera el dispositivo actual para que la clave se use en otro equipo. ¿Continuar?')) return;
  try { await rpc(fn, fn === 'cambiar_estado_licencia' ? { p_codigo: codigo, p_activa: activa } : { p_codigo: codigo }); abrirLicencias(); }
  catch (x) { alert(msgErr(x)); }
}
const formClave = () => `<h2>Cambiar contraseña</h2><form onsubmit="cambiarClave(event)">
  <label>Nueva contraseña (mínimo 8 caracteres)</label><input type="password" name="n1" required minlength="8" autocomplete="new-password">
  <label>Repite la nueva contraseña</label><input type="password" name="n2" required autocomplete="new-password">
  <div class="bar"><button>Cambiar</button><button type="button" class="sec" onclick="closeModal()">Cancelar</button></div></form>`;
async function cambiarClave(e) {
  e.preventDefault(); const f = e.target, n = fv(f, 'n1');
  if (n !== fv(f, 'n2')) return alert('Las contraseñas no coinciden.');
  try {
    await rpc('cambiar_acceso', { nueva: n }); PW = n; sessionStorage.setItem('kq_pw', n); await guardarVerif(n);
    closeModal(); alert('Contraseña cambiada. En tus otros dispositivos tendrás que ingresar la nueva.');
  } catch (x) { alert(msgErr(x)); }
}

/* ===== Utilidades ===== */
const $ = s => document.querySelector(s);
const uid = () => Math.random().toString(36).slice(2, 9) + Date.now().toString(36).slice(-4);
const money = n => new Intl.NumberFormat('es-EC', { style: 'currency', currency: 'USD' }).format(n || 0);
const r2 = n => Math.round((n + Number.EPSILON) * 100) / 100;
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const today = () => { const d = new Date(); return new Date(d - d.getTimezoneOffset() * 6e4).toISOString().slice(0, 10); };
const fdate = d => d ? new Date(d + 'T00:00:00').toLocaleDateString('es-EC', { day: '2-digit', month: 'short', year: 'numeric' }) : '';
const num = v => parseFloat(String(v).replace(',', '.')) || 0;
function addMonths(ds, n) {
  const [y, m, d] = ds.split('-').map(Number);
  const x = new Date(y, m - 1 + n, d);
  if (x.getDate() !== d) x.setDate(0);
  return new Date(x - x.getTimezoneOffset() * 6e4).toISOString().slice(0, 10);
}
const daysBetween = (a, b) => Math.round((new Date(b + 'T00:00:00') - new Date(a + 'T00:00:00')) / 864e5);

/* ===== Cálculos ===== */
function schedule(p) {
  const n = p.plazo, i = p.tasa / 100, P = p.monto, rows = [];
  let saldo = P;
  const pmt = i === 0 ? P / n : P * i / (1 - Math.pow(1 + i, -n));
  for (let k = 1; k <= n; k++) {
    let interes, capital;
    if (p.metodo === 'fijo') { interes = r2(P * i); capital = r2(P / n); }
    else { interes = r2(saldo * i); capital = r2(pmt - interes); }
    if (k === n) capital = r2(saldo);
    saldo = r2(saldo - capital);
    rows.push({ n: k, fecha: addMonths(p.fecha, k), capital, interes, total: r2(capital + interes) });
  }
  return rows;
}
function info(p) {
  const sch = schedule(p), t = today();
  let rest = r2(p.pagos.reduce((s, x) => s + x.monto, 0)), mora = 0, capPag = 0, intPag = 0, proxima = null;
  sch.forEach(c => {
    c.pagado = r2(Math.min(c.total, rest)); rest = r2(rest - c.pagado);
    c.pend = r2(c.total - c.pagado);
    const f = c.total ? c.pagado / c.total : 0;
    capPag += c.capital * f; intPag += c.interes * f;
    c.dias = c.pend > 0 ? Math.max(0, daysBetween(c.fecha, t) - (p.gracia || 0)) : 0;
    c.mora = c.pend > 0 && c.dias > 0 ? r2(c.pend * (p.mora / 100) * c.dias / 30) : 0;
    c.estado = c.pend <= 0 ? 'Pagada' : c.fecha < t ? 'Vencida' : c.pagado > 0 ? 'Parcial' : 'Pendiente';
    mora += c.mora;
    if (!proxima && c.pend > 0) proxima = c;
  });
  const moraCobrada = r2(p.pagos.reduce((s, x) => s + (x.mora || 0), 0));
  const moraDebe = Math.max(0, r2(mora - moraCobrada));
  const saldoCap = r2(p.monto - capPag), saldoTot = r2(sch.reduce((s, c) => s + c.pend, 0));
  const vencida = sch.some(c => c.estado === 'Vencida');
  const estado = saldoTot <= 0 ? 'Cancelado' : vencida ? 'En mora' : 'Al día';
  return { sch, moraDebe, moraCobrada, saldoCap, saldoTot, intPag: r2(intPag), capPag: r2(capPag), proxima, estado };
}
function stats(cajaId) {
  const aportes = db.reuniones.filter(r => r.cajaId === cajaId).reduce((s, r) => s + Object.values(r.aportes).reduce((a, b) => a + b, 0), 0);
  let desembolsado = 0, cobrado = 0, interes = 0, mora = 0, saldoCap = 0;
  db.prestamos.filter(p => p.cajaId === cajaId).forEach(p => {
    const i = info(p);
    desembolsado += p.monto; cobrado += p.pagos.reduce((s, x) => s + x.monto, 0);
    interes += i.intPag; mora += i.moraCobrada; saldoCap += i.saldoCap;
  });
  const ingresos = db.ingresos.filter(i => i.cajaId === cajaId).reduce((s, i) => s + i.monto, 0);
  const utilidad = r2(interes + mora);
  const efectivo = r2(aportes + ingresos - desembolsado + cobrado + mora);
  return { aportes: r2(aportes), ingresos: r2(ingresos), desembolsado, utilidad, efectivo, prestado: r2(saldoCap), fondo: r2(efectivo + saldoCap), interes: r2(interes), mora: r2(mora) };
}
const aporteSocio = (cajaId, sid) => db.reuniones.filter(r => r.cajaId === cajaId).reduce((s, r) => s + (r.aportes[sid] || 0), 0);
const cajaActual = () => db.cajas.find(c => c.id === db.cajaActiva) || db.cajas[0];
const socioNombre = id => (db.socios.find(s => s.id === id) || { nombre: '(eliminado)' }).nombre;
const badge = e => `<span class="badge ${{ 'Al día': 'ok', 'Cancelado': '', 'En mora': 'bad', Pagada: 'ok', Vencida: 'bad', Parcial: 'warn', Pendiente: '' }[e] ?? ''}">${e}</span>`;

/* ===== Modal ===== */
const openModal = h => { const m = $('#modal'); m.innerHTML = `<div class="sheet">${h}</div>`; m.hidden = false; };
const closeModal = () => { $('#modal').hidden = true; $('#modal').innerHTML = ''; };
$('#modal').addEventListener('click', e => { if (e.target.id === 'modal') closeModal(); });
const fv = (f, n) => f.elements[n].value;

/* ===== Cajas ===== */
function formCaja(c) {
  c = c || { nombre: '', tasa: 2, mora: 5, aporte: 5 };
  return `<h2>${c.id ? 'Editar caja' : 'Nueva caja comunal'}</h2>
  <form onsubmit="guardarCaja(event,'${c.id || ''}')">
    <label>Nombre de la caja</label><input name="nombre" required value="${esc(c.nombre)}">
    <div class="two"><div><label>Interés mensual por defecto (%)</label><input name="tasa" inputmode="decimal" value="${c.tasa}"></div>
    <div><label>Mora mensual por defecto (%)</label><input name="mora" inputmode="decimal" value="${c.mora}"></div></div>
    <label>Aporte sugerido por reunión ($)</label><input name="aporte" inputmode="decimal" value="${c.aporte}">
    <div class="bar"><button>Guardar</button><button type="button" class="sec" onclick="closeModal()">Cancelar</button></div>
  </form>` + (c.id ? formIngresos(c.id) : '');
}
function formIngresos(cid) {
  const l = db.ingresos.filter(i => i.cajaId === cid).sort((a, b) => b.fecha.localeCompare(a.fecha));
  return `<h2>Ingresos al fondo</h2><p class="m">Dinero que entró a la caja (donaciones, rifas, multas, etc.). Se suma al efectivo y al fondo total. Total: <b>${money(stats(cid).ingresos)}</b></p>
  <form onsubmit="agregarIngreso(event,'${cid}')">
    <div class="two"><div><label>Monto ($)</label><input name="monto" inputmode="decimal" required></div>
    <div><label>Fecha</label><input type="date" name="fecha" value="${today()}" required></div></div>
    <label>Concepto</label><input name="concepto" placeholder="Ej: rifa, donación, multa">
    <div class="bar"><button>Agregar al fondo</button></div>
  </form>
  ${l.map(i => `<div class="row"><div>${fdate(i.fecha)}<div class="m">${esc(i.concepto)}</div></div><b>${money(i.monto)}</b><button class="del sm" onclick="borrarIngreso('${i.id}')">×</button></div>`).join('')}`;
}
function agregarIngreso(e, cid) {
  e.preventDefault(); const f = e.target, monto = num(fv(f, 'monto'));
  if (monto <= 0) return alert('Ingresa un monto mayor a 0.');
  db.ingresos.push({ id: uid(), cajaId: cid, fecha: fv(f, 'fecha'), monto: r2(monto), concepto: fv(f, 'concepto').trim() });
  save(); openModal(formCaja(db.cajas.find(c => c.id === cid))); render();
}
function borrarIngreso(id) {
  if (!confirm('¿Eliminar este ingreso? Se descontará del fondo.')) return;
  const i = db.ingresos.find(x => x.id === id); db.ingresos = db.ingresos.filter(x => x.id !== id);
  save(); openModal(formCaja(db.cajas.find(c => c.id === i.cajaId))); render();
}
function guardarCaja(e, id) {
  e.preventDefault(); const f = e.target;
  const d = { nombre: fv(f, 'nombre').trim(), tasa: num(fv(f, 'tasa')), mora: num(fv(f, 'mora')), aporte: num(fv(f, 'aporte')) };
  if (id) Object.assign(db.cajas.find(c => c.id === id), d);
  else { const c = { id: uid(), ...d }; db.cajas.push(c); db.cajaActiva = c.id; }
  save(); closeModal(); render();
}
function borrarCaja(id) {
  if (!confirm('Se borrará la caja con todos sus socios, préstamos y reuniones. ¿Continuar?')) return;
  db.cajas = db.cajas.filter(c => c.id !== id);
  ['socios', 'prestamos', 'reuniones', 'ingresos'].forEach(k => db[k] = db[k].filter(x => x.cajaId !== id));
  db.cajaActiva = db.cajas[0]?.id || null; save(); closeModal(); render();
}

/* ===== Socios ===== */
function formSocio(id) {
  const s = db.socios.find(x => x.id === id) || { nombre: '', cedula: '', telefono: '', rol: 'Socio' };
  return `<h2>${id ? 'Editar socio' : 'Nuevo socio'}</h2>
  <form onsubmit="guardarSocio(event,'${id || ''}')">
    <label>Nombre completo</label><input name="nombre" required value="${esc(s.nombre)}">
    <div class="two"><div><label>Cédula</label><input name="cedula" value="${esc(s.cedula)}"></div>
    <div><label>Teléfono (WhatsApp)</label><input name="telefono" inputmode="tel" value="${esc(s.telefono)}"></div></div>
    <label>Rol</label><select name="rol">${['Socio', 'Presidente', 'Tesorero', 'Secretario'].map(r => `<option ${r === s.rol ? 'selected' : ''}>${r}</option>`).join('')}</select>
    <div class="bar"><button>Guardar</button><button type="button" class="sec" onclick="closeModal()">Cancelar</button>
    ${id ? `<button type="button" class="del" onclick="borrarSocio('${id}')">Eliminar</button>` : ''}</div>
  </form>`;
}
function guardarSocio(e, id) {
  e.preventDefault(); const f = e.target;
  const d = { nombre: fv(f, 'nombre').trim(), cedula: fv(f, 'cedula').trim(), telefono: fv(f, 'telefono').trim(), rol: fv(f, 'rol') };
  if (id) Object.assign(db.socios.find(s => s.id === id), d);
  else db.socios.push({ id: uid(), cajaId: cajaActual().id, ...d });
  save(); closeModal(); render();
}
function borrarSocio(id) {
  if (db.prestamos.some(p => p.socioId === id)) return alert('El socio tiene préstamos registrados; no se puede eliminar.');
  if (!confirm('¿Eliminar socio?')) return;
  db.socios = db.socios.filter(s => s.id !== id); save(); closeModal(); render();
}

/* ===== Préstamos ===== */
function formPrestamo() {
  const c = cajaActual(), socios = db.socios.filter(s => s.cajaId === c.id), st = stats(c.id);
  if (!socios.length) return `<h2>Nuevo préstamo</h2><p class="empty">Primero registra socios.</p><button onclick="closeModal()">Cerrar</button>`;
  return `<h2>Nuevo préstamo</h2><p class="m">Efectivo disponible en caja: <b>${money(st.efectivo)}</b></p>
  <form onsubmit="guardarPrestamo(event)">
    <label>Socio</label><select name="socio">${socios.map(s => `<option value="${s.id}">${esc(s.nombre)}</option>`).join('')}</select>
    <div class="two"><div><label>Monto ($)</label><input name="monto" required inputmode="decimal"></div>
    <div><label>Plazo (meses)</label><input name="plazo" required inputmode="numeric" value="6"></div></div>
    <div class="two"><div><label>Interés mensual (%)</label><input name="tasa" inputmode="decimal" value="${c.tasa}"></div>
    <div><label>Mora mensual (%)</label><input name="mora" inputmode="decimal" value="${c.mora}"></div></div>
    <div class="two"><div><label>Método</label><select name="metodo"><option value="fijo">Interés fijo (sobre monto inicial)</option><option value="frances">Francés (sobre saldo)</option></select></div>
    <div><label>Días de gracia</label><input name="gracia" inputmode="numeric" value="0"></div></div>
    <label>Fecha de desembolso</label><input type="date" name="fecha" value="${today()}" required>
    <div class="bar"><button>Crear préstamo</button><button type="button" class="sec" onclick="closeModal()">Cancelar</button></div>
  </form>`;
}
function guardarPrestamo(e) {
  e.preventDefault(); const f = e.target, c = cajaActual();
  const monto = num(fv(f, 'monto')), plazo = parseInt(fv(f, 'plazo'));
  if (monto <= 0 || !(plazo > 0)) return alert('Monto y plazo deben ser mayores a 0.');
  const ef = stats(c.id).efectivo;
  if (monto > ef && !confirm(`El monto supera el efectivo disponible (${money(ef)}). ¿Crear de todas formas?`)) return;
  const p = { id: uid(), cajaId: c.id, socioId: fv(f, 'socio'), monto, plazo, tasa: num(fv(f, 'tasa')), mora: num(fv(f, 'mora')), metodo: fv(f, 'metodo'), gracia: parseInt(fv(f, 'gracia')) || 0, fecha: fv(f, 'fecha'), pagos: [] };
  db.prestamos.push(p); save(); closeModal(); location.hash = '#/prestamo/' + p.id;
}
function formPago(pid) {
  const p = db.prestamos.find(x => x.id === pid), i = info(p), pr = i.proxima;
  return `<h2>Registrar pago</h2><p class="m">${esc(socioNombre(p.socioId))} · Saldo: ${money(i.saldoTot)} · Mora adeudada: ${money(i.moraDebe)}</p>
  <form onsubmit="guardarPago(event,'${pid}')">
    <label>Monto a cuota ($)</label><input name="monto" inputmode="decimal" value="${pr ? pr.pend : 0}">
    <label>Cobro de mora ($)</label><input name="mora" inputmode="decimal" value="${i.moraDebe}">
    <label>Fecha</label><input type="date" name="fecha" value="${today()}" required>
    <label>Nota</label><input name="nota">
    <div class="bar"><button>Guardar pago</button><button type="button" class="sec" onclick="closeModal()">Cancelar</button></div>
  </form>`;
}
function guardarPago(e, pid) {
  e.preventDefault(); const f = e.target, p = db.prestamos.find(x => x.id === pid), i = info(p);
  const monto = num(fv(f, 'monto')), mora = num(fv(f, 'mora'));
  if (monto < 0 || mora < 0 || monto + mora <= 0) return alert('Ingresa un monto válido.');
  if (monto > i.saldoTot + 0.001) return alert('El pago supera el saldo pendiente.');
  p.pagos.push({ id: uid(), fecha: fv(f, 'fecha'), monto: r2(monto), mora: r2(mora), nota: fv(f, 'nota') });
  save(); closeModal(); render();
}
function borrarPago(pid, id) {
  if (!confirm('¿Eliminar este pago?')) return;
  const p = db.prestamos.find(x => x.id === pid); p.pagos = p.pagos.filter(x => x.id !== id); save(); render();
}
function borrarPrestamo(id) {
  if (!confirm('¿Eliminar préstamo y sus pagos?')) return;
  db.prestamos = db.prestamos.filter(p => p.id !== id); save(); location.hash = '#/prestamos';
}
function waLink(p, i) {
  const s = db.socios.find(x => x.id === p.socioId); if (!s || !s.telefono || !i.proxima) return '';
  let t = s.telefono.replace(/\D/g, ''); if (t.startsWith('0')) t = '593' + t.slice(1);
  const msg = `Hola ${s.nombre.split(' ')[0]}, te recordamos tu cuota #${i.proxima.n} de ${money(i.proxima.pend)} con vencimiento ${fdate(i.proxima.fecha)}${i.moraDebe ? ` (mora: ${money(i.moraDebe)})` : ''}. ${cajaActual().nombre}.`;
  return `https://wa.me/${t}?text=${encodeURIComponent(msg)}`;
}

/* ===== Reuniones ===== */
function formReunion(id) {
  const c = cajaActual(), socios = db.socios.filter(s => s.cajaId === c.id);
  if (!socios.length) return `<h2>Nueva reunión</h2><p class="empty">Primero registra socios.</p><button onclick="closeModal()">Cerrar</button>`;
  const r = db.reuniones.find(x => x.id === id) || { fecha: today(), lugar: '', asistentes: [], aportes: {}, acta: '' };
  return `<h2>${id ? 'Editar reunión' : 'Nueva reunión'}</h2>
  <form onsubmit="guardarReunion(event,'${id || ''}')">
    <div class="two"><div><label>Fecha</label><input type="date" name="fecha" value="${r.fecha}" required></div>
    <div><label>Lugar</label><input name="lugar" value="${esc(r.lugar)}"></div></div>
    <label>Asistencia y aportes</label>
    ${socios.map(s => `<div class="att"><label><input type="checkbox" name="a_${s.id}" ${(id ? r.asistentes.includes(s.id) : true) ? 'checked' : ''}> ${esc(s.nombre)}</label>
      <input name="m_${s.id}" inputmode="decimal" placeholder="$" value="${id ? (r.aportes[s.id] || '') : c.aporte}"></div>`).join('')}
    <label>Acta / acuerdos</label><textarea name="acta" rows="5">${esc(r.acta)}</textarea>
    <div class="bar"><button>Guardar</button><button type="button" class="sec" onclick="closeModal()">Cancelar</button></div>
  </form>`;
}
function guardarReunion(e, id) {
  e.preventDefault(); const f = e.target, c = cajaActual();
  const asistentes = [], aportes = {};
  db.socios.filter(s => s.cajaId === c.id).forEach(s => {
    if (f.elements['a_' + s.id].checked) asistentes.push(s.id);
    const m = num(f.elements['m_' + s.id].value); if (m > 0) aportes[s.id] = r2(m);
  });
  const d = { fecha: fv(f, 'fecha'), lugar: fv(f, 'lugar'), asistentes, aportes, acta: fv(f, 'acta') };
  if (id) Object.assign(db.reuniones.find(r => r.id === id), d);
  else db.reuniones.push({ id: uid(), cajaId: c.id, ...d });
  save(); closeModal(); render();
}
function borrarReunion(id) {
  if (!confirm('¿Eliminar reunión? Se descontarán sus aportes.')) return;
  db.reuniones = db.reuniones.filter(r => r.id !== id); save(); location.hash = '#/reuniones';
}

/* ===== Reportes / datos ===== */
function reparto(cajaId) {
  const st = stats(cajaId), socios = db.socios.filter(s => s.cajaId === cajaId);
  return socios.map(s => {
    const ap = aporteSocio(cajaId, s.id), pct = st.aportes ? ap / st.aportes : 0, ut = r2(st.utilidad * pct);
    const deuda = db.prestamos.filter(p => p.socioId === s.id).reduce((a, p) => a + info(p).saldoTot, 0);
    return { s, ap: r2(ap), pct, ut, total: r2(ap + ut), deuda: r2(deuda) };
  });
}
function descargar(nombre, tipo, txt) {
  const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([txt], { type: tipo })); a.download = nombre; a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}
function exportCSV() {
  const c = cajaActual(), rows = [['Socio', 'Aportes', 'Participacion %', 'Utilidad', 'Total a recibir', 'Deuda pendiente']];
  reparto(c.id).forEach(r => rows.push([r.s.nombre, r.ap, (r.pct * 100).toFixed(2), r.ut, r.total, r.deuda]));
  descargar(`reparto-${c.nombre}.csv`, 'text/csv', '\ufeff' + rows.map(r => r.map(x => `"${String(x).replace(/"/g, '""')}"`).join(',')).join('\n'));
}
const exportJSON = () => descargar(`respaldo-cajas-${today()}.json`, 'application/json', JSON.stringify(db));
function importJSON(inp) {
  const f = inp.files[0]; if (!f) return;
  const rd = new FileReader();
  rd.onload = () => {
    try {
      const d = JSON.parse(rd.result);
      if (!Array.isArray(d.cajas) || !Array.isArray(d.socios)) throw 0;
      if (!confirm('Esto reemplazará todos los datos actuales. ¿Continuar?')) return;
      db = Object.assign(seed(), d); save(); render();
    } catch (e) { alert('Archivo de respaldo no válido.'); }
  };
  rd.readAsText(f);
}

/* ===== Vistas ===== */
function vInicio(c) {
  const st = stats(c.id), prox = [];
  db.prestamos.filter(p => p.cajaId === c.id).forEach(p => {
    const i = info(p); if (i.proxima) prox.push({ p, i });
  });
  prox.sort((a, b) => a.i.proxima.fecha.localeCompare(b.i.proxima.fecha));
  const lim = addMonths(today(), 0).slice(0, 8) + '99';
  return licCard() + `<div class="grid">
    <div class="stat"><small>Fondo total</small><b>${money(st.fondo)}</b></div>
    <div class="stat"><small>Efectivo en caja</small><b>${money(st.efectivo)}</b></div>
    <div class="stat"><small>Prestado vigente</small><b>${money(st.prestado)}</b></div>
    <div class="stat"><small>Utilidad generada</small><b class="pos">${money(st.utilidad)}</b></div></div>
  <h2>Próximos cobros</h2><div class="card">${prox.length ? prox.slice(0, 12).map(({ p, i }) => `<div class="row"><a href="#/prestamo/${p.id}"><b>${esc(socioNombre(p.socioId))}</b><div class="m">Cuota ${i.proxima.n} · ${fdate(i.proxima.fecha)}</div></a><div style="text-align:right">${money(i.proxima.pend)}<div>${badge(i.estado === 'En mora' ? 'En mora' : i.proxima.estado)}</div></div></div>`).join('') : '<div class="empty">Sin cobros pendientes</div>'}</div>
  <div class="bar"><button class="sec sm" onclick="openModal(formCaja(cajaActual()))">Editar caja</button><button class="sec sm" onclick="openModal(formCaja())">+ Otra caja</button><button class="del sm" onclick="borrarCaja('${c.id}')">Eliminar caja</button></div>`;
}
function vSocios(c) {
  const l = db.socios.filter(s => s.cajaId === c.id);
  return `<div class="bar"><button onclick="openModal(formSocio())">+ Nuevo socio</button></div><div class="card">${l.length ? l.map(s => {
    const deuda = db.prestamos.filter(p => p.socioId === s.id).reduce((a, p) => a + info(p).saldoTot, 0);
    return `<div class="row" onclick="openModal(formSocio('${s.id}'))" style="cursor:pointer"><div><b>${esc(s.nombre)}</b> <span class="badge">${esc(s.rol)}</span><div class="m">${esc(s.telefono)}</div></div><div style="text-align:right"><div>Aportes ${money(aporteSocio(c.id, s.id))}</div><div class="m">Debe ${money(deuda)}</div></div></div>`;
  }).join('') : '<div class="empty">Aún no hay socios</div>'}</div>`;
}
function vPrestamos(c) {
  const l = db.prestamos.filter(p => p.cajaId === c.id).map(p => ({ p, i: info(p) }));
  l.sort((a, b) => (a.i.estado === 'Cancelado') - (b.i.estado === 'Cancelado') || b.p.fecha.localeCompare(a.p.fecha));
  return `<div class="bar"><button onclick="openModal(formPrestamo())">+ Nuevo préstamo</button></div><div class="card">${l.length ? l.map(({ p, i }) => `<div class="row"><a href="#/prestamo/${p.id}"><b>${esc(socioNombre(p.socioId))}</b><div class="m">${money(p.monto)} · ${p.plazo} meses · ${fdate(p.fecha)}</div></a><div style="text-align:right">${money(i.saldoTot)}<div>${badge(i.estado)}</div></div></div>`).join('') : '<div class="empty">Sin préstamos</div>'}</div>`;
}
function vPrestamo(id) {
  const p = db.prestamos.find(x => x.id === id); if (!p) return '<div class="empty">No encontrado</div>';
  const i = info(p), wa = waLink(p, i);
  return `<a href="#/prestamos" class="m">← Préstamos</a>
  <div class="card"><h2 style="margin-top:0">${esc(socioNombre(p.socioId))} ${badge(i.estado)}</h2>
    <div class="m">${money(p.monto)} · ${p.plazo} meses · ${p.tasa}% mensual (${p.metodo === 'fijo' ? 'fijo' : 'francés'}) · mora ${p.mora}% · desde ${fdate(p.fecha)}</div>
    <div class="grid" style="margin-top:10px"><div class="stat"><small>Saldo total</small><b>${money(i.saldoTot)}</b></div><div class="stat"><small>Saldo capital</small><b>${money(i.saldoCap)}</b></div><div class="stat"><small>Mora adeudada</small><b class="${i.moraDebe ? 'neg' : ''}">${money(i.moraDebe)}</b></div></div>
    <div class="bar">${i.estado !== 'Cancelado' ? `<button onclick="openModal(formPago('${p.id}'))">Registrar pago</button>` : ''}${wa ? `<a class="btn sec" style="background:transparent;color:var(--p);border:1px solid var(--p)" href="${wa}" target="_blank" rel="noopener">Recordar por WhatsApp</a>` : ''}<button class="sec" onclick="window.print()">Imprimir</button><button class="del" onclick="borrarPrestamo('${p.id}')">Eliminar</button></div></div>
  <h2>Tabla de amortización</h2><div class="card scroll"><table><tr><th>#</th><th>Fecha</th><th>Capital</th><th>Interés</th><th>Cuota</th><th>Pagado</th><th>Estado</th></tr>
  ${i.sch.map(c => `<tr><td>${c.n}</td><td class="l">${fdate(c.fecha)}</td><td>${money(c.capital)}</td><td>${money(c.interes)}</td><td>${money(c.total)}</td><td>${money(c.pagado)}</td><td>${badge(c.estado)}</td></tr>`).join('')}</table></div>
  <h2>Pagos</h2><div class="card">${p.pagos.length ? p.pagos.map(x => `<div class="row"><div>${fdate(x.fecha)}<div class="m">${esc(x.nota)}</div></div><div style="text-align:right">${money(x.monto)}${x.mora ? `<div class="m">+ mora ${money(x.mora)}</div>` : ''}</div><button class="del sm" onclick="borrarPago('${p.id}','${x.id}')">×</button></div>`).join('') : '<div class="empty">Sin pagos</div>'}</div>`;
}
function vReuniones(c) {
  const l = db.reuniones.filter(r => r.cajaId === c.id).sort((a, b) => b.fecha.localeCompare(a.fecha));
  return `<div class="bar"><button onclick="openModal(formReunion())">+ Nueva reunión</button></div><div class="card">${l.length ? l.map(r => `<div class="row"><a href="#/reunion/${r.id}"><b>${fdate(r.fecha)}</b><div class="m">${esc(r.lugar)} · ${r.asistentes.length} asistentes</div></a><b>${money(Object.values(r.aportes).reduce((a, b) => a + b, 0))}</b></div>`).join('') : '<div class="empty">Sin reuniones</div>'}</div>`;
}
function vReunion(id) {
  const r = db.reuniones.find(x => x.id === id); if (!r) return '<div class="empty">No encontrada</div>';
  const c = cajaActual(), tot = Object.values(r.aportes).reduce((a, b) => a + b, 0);
  const socios = db.socios.filter(s => s.cajaId === c.id);
  return `<a href="#/reuniones" class="m">← Reuniones</a>
  <div class="card"><h2 style="margin-top:0">Acta de reunión · ${esc(c.nombre)}</h2><div class="m">${fdate(r.fecha)} ${r.lugar ? '· ' + esc(r.lugar) : ''}</div>
  <div class="scroll"><table><tr><th>Socio</th><th>Asistió</th><th>Aporte</th></tr>${socios.map(s => `<tr><td class="l">${esc(s.nombre)}</td><td>${r.asistentes.includes(s.id) ? 'Sí' : 'No'}</td><td>${money(r.aportes[s.id] || 0)}</td></tr>`).join('')}<tr><th class="l">Total</th><th></th><th>${money(tot)}</th></tr></table></div>
  <h2>Acuerdos</h2><div style="white-space:pre-wrap">${esc(r.acta) || '<span class="m">Sin acta</span>'}</div>
  <div class="bar noprint"><button onclick="openModal(formReunion('${r.id}'))">Editar</button><button class="sec" onclick="window.print()">Imprimir acta</button><button class="del" onclick="borrarReunion('${r.id}')">Eliminar</button></div></div>`;
}
function vReportes(c) {
  if (!c) return `<div class="card"><button onclick="exportJSON()">Respaldo</button> <label class="btn sec">Restaurar<input type="file" accept=".json" hidden onchange="importJSON(this)"></label></div>`;
  const st = stats(c.id), rep = reparto(c.id);
  const mor = db.prestamos.filter(p => p.cajaId === c.id).map(p => ({ p, i: info(p) })).filter(x => x.i.estado === 'En mora');
  return `<div class="card"><h2 style="margin-top:0">Balance · ${esc(c.nombre)}</h2><div class="m">Al ${fdate(today())}</div>
  <table><tr><td class="l">Aportes de socios</td><td>${money(st.aportes)}</td></tr><tr><td class="l">Ingresos al fondo</td><td>${money(st.ingresos)}</td></tr><tr><td class="l">Total desembolsado</td><td>- ${money(st.desembolsado)}</td></tr><tr><td class="l">Capital recuperado</td><td>${money(st.desembolsado - st.prestado)}</td></tr><tr><td class="l">Intereses cobrados</td><td>${money(st.interes)}</td></tr><tr><td class="l">Mora cobrada</td><td>${money(st.mora)}</td></tr>
  <tr><th class="l">Efectivo en caja</th><th>${money(st.efectivo)}</th></tr><tr><td class="l">Cartera vigente (capital)</td><td>${money(st.prestado)}</td></tr><tr><th class="l">Fondo total</th><th>${money(st.fondo)}</th></tr></table></div>
  <h2>Reparto de utilidades</h2><div class="card scroll"><table><tr><th class="l">Socio</th><th>Aportes</th><th>%</th><th>Utilidad</th><th>A recibir</th><th>Debe</th></tr>
  ${rep.map(r => `<tr><td class="l">${esc(r.s.nombre)}</td><td>${money(r.ap)}</td><td>${(r.pct * 100).toFixed(1)}</td><td>${money(r.ut)}</td><td><b>${money(r.total)}</b></td><td>${money(r.deuda)}</td></tr>`).join('')}</table>
  <p class="m">Utilidad = intereses + mora cobrados, repartida según el aporte de cada socio.</p></div>
  <h2>Cartera en mora</h2><div class="card">${mor.length ? mor.map(({ p, i }) => `<div class="row"><a href="#/prestamo/${p.id}">${esc(socioNombre(p.socioId))}</a><div style="text-align:right">${money(i.saldoTot)}<div class="m neg">mora ${money(i.moraDebe)}</div></div></div>`).join('') : '<div class="empty">Sin mora</div>'}</div>
  <div class="bar noprint"><button onclick="window.print()">Imprimir / PDF</button><button class="sec" onclick="exportCSV()">Exportar CSV</button><button class="sec" onclick="exportJSON()">Respaldo</button>${modo === 'nube' ? '<button class="sec" onclick="openModal(formClave())">Cambiar contraseña</button><button class="sec" onclick="abrirLicencias()">Licencias</button>' : ''}<label class="btn sec" style="border:1px solid var(--p);color:var(--p);background:transparent">Restaurar<input type="file" accept=".json" hidden onchange="importJSON(this)"></label></div>`;
}

/* ===== Router ===== */
function render() {
  if (locked) return;
  const [v, id] = (location.hash || '#/inicio').slice(2).split('/');
  const base = { prestamo: 'prestamos', reunion: 'reuniones' }[v] || v;
  document.querySelectorAll('nav a').forEach(a => a.classList.toggle('on', a.dataset.v === base));
  const sel = $('#cajaSel');
  sel.innerHTML = db.cajas.map(c => `<option value="${c.id}" ${c.id === cajaActual()?.id ? 'selected' : ''}>${esc(c.nombre)}</option>`).join('') || '<option>Sin cajas</option>';
  const c = cajaActual(), el = $('#app');
  if (!c && v !== 'reportes') { el.innerHTML = `<div class="card"><h2 style="margin-top:0">Crea tu primera caja comunal</h2>${formCaja()}</div>`; return; }
  const views = { inicio: () => vInicio(c), socios: () => vSocios(c), prestamos: () => vPrestamos(c), prestamo: () => vPrestamo(id), reuniones: () => vReuniones(c), reunion: () => vReunion(id), reportes: () => vReportes(c) };
  el.innerHTML = (views[v] || views.inicio)();
  window.scrollTo(0, 0);
}
$('#cajaSel').addEventListener('change', e => { db.cajaActiva = e.target.value; save(); render(); });
window.addEventListener('hashchange', render);
if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});
boot();
