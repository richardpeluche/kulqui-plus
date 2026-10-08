'use strict';
/* ===== Carga masiva desde Excel / CSV (se carga solo al usarla) ===== */
const KQI = (() => {
  const norm = s => String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]/g, '');
  const TIPOS = {
    socios: { t: 'Socios', cols: {
      nombre: ['nombre', 'nombres', 'socio', 'socios', 'apellidosynombres', 'nombrescompletos', 'cliente'],
      cedula: ['cedula', 'ci', 'cc', 'documento', 'identificacion', 'dni', 'ruc'],
      telefono: ['telefono', 'celular', 'movil', 'whatsapp', 'tel', 'fono'],
      rol: ['rol', 'cargo', 'funcion'] }, req: ['nombre'],
      ej: [['Maria Perez', '1712345678', '0991234567', 'Socio'], ['Juan Lopez', '1798765432', '0987654321', 'Tesorero']], enc: ['Nombre', 'Cedula', 'Telefono', 'Rol'] },
    prestamos: { t: 'Préstamos', cols: {
      socio: ['socio', 'nombre', 'nombres', 'cliente', 'deudor', 'prestatario'],
      monto: ['monto', 'capital', 'prestamo', 'valor', 'montoprestado', 'importe'],
      plazo: ['plazo', 'meses', 'cuotas', 'nrocuotas', 'numerocuotas', 'ncuotas'],
      tasa: ['tasa', 'interes', 'tasamensual', 'interesmensual', 'tasa%'],
      metodo: ['metodo', 'tipo', 'sistema', 'amortizacion'],
      fecha: ['fecha', 'desembolso', 'fechadesembolso', 'fechaprestamo', 'fechainicio'],
      mora: ['mora', 'tasamora', 'moramensual'],
      gracia: ['gracia', 'mesesgracia', 'periodogracia'] }, req: ['socio', 'monto', 'plazo'],
      ej: [['Maria Perez', 500, 6, 2, 'fijo', '2026-01-15', 1, 0]], enc: ['Socio', 'Monto', 'Plazo (meses)', 'Tasa mensual %', 'Metodo (fijo/frances)', 'Fecha', 'Mora %', 'Gracia (meses)'] },
    pagos: { t: 'Pagos de préstamos', cols: {
      socio: ['socio', 'nombre', 'nombres', 'cliente', 'deudor'],
      fecha: ['fecha', 'fechapago'],
      monto: ['monto', 'pago', 'abono', 'valor', 'cuota', 'montopagado'],
      mora: ['mora', 'cobromora', 'moracobrada'],
      nota: ['nota', 'detalle', 'observacion', 'observaciones', 'comentario'] }, req: ['socio', 'fecha', 'monto'],
      ej: [['Maria Perez', '2026-02-15', 95, 0, 'Cuota 1']], enc: ['Socio', 'Fecha', 'Monto', 'Mora', 'Nota'] },
    aportes: { t: 'Aportes de socios', cols: {
      socio: ['socio', 'nombre', 'nombres', 'cliente'],
      fecha: ['fecha', 'fechareunion', 'reunion'],
      monto: ['monto', 'aporte', 'ahorro', 'valor', 'cuota'] }, req: ['socio', 'fecha', 'monto'],
      ej: [['Maria Perez', '2026-01-15', 20], ['Juan Lopez', '2026-01-15', 20]], enc: ['Socio', 'Fecha', 'Monto'] },
    ingresos: { t: 'Ingresos al fondo', cols: {
      fecha: ['fecha'],
      monto: ['monto', 'ingreso', 'valor', 'importe'],
      concepto: ['concepto', 'detalle', 'descripcion', 'motivo', 'nota'] }, req: ['fecha', 'monto'],
      ej: [['2026-01-20', 150, 'Rifa']], enc: ['Fecha', 'Monto', 'Concepto'] }
  };
  let tipo = 'socios', filas = null, err = [], mapa = null, opt = { crear: true };

  /* --- conversión de valores --- */
  const iso = (y, m, d) => (y > 1900 && m >= 1 && m <= 12 && d >= 1 && d <= 31) ? `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}` : null;
  function fecha(v) {
    if (v instanceof Date && !isNaN(v)) return iso(v.getFullYear(), v.getMonth() + 1, v.getDate());
    if (typeof v === 'number' && v > 20000 && v < 80000) { const d = new Date(Math.round((v - 25569) * 864e5)); return iso(d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate()); }
    const s = String(v ?? '').trim(); let m;
    if ((m = s.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})/))) return iso(+m[1], +m[2], +m[3]);
    if ((m = s.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{2,4})/))) return iso(m[3].length === 2 ? 2000 + +m[3] : +m[3], +m[2], +m[1]);
    return null;
  }
  function numero(v) {
    if (typeof v === 'number') return v;
    let s = String(v ?? '').replace(/[^\d.,-]/g, ''); if (!s) return NaN;
    const c = s.lastIndexOf(','), p = s.lastIndexOf('.');
    if (c >= 0 && p >= 0) s = c > p ? s.replace(/\./g, '').replace(',', '.') : s.replace(/,/g, '');
    else if (c >= 0) s = (s.match(/,/g).length === 1 && s.length - c - 1 <= 2) ? s.replace(',', '.') : s.replace(/,/g, '');
    return parseFloat(s);
  }

  /* --- lectura del archivo --- */
  function leer(file) {
    return new Promise((ok, no) => {
      const rd = new FileReader();
      rd.onload = () => {
        try {
          const isCsv = /\.(csv|txt)$/i.test(file.name);
          const wb = isCsv ? XLSX.read(rd.result, { type: 'string', cellDates: true, raw: true }) : XLSX.read(rd.result, { type: 'array', cellDates: true });
          const ws = wb.Sheets[wb.SheetNames[0]];
          ok(XLSX.utils.sheet_to_json(ws, { header: 1, raw: true, defval: '', blankrows: false }));
        } catch (e) { no(new Error('No se pudo leer el archivo. Usa .xlsx, .xls o .csv.')); }
      };
      rd.onerror = () => no(new Error('No se pudo leer el archivo.'));
      isCsvName(file) ? rd.readAsText(file) : rd.readAsArrayBuffer(file);
    });
  }
  const isCsvName = f => /\.(csv|txt)$/i.test(f.name);

  function detectar(matriz, def) {
    let mejor = null;
    matriz.slice(0, 15).forEach((fila, i) => {
      const m = {}; let n = 0;
      fila.forEach((h, j) => {
        const k = norm(h); if (!k) return;
        for (const [campo, sin] of Object.entries(def.cols)) if (m[campo] === undefined && sin.includes(k)) { m[campo] = j; n++; break; }
      });
      if (def.req.every(r => m[r] !== undefined) && (!mejor || n > mejor.n)) mejor = { i, m, n };
    });
    return mejor;
  }

  function procesar(matriz) {
    const def = TIPOS[tipo], det = detectar(matriz, def); err = []; filas = [];
    if (!det) throw new Error(`No encontré las columnas obligatorias (${def.req.join(', ')}). Descarga la plantilla y copia tus datos en ella.`);
    mapa = det.m;
    matriz.slice(det.i + 1).forEach((r, k) => {
      const nro = det.i + k + 2, g = c => mapa[c] === undefined ? '' : r[mapa[c]];
      if (r.every(x => String(x).trim() === '')) return;
      const o = { nro };
      for (const campo of Object.keys(def.cols)) o[campo] = g(campo);
      const e = validar(o);
      e ? err.push(`Fila ${nro}: ${e}`) : filas.push(o);
    });
  }

  function validar(o) {
    const pos = (v, n) => { const x = numero(v); return x > 0 ? x : null; };
    if (tipo === 'socios') { o.nombre = String(o.nombre).trim(); if (!o.nombre) return 'falta el nombre'; o.cedula = String(o.cedula ?? '').trim(); o.telefono = String(o.telefono ?? '').trim(); o.rol = /teso/i.test(o.rol) ? 'Tesorero' : /pres/i.test(o.rol) ? 'Presidente' : /secre/i.test(o.rol) ? 'Secretario' : 'Socio'; return null; }
    if (tipo !== 'ingresos') { o.socio = String(o.socio).trim(); if (!o.socio) return 'falta el socio'; }
    if (tipo === 'ingresos') { o.concepto = String(o.concepto ?? '').trim(); }
    const mo = pos(o.monto); if (!mo) return 'monto inválido';
    o.monto = Math.round(mo * 100) / 100;
    if (tipo === 'prestamos') {
      const pl = parseInt(numero(o.plazo)); if (!(pl > 0 && pl <= 360)) return 'plazo inválido';
      o.plazo = pl; const ta = numero(o.tasa); o.tasa = isNaN(ta) ? cajaActual().tasa : ta;
      const mr = numero(o.mora); o.mora = isNaN(mr) ? cajaActual().mora : mr;
      o.gracia = Math.max(0, parseInt(numero(o.gracia)) || 0);
      o.metodo = /franc/i.test(o.metodo) ? 'frances' : 'fijo';
      o.fecha = o.fecha === '' ? today() : fecha(o.fecha); if (!o.fecha) return 'fecha inválida';
      return null;
    }
    o.fecha = fecha(o.fecha); if (!o.fecha) return 'fecha inválida';
    if (tipo === 'pagos') { const mr = numero(o.mora); o.mora = isNaN(mr) || mr < 0 ? 0 : Math.round(mr * 100) / 100; o.nota = String(o.nota ?? '').trim(); }
    if (tipo === 'ingresos') return null;
    return null;
  }

  /* --- aplicar a la base --- */
  function aplicar() {
    const c = cajaActual(), r = { nuevos: 0, omitidos: 0, sociosCreados: 0, sinSocio: [] };
    const socios = () => db.socios.filter(s => s.cajaId === c.id);
    const buscar = txt => { const k = norm(txt); return socios().find(s => norm(s.nombre) === k) || socios().find(s => s.cedula && norm(s.cedula) === k); };
    const asegurar = txt => {
      let s = buscar(txt);
      if (!s && opt.crear) { s = { id: uid(), cajaId: c.id, nombre: txt, cedula: '', telefono: '', rol: 'Socio' }; db.socios.push(s); r.sociosCreados++; }
      return s;
    };
    for (const o of filas) {
      if (tipo === 'socios') {
        const ya = socios().find(s => (o.cedula && s.cedula === o.cedula) || norm(s.nombre) === norm(o.nombre));
        if (ya) { r.omitidos++; continue; }
        db.socios.push({ id: uid(), cajaId: c.id, nombre: o.nombre, cedula: o.cedula, telefono: o.telefono, rol: o.rol }); r.nuevos++;
      } else if (tipo === 'ingresos') {
        if (db.ingresos.some(x => x.cajaId === c.id && x.fecha === o.fecha && x.monto === o.monto && (x.concepto || '') === o.concepto)) { r.omitidos++; continue; }
        db.ingresos.push({ id: uid(), cajaId: c.id, fecha: o.fecha, monto: o.monto, concepto: o.concepto }); r.nuevos++;
      } else {
        const s = asegurar(o.socio); if (!s) { r.sinSocio.push(o.socio); continue; }
        if (tipo === 'prestamos') {
          if (db.prestamos.some(p => p.socioId === s.id && p.monto === o.monto && p.fecha === o.fecha && p.plazo === o.plazo)) { r.omitidos++; continue; }
          db.prestamos.push({ id: uid(), cajaId: c.id, socioId: s.id, monto: o.monto, plazo: o.plazo, tasa: o.tasa, mora: o.mora, metodo: o.metodo, gracia: o.gracia, fecha: o.fecha, pagos: [] }); r.nuevos++;
        } else if (tipo === 'pagos') {
          const ps = db.prestamos.filter(p => p.socioId === s.id && p.cajaId === c.id).sort((a, b) => a.fecha.localeCompare(b.fecha));
          const p = [...ps].reverse().find(x => x.fecha <= o.fecha) || ps[0];
          if (!p) { r.sinSocio.push(o.socio + ' (sin préstamo)'); continue; }
          if (p.pagos.some(x => x.fecha === o.fecha && x.monto === o.monto && (x.mora || 0) === o.mora)) { r.omitidos++; continue; }
          p.pagos.push({ id: uid(), fecha: o.fecha, monto: o.monto, mora: o.mora, nota: o.nota }); r.nuevos++;
        } else if (tipo === 'aportes') {
          let m = db.reuniones.find(x => x.cajaId === c.id && x.fecha === o.fecha);
          if (!m) { m = { id: uid(), cajaId: c.id, fecha: o.fecha, lugar: '', asistentes: [], aportes: {}, acta: '' }; db.reuniones.push(m); }
          if (m.aportes[s.id] === o.monto) { r.omitidos++; continue; }
          m.aportes[s.id] = o.monto; if (!m.asistentes.includes(s.id)) m.asistentes.push(s.id); r.nuevos++;
        }
      }
    }
    return r;
  }

  /* --- interfaz --- */
  const lista = a => a.slice(0, 8).map(x => `<div class="m">${esc(x)}</div>`).join('') + (a.length > 8 ? `<div class="m">… y ${a.length - 8} más</div>` : '');
  function abrir(msg) {
    filas = null; err = [];
    openModal(`<h2>Carga masiva</h2>
      <p class="m">Importa tus datos desde Excel (.xlsx, .xls) o CSV a la caja <b>${esc(cajaActual().nombre)}</b>. Lo que ya existe no se duplica.</p>
      <label>¿Qué vas a importar?</label>
      <select id="kqiTipo" onchange="KQI.cambiar(this.value)">${Object.entries(TIPOS).map(([k, v]) => `<option value="${k}" ${k === tipo ? 'selected' : ''}>${v.t}</option>`).join('')}</select>
      <div class="m" id="kqiCols"></div>
      <div class="bar"><button type="button" class="sec sm" onclick="KQI.plantilla()">Descargar plantilla</button></div>
      <label>Archivo</label><input type="file" id="kqiFile" accept=".xlsx,.xls,.csv,.txt" onchange="KQI.archivo(this)">
      <div class="err" id="kqiErr">${esc(msg || '')}</div><div id="kqiPrev"></div>
      <div class="bar"><button type="button" class="sec" onclick="closeModal()">Cerrar</button></div>`);
    cambiar(tipo);
  }
  function cambiar(t) {
    tipo = t; const d = TIPOS[t];
    const el = document.getElementById('kqiCols'); if (el) el.textContent = 'Columnas: ' + d.enc.join(' · ') + '. Obligatorias: ' + d.req.join(', ') + '.';
    const pv = document.getElementById('kqiPrev'); if (pv) pv.innerHTML = '';
    filas = null;
  }
  function plantilla() {
    const d = TIPOS[tipo], ws = XLSX.utils.aoa_to_sheet([d.enc, ...d.ej]), wb = XLSX.utils.book_new();
    ws['!cols'] = d.enc.map(h => ({ wch: Math.max(14, h.length + 2) }));
    XLSX.utils.book_append_sheet(wb, ws, d.t.slice(0, 30));
    descargar(`plantilla-${tipo}.xlsx`, 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', XLSX.write(wb, { type: 'array', bookType: 'xlsx' }));
  }
  async function archivo(inp) {
    const f = inp.files[0], e = document.getElementById('kqiErr'), pv = document.getElementById('kqiPrev'); if (!f) return;
    e.textContent = ''; pv.innerHTML = '<div class="m">Leyendo…</div>';
    try {
      procesar(await leer(f));
      const def = TIPOS[tipo], campos = Object.keys(def.cols).filter(k => mapa[k] !== undefined);
      const nec = tipo !== 'socios' && tipo !== 'ingresos';
      pv.innerHTML = `<div class="card"><b>${filas.length} fila(s) válida(s)</b>${err.length ? `, <span class="neg">${err.length} con error (no se importarán)</span>` : ''}
        ${err.length ? lista(err) : ''}</div>
        ${filas.length ? `<div class="scroll"><table><tr>${campos.map(k => `<th>${k}</th>`).join('')}</tr>${filas.slice(0, 5).map(o => `<tr>${campos.map(k => `<td class="l">${esc(o[k])}</td>`).join('')}</tr>`).join('')}</table></div>
        ${nec ? `<label style="display:flex;gap:8px;align-items:center;margin:10px 0"><input type="checkbox" ${opt.crear ? 'checked' : ''} onchange="KQI.crear(this.checked)"> Crear los socios que no existan</label>` : ''}
        <div class="bar"><button type="button" onclick="KQI.importar()">Importar ${filas.length} fila(s)</button></div>` : ''}`;
    } catch (x) { pv.innerHTML = ''; e.textContent = x.message; }
  }
  function importar() {
    if (!filas || !filas.length) return;
    const r = aplicar(); save(); render(); filas = null;
    openModal(`<h2>Importación terminada</h2><div class="card">
      <div><b>${r.nuevos}</b> registro(s) importado(s)</div>
      ${r.sociosCreados ? `<div>${r.sociosCreados} socio(s) creado(s)</div>` : ''}
      ${r.omitidos ? `<div class="m">${r.omitidos} ya existían y se omitieron</div>` : ''}
      ${r.sinSocio.length ? `<div class="neg">No se importaron ${r.sinSocio.length} fila(s): socio no encontrado</div>${lista([...new Set(r.sinSocio)])}` : ''}</div>
      <div class="bar"><button onclick="KQI.abrir()">Importar otro</button><button class="sec" onclick="closeModal()">Cerrar</button></div>`);
  }
  return { abrir, cambiar, plantilla, archivo, importar, crear: v => { opt.crear = v; }, _t: { fecha, numero, norm } };
})();
