// Vista de escritorio: dibuja el libro y convierte ratón y teclado en acciones del despachador.

import { icono } from './iconos.js';
import { CINTA, TAMANOS, FORMATOS_NUMERO, PALETA } from './cinta.js';
import { MAXC, MAXF, hojaActiva, obtener, resultado } from '../nucleo/libro.js';
import { colALetra, dir, parseDir, parseRango, textoRango, alternarRef } from '../formulas/analizador.js';
import { mostrar, alineacionNatural, textoEdicion, numGeneral } from '../nucleo/formato.js';
import { FUNCIONES } from '../formulas/funciones.js';

const ANCHO = 80, ANCHO_FILA = 40;
const RE_LETRA = 'A-Za-z\\u00C0-\\u024F';
const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

export function crearVista(raiz, libro, motor, desp, reg) {
  const T = reg.textos;
  const $ = (s, el = raiz) => el.querySelector(s);
  const ejecutar = a => desp.ejecutar(a);
  const hoja = () => hojaActiva(libro);

  let editando = false, modoEd = '', apuntado = null, arrastre = null;
  let verFormulas = false, zoom = 1, pestActiva = 'inicio';
  let pintadas = new Set(), enSel = [], menuAbierto = null, sugerencias = [];
  let temporizadorAviso = 0;
  // Pantalla táctil: no se abre el teclado en cada toque y aparecen manijas y teclas rápidas.
  const tactil = matchMedia('(pointer: coarse)').matches || (navigator.maxTouchPoints > 0 && matchMedia('(max-width: 767px)').matches);
  const esMovil = () => matchMedia('(max-width: 767px)').matches;
  raiz.classList.toggle('tactil', tactil);
  let toque = null, ultimoToque = null, relojToque = 0;
  let punto = null;   // celda que se está señalando dentro de una fórmula
  let prevEd = '';    // texto del editor ya registrado como gesto
  const oyentesGesto = new Set();
  const gesto = g => { for (const o of oyentesGesto) o(g); };

  // ------------------------------------------------------------------ estructura
  raiz.innerHTML = `
    <header class="titulo">
      <button class="rapido" data-cmd="rapido.deshacer" data-tipo="F" title="${esc(T.deshacer)}">${icono('deshacer')}</button>
      <button class="rapido" data-cmd="rapido.rehacer" data-tipo="F" title="${esc(T.rehacer)}">${icono('rehacer')}</button>
      <span class="nombre-libro">${esc(T.libro)}</span>
    </header>
    <nav class="pestanas" role="tablist"></nav>
    <div class="cinta"></div>
    <div class="barra-formulas">
      <input class="cuadro-nombres" spellcheck="false" autocomplete="off" aria-label="${esc(T.cuadroNombres)}">
      <button class="bf bf-cancelar" title="${esc(T.cancelar)}" tabindex="-1">✕</button>
      <button class="bf bf-aceptar" title="${esc(T.introducirBt)}" tabindex="-1">✓</button>
      <button class="bf bf-fx" data-cmd="formulas.insertar-funcion" data-tipo="F" title="${esc(T.cinta['formulas.insertar-funcion'])}" tabindex="-1"><i>fx</i></button>
      <input class="entrada-formula" spellcheck="false" autocomplete="off" aria-label="${esc(T.barraFormulas)}">
    </div>
    <main class="zona"><div class="lienzo"></div></main>
    <div class="teclas" aria-label="Teclas rápidas">${['=', ';', '(', ')', ':', '$', '"', '<', '>', '+', '-', '*', '/'].map(k => `<button data-k="${esc(k)}" tabindex="-1">${esc(k)}</button>`).join('')}</div>
    <footer class="pie">
      <div class="hojas"></div>
      <div class="estado">
        <span class="modo"></span><span class="resumen"></span>
        <input type="range" class="zoom" min="50" max="200" step="10" value="100" aria-label="Zoom"><span class="zoom-txt">100%</span>
      </div>
    </footer>
    <div class="aviso" role="status" hidden></div>
    <div class="pista-fn" hidden></div>
    <dialog class="dlg dlg-funcion"></dialog>`;

  const zona = $('.zona'), lienzo = $('.lienzo'), barra = $('.entrada-formula'), nombres = $('.cuadro-nombres');
  const pista = $('.pista-fn'), avisoEl = $('.aviso');

  // ------------------------------------------------------------------ cuadrícula
  {
    let html = '<table class="hoja"><colgroup><col style="width:' + ANCHO_FILA + 'px">';
    for (let c = 0; c < MAXC; c++) html += '<col>';
    html += '</colgroup><thead><tr><th class="esq"></th>';
    for (let c = 0; c < MAXC; c++) html += '<th class="col">' + colALetra(c) + '<div class="redim"></div></th>';
    html += '</tr></thead><tbody>';
    const fila = '<td></td>'.repeat(MAXC);
    for (let f = 0; f < MAXF; f++) html += '<tr><th class="fila">' + (f + 1) + '</th>' + fila + '</tr>';
    html += '</tbody></table><div class="sel"><div class="manija m1"></div><div class="manija m2"></div><div class="asa"></div></div><div class="marca" hidden></div><div class="halo" hidden></div><div class="marca-copia" hidden></div><input class="editor oculto" spellcheck="false" autocomplete="off" autocapitalize="off">';
    lienzo.innerHTML = html;
  }
  const tabla = $('.hoja'), cols = [...tabla.querySelectorAll('col')].slice(1);
  const thCols = [...tabla.tHead.rows[0].cells].slice(1);
  const filas = [...tabla.tBodies[0].rows];
  const td = (c, f) => filas[f].cells[c + 1];
  const selEl = $('.sel'), marca = $('.marca'), marcaCopia = $('.marca-copia'), editor = $('.editor');

  const haloEl = $('.halo');
  let haloRango = null;
  const posDe = el => ({ c: el.cellIndex - 1, f: el.parentNode.rowIndex - 1 });
  function rect(r) {
    const a = td(r.c1, r.f1), b = td(r.c2, r.f2);
    return { x: a.offsetLeft, y: a.offsetTop, w: b.offsetLeft + b.offsetWidth - a.offsetLeft, h: b.offsetTop + b.offsetHeight - a.offsetTop };
  }
  function colocar(el, r, margen = 0) {
    const q = rect(r);
    el.style.left = (q.x - margen) + 'px'; el.style.top = (q.y - margen) + 'px';
    el.style.width = (q.w + margen) + 'px'; el.style.height = (q.h + margen) + 'px';
  }

  // ------------------------------------------------------------------ pintado
  const BORDE = '#222';
  function pintarCelda(c, f, cel, h) {
    const el = td(c, f), v = resultado(cel), m = cel.fmt;
    const texto = verFormulas && cel.ast ? '=' + motor.aLocal(cel.ast) : mostrar(v, m, reg);
    const alin = m.alinH || (verFormulas && cel.ast ? 'izq' : alineacionNatural(v));
    const derecha = obtener(h, c + 1, f);
    const desb = typeof v === 'string' && !m.ajustar && alin === 'izq' && c + 1 < MAXC && (!derecha || resultado(derecha) === null || resultado(derecha) === '');
    const firma = texto + '\u0001' + JSON.stringify(m) + alin + desb;
    if (el._f === firma) return;
    el._f = firma;
    el.textContent = texto;
    const s = el.style;
    s.cssText = '';
    if (m.negrita) s.fontWeight = '700';
    if (m.cursiva) s.fontStyle = 'italic';
    if (m.subrayado) s.textDecoration = 'underline';
    if (m.tam) s.fontSize = m.tam + 'pt';
    if (m.color) s.color = m.color;
    if (m.relleno) s.backgroundColor = m.relleno;
    s.textAlign = alin === 'der' ? 'right' : alin === 'centro' ? 'center' : 'left';
    if (m.alinV) s.verticalAlign = m.alinV === 'sup' ? 'top' : m.alinV === 'medio' ? 'middle' : 'bottom';
    if (m.ajustar) { s.whiteSpace = 'normal'; s.overflowWrap = 'anywhere'; }
    if (m.bordes) {
      if (m.bordes.includes('b')) s.borderBottomColor = BORDE;
      if (m.bordes.includes('r')) s.borderRightColor = BORDE;
      const sombras = [];
      if (m.bordes.includes('t')) sombras.push('inset 0 1px 0 ' + BORDE);
      if (m.bordes.includes('l')) sombras.push('inset 1px 0 0 ' + BORDE);
      if (sombras.length) s.boxShadow = sombras.join(',');
    }
    el.classList.toggle('desb', desb);
  }

  function pintar() {
    const h = hoja();
    let ancho = ANCHO_FILA;
    cols.forEach((col, c) => { const w = h.anchos[colALetra(c)] || ANCHO; col.style.width = w + 'px'; ancho += w; });
    tabla.style.width = ancho + 'px';
    const vistas = new Set();
    for (const [k, cel] of h.celdas) { const p = parseDir(k); if (!p) continue; pintarCelda(p.c, p.f, cel, h); vistas.add(k); }
    for (const k of pintadas) if (!vistas.has(k)) {
      const p = parseDir(k), el = td(p.c, p.f);
      el.textContent = ''; el.style.cssText = ''; el.classList.remove('desb'); el._f = null;
    }
    pintadas = vistas;
    pintarHojas();
    refrescarSel(false);
  }

  function refrescarSel(desplazar = true, objetivo) {
    const h = hoja(), s = h.sel;
    for (const el of enSel) el.classList.remove('ensel');
    enSel = [];
    if (s.c1 !== s.c2 || s.f1 !== s.f2) {
      for (let f = s.f1; f <= s.f2; f++) for (let c = s.c1; c <= s.c2; c++) {
        if (c === s.ac && f === s.af) continue;
        const el = td(c, f); el.classList.add('ensel'); enSel.push(el);
      }
    }
    thCols.forEach((th, c) => th.classList.toggle('marc', c >= s.c1 && c <= s.c2));
    filas.forEach((tr, f) => tr.cells[0].classList.toggle('marc', f >= s.f1 && f <= s.f2));
    colocar(selEl, s, 1);
    if (haloRango) colocar(haloEl, haloRango, 3);
    if (!editando) {
      let nombre = dir(s.ac, s.af);
      for (const d of libro.nombres.values())
        if (d.hoja === h.nombre && d.c1 === s.c1 && d.f1 === s.f1 && d.c2 === s.c2 && d.f2 === s.f2) nombre = d.nombre;
      if (document.activeElement !== nombres) nombres.value = nombre;
      barra.value = textoEdicion(obtener(h, s.ac, s.af), motor, reg);
      colocarEditor();
    }
    const p = desp.portapapeles();
    if (p && p.hoja === h.nombre) { marcaCopia.hidden = false; colocar(marcaCopia, p.r, 1); } else marcaCopia.hidden = true;
    if (desplazar) { const o = objetivo || { c: s.ac, f: s.af }; verCelda(o.c, o.f); }
    actualizarCinta();
    actualizarEstado();
  }

  function verCelda(c, f) {
    const el = td(c, f), z = zoom;
    const x = el.offsetLeft * z, y = el.offsetTop * z, w = el.offsetWidth * z, alto = el.offsetHeight * z;
    const hx = ANCHO_FILA * z, hy = tabla.tHead.offsetHeight * z;
    if (x - hx < zona.scrollLeft) zona.scrollLeft = x - hx;
    else if (x + w > zona.scrollLeft + zona.clientWidth) zona.scrollLeft = x + w - zona.clientWidth;
    if (y - hy < zona.scrollTop) zona.scrollTop = y - hy;
    else if (y + alto > zona.scrollTop + zona.clientHeight) zona.scrollTop = y + alto - zona.clientHeight;
  }

  function actualizarEstado() {
    const h = hoja(), s = h.sel;
    $('.modo').textContent = !editando ? T.listo : modoEd === 'entrar' ? T.introducir : T.modificar;
    let n = 0, cnt = 0, sum = 0;
    if (s.c1 !== s.c2 || s.f1 !== s.f2) for (const [k, cel] of h.celdas) {
      const p = parseDir(k);
      if (p.c < s.c1 || p.c > s.c2 || p.f < s.f1 || p.f > s.f2) continue;
      const v = resultado(cel);
      if (v === null || v === '') continue;
      cnt++;
      if (typeof v === 'number') { n++; sum += v; }
    }
    const g = x => numGeneral(x, reg);
    $('.resumen').textContent = n > 1 ? `${T.promedio}: ${g(sum / n)}    ${T.recuento}: ${cnt}    ${T.suma}: ${g(sum)}` : cnt > 1 ? `${T.recuento}: ${cnt}` : '';
  }

  // ------------------------------------------------------------------ selección
  const limC = c => Math.max(0, Math.min(MAXC - 1, c)), limF = f => Math.max(0, Math.min(MAXF - 1, f));
  function seleccionar(c1, f1, c2 = c1, f2 = f1, ac = c1, af = f1, objetivo) {
    const r = { c1: Math.min(c1, c2), f1: Math.min(f1, f2), c2: Math.max(c1, c2), f2: Math.max(f1, f2) };
    const s = hoja().sel;
    if (s.c1 === r.c1 && s.f1 === r.f1 && s.c2 === r.c2 && s.f2 === r.f2 && s.ac === ac && s.af === af) return;
    const res = ejecutar({ accion: 'seleccionar', rango: textoRango(r), activa: dir(ac, af) });
    if (res.ok && objetivo) verCelda(objetivo.c, objetivo.f);
  }
  function ir(dc, df) { const s = hoja().sel; seleccionar(limC(s.ac + dc), limF(s.af + df)); }
  const lleno = (c, f) => { const x = obtener(hoja(), c, f); return !!x && (!!x.ast || x.v !== null); };
  const dentro = (c, f) => c >= 0 && f >= 0 && c < MAXC && f < MAXF;
  function salto(c, f, dc, df) {
    let c2 = c + dc, f2 = f + df;
    if (!dentro(c2, f2)) return { c, f };
    if (lleno(c, f) && lleno(c2, f2)) { while (dentro(c2 + dc, f2 + df) && lleno(c2 + dc, f2 + df)) { c2 += dc; f2 += df; } }
    else { while (dentro(c2, f2) && !lleno(c2, f2)) { c2 += dc; f2 += df; } if (!dentro(c2, f2)) { c2 -= dc; f2 -= df; } }
    return { c: c2, f: f2 };
  }
  function mover(dc, df, ctrl, mayus) {
    const s = hoja().sel;
    if (!mayus) { const d = ctrl ? salto(s.ac, s.af, dc, df) : { c: limC(s.ac + dc), f: limF(s.af + df) }; seleccionar(d.c, d.f); return; }
    const ext = { c: s.ac === s.c1 ? s.c2 : s.c1, f: s.af === s.f1 ? s.f2 : s.f1 };
    const d = ctrl ? salto(ext.c, ext.f, dc, df) : { c: limC(ext.c + dc), f: limF(ext.f + df) };
    seleccionar(s.ac, s.af, d.c, d.f, s.ac, s.af, d);
  }

  // ------------------------------------------------------------------ edición
  const entrada = () => document.activeElement === barra ? barra : editor;
  const foco = () => { if (tactil && !editando) editor.inputMode = 'none'; editor.focus({ preventScroll: true }); };
  function colocarEditor() {
    const s = hoja().sel, q = rect({ c1: s.ac, f1: s.af, c2: s.ac, f2: s.af });
    editor.style.left = q.x + 'px'; editor.style.top = q.y + 'px'; editor.style.height = q.h + 'px';
    editor.style.width = Math.max(q.w, editor.value.length * 7.6 + 18) + 'px';
  }
  function iniciarEdicion(texto, reemplazar, enBarra) {
    const h = hoja(), s = h.sel;
    const veto = desp.permite({ accion: 'escribir', celda: dir(s.ac, s.af), texto: '' });
    if (veto) { editor.value = ''; foco(); refrescarSel(false); aviso(veto); return; }
    editando = true; modoEd = reemplazar ? 'entrar' : 'editar'; apuntado = null;
    const t = texto !== null && texto !== undefined ? texto : textoEdicion(obtener(h, s.ac, s.af), motor, reg);
    const yaEscrito = editor.value === t && document.activeElement === editor;
    if (!yaEscrito) editor.value = t;
    barra.value = t;
    editor.classList.remove('oculto');
    colocarEditor();
    raiz.classList.add('editando');
    const inp = enBarra ? barra : editor;
    if (tactil && !enBarra) { editor.inputMode = 'text'; editor.blur(); editor.focus({ preventScroll: true }); editor.setSelectionRange(t.length, t.length); }
    else if (!yaEscrito) { inp.focus(); inp.setSelectionRange(t.length, t.length); }
    prevEd = t; punto = null;
    actualizarEstado();
    actualizarPista();
  }
  function terminarEdicion() {
    editando = false; apuntado = null;
    editor.classList.add('oculto'); editor.value = '';
    marca.hidden = true; pista.hidden = true;
    raiz.classList.remove('editando');
    if (tactil) { editor.blur(); barra.blur(); } // esconde el teclado en pantalla
    foco();
    refrescarSel(false);
  }
  function confirmar(dc = 0, df = 0) {
    if (!editando) return true;
    const s = hoja().sel;
    const res = ejecutar({ accion: 'escribir', celda: dir(s.ac, s.af), texto: entrada().value });
    if (!res.ok && res.codigo === 'restringido') { terminarEdicion(); aviso(res.mensaje); return false; }
    if (!res.ok) { aviso(res.mensaje || (T.errFormula[res.codigo] || T.errFormula.sintaxis).replace('{d}', res.detalle || '')); return false; }
    terminarEdicion();
    if (dc || df) ir(dc, df);
    return true;
  }
  function sincronizar(origen) {
    const otro = origen === editor ? barra : editor;
    otro.value = origen.value;
    apuntado = null; punto = null; marca.hidden = true;
    colocarEditor();
    actualizarPista();
  }
  // Registra lo que se tecleó desde la última vez (para la grabadora de demostraciones).
  function anotar(inp) {
    const v = inp.value;
    if (v.startsWith(prevEd)) { if (v.length > prevEd.length) gesto({ accion: 'escribir', texto: v.slice(prevEd.length) }); }
    else gesto({ accion: 'escribir', texto: v, reemplazar: true });
    prevEd = v;
  }
  const gestoTecla = e => gesto({ accion: 'tecla', tecla: e.key, ...(e.shiftKey ? { mayus: true } : {}), ...((e.ctrlKey || e.metaKey) ? { ctrl: true } : {}) });
  function teclaEdicion(e) {
    e.stopPropagation();
    const inp = e.currentTarget, k = e.key;
    if (k === 'Enter' || k === 'Tab' || k === 'Escape' || k === 'F2' || k === 'F4') gestoTecla(e);
    // Flechas mientras se escribe una fórmula: señalan celdas, como en Excel.
    if (k.startsWith('Arrow') && inp.value[0] === '=' && modoEd === 'entrar' && puedeApuntar()) {
      e.preventDefault();
      gestoTecla(e);
      const dc = k === 'ArrowLeft' ? -1 : k === 'ArrowRight' ? 1 : 0, df = k === 'ArrowUp' ? -1 : k === 'ArrowDown' ? 1 : 0;
      const s = hoja().sel, sigue = punto && apuntado && inp.selectionStart === apuntado.fin;
      const base = sigue ? punto : { c0: s.ac, f0: s.af, c: s.ac, f: s.af };
      const c = limC(base.c + dc), f = limF(base.f + df);
      if (e.shiftKey && sigue) insertarRef(base.c0, base.f0, c, f); else insertarRef(c, f, c, f);
      return;
    }
    if (k === 'Enter' && !e.altKey) { e.preventDefault(); confirmar(0, e.shiftKey ? -1 : 1); }
    else if (k === 'Tab') { e.preventDefault(); if (sugerencias.length) aceptarSugerencia(sugerencias[0]); else confirmar(e.shiftKey ? -1 : 1, 0); }
    else if (k === 'Escape') { e.preventDefault(); terminarEdicion(); }
    else if (k === 'F2') { e.preventDefault(); modoEd = 'editar'; actualizarEstado(); }
    else if (k === 'F4') {
      e.preventDefault();
      const r = alternarRef(inp.value, inp.selectionStart);
      if (r) { inp.value = r.texto; inp.setSelectionRange(r.pos, r.pos); sincronizar(inp); prevEd = inp.value; }
    } else if (k.startsWith('Arrow') && modoEd === 'entrar' && inp === editor && inp.value[0] !== '=') {
      e.preventDefault();
      confirmar(k === 'ArrowLeft' ? -1 : k === 'ArrowRight' ? 1 : 0, k === 'ArrowUp' ? -1 : k === 'ArrowDown' ? 1 : 0);
    }
  }
  // El editor conserva siempre el foco (invisible mientras no se edita): así lo que se
  // teclea, se dicta o llega de un teclado en pantalla empieza a escribirse en la celda.
  editor.addEventListener('keydown', e => editando ? teclaEdicion(e) : teclaListo(e));
  barra.addEventListener('keydown', teclaEdicion);
  editor.addEventListener('input', () => {
    if (editando) { anotar(editor); sincronizar(editor); }
    else if (editor.value) { const t = editor.value; iniciarEdicion(t, true); if (editando) gesto({ accion: 'escribir', texto: t }); }
  });
  barra.addEventListener('input', () => { anotar(barra); sincronizar(barra); });
  for (const inp of [editor, barra]) {
    inp.addEventListener('click', () => { apuntado = null; actualizarPista(); });
    inp.addEventListener('keyup', e => { if (e.key.startsWith('Arrow') || e.key === 'Home' || e.key === 'End') actualizarPista(); });
  }
  barra.addEventListener('focus', () => { if (!editando) iniciarEdicion(null, false, true); });
  $('.bf-aceptar').addEventListener('click', () => confirmar());
  $('.bf-cancelar').addEventListener('click', () => { if (editando) terminarEdicion(); });

  // Señalar celdas con el ratón mientras se escribe una fórmula
  function puedeApuntar() {
    const inp = entrada(), v = inp.value, p = inp.selectionStart;
    if (v[0] !== '=') return false;
    if (apuntado && p === apuntado.fin) return true;
    const ch = v[p - 1];
    return '=+-*/^&(<>:'.includes(ch) || ch === reg.sepArg;
  }
  function insertarRef(c1, f1, c2, f2) {
    const inp = entrada(), v = inp.value;
    const r = { c1: Math.min(c1, c2), f1: Math.min(f1, f2), c2: Math.max(c1, c2), f2: Math.max(f1, f2) };
    const ref = textoRango(r);
    const ini = apuntado && inp.selectionStart === apuntado.fin ? apuntado.ini : inp.selectionStart;
    inp.value = v.slice(0, ini) + ref + v.slice(inp.selectionEnd);
    (inp === editor ? barra : editor).value = inp.value;
    apuntado = { ini, fin: ini + ref.length };
    inp.setSelectionRange(apuntado.fin, apuntado.fin);
    colocarEditor();
    marca.hidden = false; colocar(marca, r, 1);
    punto = { c0: c1, f0: f1, c: c2, f: f2 };
    prevEd = inp.value;
    verCelda(c2, f2);
    actualizarPista(true);
  }

  // Ayuda de funciones: sintaxis del argumento actual y autocompletado
  function contextoFn(v, p) {
    const pila = [];
    let cad = false;
    for (let i = 0; i < p; i++) {
      const ch = v[i];
      if (ch === '"') { cad = !cad; continue; }
      if (cad) continue;
      if (ch === '(') { const m = new RegExp('([' + RE_LETRA + '_][\\w.' + RE_LETRA + ']*)$').exec(v.slice(0, i)); pila.push({ n: m ? m[1].toUpperCase() : '', arg: 0 }); }
      else if (ch === ')') pila.pop();
      else if (ch === reg.sepArg && pila.length) pila[pila.length - 1].arg++;
    }
    return cad ? null : pila[pila.length - 1];
  }
  function actualizarPista(sinLista) {
    sugerencias = [];
    if (!editando) { pista.hidden = true; return; }
    const inp = entrada(), v = inp.value, p = inp.selectionStart;
    if (v[0] !== '=') { pista.hidden = true; return; }
    let html = '';
    if (!sinLista) {
      const m = new RegExp('(?:^|[=+\\-*/^&(<>:' + (reg.sepArg === ';' ? ';' : ',') + ' ])([' + RE_LETRA + '][\\w.' + RE_LETRA + ']*)$').exec(v.slice(0, p));
      if (m && v[p] !== '(') {
        const pre = m[1].toUpperCase();
        sugerencias = Object.values(reg.funciones).map(x => x[0]).filter(n => n.startsWith(pre)).sort().slice(0, 8).map(n => ({ n, largo: m[1].length }));
        html += sugerencias.map((s, i) => `<button class="sug${i ? '' : ' primera'}" data-i="${i}"><i>fx</i> ${esc(s.n)}</button>`).join('');
      }
    }
    const ctx = contextoFn(v, p);
    if (ctx && ctx.n) {
      const info = reg.funciones[motor.dialecto.canonFn(ctx.n)];
      if (info) {
        const partes = info[1] ? info[1].split(';').map(x => x.trim()) : [];
        const i = Math.min(ctx.arg, partes.length - 1);
        html += '<div class="sintaxis">' + esc(info[0]) + '(' + partes.map((x, j) => j === i ? '<b>' + esc(x) + '</b>' : esc(x)).join(reg.sepArg + ' ') + ')</div>';
      }
    }
    if (!html) { pista.hidden = true; return; }
    pista.innerHTML = html;
    pista.hidden = false;
    const q = inp.getBoundingClientRect(), base = raiz.getBoundingClientRect();
    pista.style.left = Math.max(4, q.left - base.left) + 'px';
    pista.style.top = (q.bottom - base.top + 3) + 'px';
  }
  function aceptarSugerencia(s) {
    const inp = entrada(), p = inp.selectionStart, v = inp.value;
    const nuevo = v.slice(0, p - s.largo) + s.n + '(';
    inp.value = nuevo + v.slice(p);
    inp.setSelectionRange(nuevo.length, nuevo.length);
    anotar(inp);
    sincronizar(inp);
  }
  pista.addEventListener('mousedown', e => e.preventDefault());
  pista.addEventListener('click', e => { const b = e.target.closest('.sug'); if (b) aceptarSugerencia(sugerencias[+b.dataset.i]); });

  // ------------------------------------------------------------------ ratón
  lienzo.addEventListener('mousedown', e => { if (e.target !== editor) e.preventDefault(); });
  lienzo.addEventListener('pointerdown', e => {
    const t = e.target;
    if (t === editor || e.button === 1) return;
    if (!editando) foco();
    if (e.pointerType === 'touch') {
      clearTimeout(relojToque);
      if (t.classList.contains('manija')) {
        if (!confirmar()) return;
        const s = hoja().sel, inicio = t.classList.contains('m1');
        arrastre = { tipo: 'manija', c: inicio ? s.c2 : s.c1, f: inicio ? s.f2 : s.f1 };
        e.preventDefault(); return;
      }
      if (!t.classList.contains('asa') && !t.classList.contains('redim')) {
        // El dedo puede querer desplazar la hoja: se espera a ver si fue un toque corto o uno prolongado.
        toque = { x: e.clientX, y: e.clientY, t: Date.now(), el: t };
        relojToque = setTimeout(() => {
          const q = toque; toque = null;
          const celda = q && q.el.closest('td');
          if (!celda || editando) return;
          const p = posDe(celda), s = hoja().sel;
          if (p.c < s.c1 || p.c > s.c2 || p.f < s.f1 || p.f > s.f2) seleccionar(p.c, p.f);
          menuCeldas(q.x, q.y);
        }, 550);
        return;
      }
    }
    if (t.classList.contains('redim')) {
      const c = t.parentNode.cellIndex - 1;
      arrastre = { tipo: 'redim', c, x0: e.clientX, w0: cols[c].offsetWidth || ANCHO };
      e.preventDefault(); return;
    }
    if (t.classList.contains('asa')) {
      if (!confirmar()) return;
      const s = hoja().sel;
      arrastre = { tipo: 'relleno', o: { c1: s.c1, f1: s.f1, c2: s.c2, f2: s.f2 }, d: null };
      e.preventDefault(); return;
    }
    const celda = t.closest('td'), th = t.closest('th');
    if (celda) {
      const { c, f } = posDe(celda);
      if (e.button === 2) { const s = hoja().sel; if (c < s.c1 || c > s.c2 || f < s.f1 || f > s.f2) { if (!confirmar()) return; seleccionar(c, f); } return; }
      if (editando) {
        if (puedeApuntar()) { arrastre = { tipo: 'apuntar', c, f }; insertarRef(c, f, c, f); return; }
        if (!confirmar()) return;
      }
      const s = hoja().sel;
      if (e.shiftKey) { seleccionar(s.ac, s.af, c, f, s.ac, s.af); arrastre = { tipo: 'sel', c: s.ac, f: s.af, mayus: true }; }
      else { seleccionar(c, f); arrastre = { tipo: 'sel', c, f }; }
    } else if (th) {
      if (!confirmar()) return;
      if (th.classList.contains('col')) { const c = th.cellIndex - 1; seleccionar(c, 0, c, MAXF - 1, c, 0); arrastre = { tipo: 'cols', c }; }
      else if (th.classList.contains('fila')) { const f = th.parentNode.rowIndex - 1; seleccionar(0, f, MAXC - 1, f, 0, f); arrastre = { tipo: 'filas', f }; }
      else seleccionar(0, 0, MAXC - 1, MAXF - 1, 0, 0);
    }
  });
  function tocarCelda(c, f) {
    if (editando) {
      if (puedeApuntar()) { insertarRef(c, f, c, f); gesto({ accion: 'clic', en: 'celda:' + dir(c, f) }); return; }
      if (!confirmar()) return;
    }
    seleccionar(c, f);
    gesto({ accion: 'clic', en: 'celda:' + dir(c, f) });
  }
  function toqueCorto(el) {
    if (el.tagName === 'TD') {
      const p = posDe(el), ahora = Date.now();
      const doble = !editando && ultimoToque && ultimoToque.c === p.c && ultimoToque.f === p.f && ahora - ultimoToque.t < 450;
      if (doble) { ultimoToque = null; gesto({ accion: 'dobleClic', en: 'celda:' + dir(p.c, p.f) }); iniciarEdicion(null, false); }
      else { tocarCelda(p.c, p.f); ultimoToque = { c: p.c, f: p.f, t: ahora }; }
    } else if (confirmar()) {
      if (el.classList.contains('col')) { const c = el.cellIndex - 1; seleccionar(c, 0, c, MAXF - 1, c, 0); }
      else if (el.classList.contains('fila')) { const f = el.parentNode.rowIndex - 1; seleccionar(0, f, MAXC - 1, f, 0, f); }
    }
  }
  document.addEventListener('pointercancel', () => { toque = null; clearTimeout(relojToque); arrastre = null; });
  document.addEventListener('pointermove', e => {
    if (toque && (Math.abs(e.clientX - toque.x) > 10 || Math.abs(e.clientY - toque.y) > 10)) { toque = null; clearTimeout(relojToque); }
    if (!arrastre) return;
    if (arrastre.tipo === 'redim') {
      cols[arrastre.c].style.width = Math.max(20, arrastre.w0 + (e.clientX - arrastre.x0) / zoom) + 'px';
      return;
    }
    const bajo = document.elementFromPoint(e.clientX, e.clientY);
    const celda = bajo && bajo.closest && bajo.closest('.hoja td, .hoja th');
    if (!celda || celda.classList.contains('esq')) return;
    const esTd = celda.tagName === 'TD';
    const c = celda.classList.contains('fila') ? 0 : celda.cellIndex - 1;
    const f = celda.classList.contains('col') ? 0 : celda.parentNode.rowIndex - 1;
    if (esTd && (arrastre.tipo === 'sel' || arrastre.tipo === 'apuntar')) { arrastre.c2 = c; arrastre.f2 = f; }
    if (arrastre.tipo === 'sel' && esTd) seleccionar(arrastre.c, arrastre.f, c, f, arrastre.c, arrastre.f, { c, f });
    else if (arrastre.tipo === 'manija' && esTd) seleccionar(arrastre.c, arrastre.f, c, f, arrastre.c, arrastre.f, { c, f });
    else if (arrastre.tipo === 'cols') seleccionar(arrastre.c, 0, c, MAXF - 1, arrastre.c, 0);
    else if (arrastre.tipo === 'filas') seleccionar(0, arrastre.f, MAXC - 1, f, 0, arrastre.f);
    else if (arrastre.tipo === 'apuntar' && esTd) insertarRef(arrastre.c, arrastre.f, c, f);
    else if (arrastre.tipo === 'relleno' && esTd) {
      const o = arrastre.o, dv = f - o.f2, dh = c - o.c2;
      arrastre.d = dv > 0 && dv >= dh ? { ...o, f2: f } : dh > 0 ? { ...o, c2: c } : null;
      marca.hidden = !arrastre.d;
      if (arrastre.d) colocar(marca, arrastre.d, 1);
    }
  });
  document.addEventListener('pointerup', () => {
    if (toque) {
      clearTimeout(relojToque);
      const q = toque; toque = null;
      const el = q.el.closest && q.el.closest('.hoja td, .hoja th');
      if (el && Date.now() - q.t < 500) toqueCorto(el);
    }
    const a = arrastre;
    arrastre = null;
    if (!a) return;
    if (a.tipo === 'redim') ejecutar({ accion: 'anchoColumna', col: colALetra(a.c), ancho: cols[a.c].offsetWidth });
    else if (a.tipo === 'relleno') {
      marca.hidden = true;
      if (a.d) {
        ejecutar({ accion: 'rellenar', origen: textoRango(a.o), destino: textoRango(a.d) });
        gesto({ accion: 'arrastrar', desde: 'ui:controlador-relleno', hasta: 'celda:' + dir(a.d.c2, a.d.f2) });
      }
    } else if (a.tipo === 'sel' || a.tipo === 'apuntar') {
      const movio = a.c2 !== undefined && (a.c2 !== a.c || a.f2 !== a.f);
      if (a.mayus) gesto({ accion: 'seleccionar', rango: textoRango(hoja().sel) });
      else if (movio) gesto({ accion: 'arrastrar', desde: 'celda:' + dir(a.c, a.f), hasta: 'celda:' + dir(a.c2, a.f2) });
      else gesto({ accion: 'clic', en: 'celda:' + dir(a.c, a.f) });
    } else if (a.tipo === 'cols' || a.tipo === 'filas' || a.tipo === 'manija') gesto({ accion: 'seleccionar', rango: textoRango(hoja().sel) });
  });
  lienzo.addEventListener('dblclick', e => {
    const celda = e.target.closest('td');
    if (celda && !editando) { const p = posDe(celda); gesto({ accion: 'dobleClic', en: 'celda:' + dir(p.c, p.f) }); iniciarEdicion(null, false); }
  });
  function menuCeldas(x, y) {
    const M = T.menu, s = hoja().sel;
    const items = [
      [M.cortar, () => copiar(true)], [M.copiar, () => copiar(false)],
      [M.pegar, () => pegar(false)], [M.pegarValores, () => pegar(true)], '-',
      [M.borrarContenido, () => ejecutar({ accion: 'borrar' })]
    ];
    // En pantalla táctil, rellenar desde el menú es más fácil que arrastrar el cuadrito.
    if (tactil && s.f2 > s.f1) items.push('-', [M.rellenarAbajo, () => cmd('inicio.rellenar-abajo')]);
    if (tactil && s.c2 > s.c1) items.push([M.rellenarDerecha, () => cmd('inicio.rellenar-derecha')]);
    abrirMenu(null, items, { x, y });
  }
  lienzo.addEventListener('contextmenu', e => {
    e.preventDefault();
    if (!e.target.closest('td') || editando) return;
    menuCeldas(e.clientX, e.clientY);
  });

  // ------------------------------------------------------------------ teclado
  function teclaListo(e) {
    const k = e.key, ctrl = e.ctrlKey || e.metaKey, s = hoja().sel;
    const hecho = () => e.preventDefault();
    if (k.startsWith('Arrow') || ['Enter', 'Tab', 'Home', 'End', 'Delete', 'Backspace', 'F2', 'PageDown', 'PageUp'].includes(k)) gestoTecla(e);
    if (ctrl && !e.altKey) {
      const letra = k.toLowerCase();
      if (letra === 'c' || letra === 'x' || letra === 'v') return; // los eventos copy/cut/paste se encargan
      if (k.startsWith('Arrow')) { hecho(); mover(k === 'ArrowLeft' ? -1 : k === 'ArrowRight' ? 1 : 0, k === 'ArrowUp' ? -1 : k === 'ArrowDown' ? 1 : 0, true, e.shiftKey); return; }
      if (k === 'Home') { hecho(); seleccionar(0, 0); return; }
      if (k === 'End') {
        hecho();
        let c = 0, f = 0;
        for (const key of hoja().celdas.keys()) { const p = parseDir(key); if (lleno(p.c, p.f)) { c = Math.max(c, p.c); f = Math.max(f, p.f); } }
        seleccionar(c, f); return;
      }
      if (k === ' ') { hecho(); seleccionar(s.c1, 0, s.c2, MAXF - 1, s.ac, s.af); return; }
      if (k === '`' || k === 'º') { hecho(); cmd('formulas.mostrar-formulas'); return; }
      if (e.shiftKey && letra === 'l') { hecho(); cmd('datos.filtro'); return; }
      if (k === '1') { hecho(); cmd('inicio.formato'); return; }
      const id = reg.atajos[letra];
      if (id) { hecho(); if (id === 'sel.todo') seleccionar(0, 0, MAXC - 1, MAXF - 1, s.ac, s.af); else cmd(id); }
      return;
    }
    switch (k) {
      case 'ArrowLeft': hecho(); mover(-1, 0, false, e.shiftKey); return;
      case 'ArrowRight': hecho(); mover(1, 0, false, e.shiftKey); return;
      case 'ArrowUp': hecho(); mover(0, -1, false, e.shiftKey); return;
      case 'ArrowDown': hecho(); mover(0, 1, false, e.shiftKey); return;
      case 'Tab': hecho(); ir(e.shiftKey ? -1 : 1, 0); return;
      case 'Enter': hecho(); ir(0, e.shiftKey ? -1 : 1); return;
      case 'Home': hecho(); seleccionar(0, s.af); return;
      case 'PageDown': hecho(); ir(0, 20); return;
      case 'PageUp': hecho(); ir(0, -20); return;
      case 'Delete': case 'Backspace': hecho(); ejecutar({ accion: 'borrar' }); return;
      case 'F2': hecho(); iniciarEdicion(null, false); return;
      case 'F3': if (e.shiftKey) { hecho(); cmd('formulas.insertar-funcion'); } return;
      case 'Escape': if (desp.portapapeles()) { marcaCopia.hidden = true; } return;
      case ' ': if (e.shiftKey) { hecho(); seleccionar(0, s.f1, MAXC - 1, s.f2, s.ac, s.af); return; } break;
    }
    if (e.altKey && e.shiftKey && (k === '0' || k === '=')) { hecho(); cmd('inicio.autosuma'); return; }
    // Los caracteres imprimibles llegan por el evento "input" del editor y empiezan la edición.
  }

  // Portapapeles del sistema
  lienzo.addEventListener('copy', e => { if (editando) return; const r = ejecutar({ accion: 'copiar' }); e.clipboardData.setData('text/plain', r.tsv); e.preventDefault(); refrescarSel(false); });
  lienzo.addEventListener('cut', e => { if (editando) return; const r = ejecutar({ accion: 'copiar', corte: true }); e.clipboardData.setData('text/plain', r.tsv); e.preventDefault(); refrescarSel(false); });
  lienzo.addEventListener('paste', e => { if (editando) return; e.preventDefault(); ejecutar({ accion: 'pegar', texto: e.clipboardData.getData('text/plain') }); });
  function copiar(corte) {
    const r = ejecutar({ accion: 'copiar', corte });
    try { navigator.clipboard.writeText(r.tsv).catch(() => {}); } catch (_) { /* sin permiso: queda el portapapeles interno */ }
    refrescarSel(false);
  }
  function pegar(soloValores) {
    const r = ejecutar({ accion: 'pegar', soloValores });
    if (!r.ok) aviso(T[r.codigo] || T.sinPortapapeles);
  }

  // Teclas rápidas (pantalla táctil): símbolos de fórmula que cuestan en el teclado del teléfono.
  $('.teclas').addEventListener('mousedown', e => e.preventDefault());
  $('.teclas').addEventListener('click', e => {
    const b = e.target.closest('[data-k]');
    if (!b || !editando) return;
    if (b.dataset.k === '$') simular.tecla('F4'); else simular.teclear(b.dataset.k);
  });

  // ------------------------------------------------------------------ avisos y menús
  function aviso(texto) {
    avisoEl.textContent = texto; avisoEl.hidden = false;
    clearTimeout(temporizadorAviso);
    temporizadorAviso = setTimeout(() => { avisoEl.hidden = true; }, 5000);
  }
  avisoEl.addEventListener('click', () => { avisoEl.hidden = true; });

  function cerrarMenu() { if (menuAbierto) { menuAbierto.remove(); menuAbierto = null; } }
  function abrirMenu(ancla, items, pos, clase = '') {
    cerrarMenu();
    const m = document.createElement('div');
    m.className = 'menu ' + clase;
    for (const it of items) {
      if (it === '-') { m.appendChild(document.createElement('hr')); continue; }
      const b = document.createElement('button');
      if (it[2]) { b.className = 'muestra'; b.style.background = it[2]; b.title = it[0]; } else b.textContent = it[0];
      b.dataset.opcion = it[0];
      b.addEventListener('click', () => { cerrarMenu(); gesto({ accion: 'elegir', opcion: it[0] }); it[1](); });
      m.appendChild(b);
    }
    m.addEventListener('mousedown', e => e.preventDefault());
    raiz.appendChild(m);
    const base = raiz.getBoundingClientRect();
    let x, y;
    if (ancla) { const q = ancla.getBoundingClientRect(); x = q.left; y = q.bottom + 2; } else { x = pos.x; y = pos.y; }
    x = Math.min(x, base.right - m.offsetWidth - 4); y = Math.min(y, base.bottom - m.offsetHeight - 4);
    m.style.left = (x - base.left) + 'px'; m.style.top = (y - base.top) + 'px';
    menuAbierto = m;
  }
  document.addEventListener('pointerdown', e => { if (menuAbierto && !menuAbierto.contains(e.target)) cerrarMenu(); }, true);
  document.addEventListener('keydown', e => { if (e.key === 'Escape') cerrarMenu(); });

  function paleta(ancla, clave, textoNinguno) {
    const items = [[textoNinguno, () => fmt({ [clave]: null })], '-'];
    for (const color of PALETA) items.push([color, () => fmt({ [clave]: color }), color]);
    abrirMenu(ancla, items, null, 'paleta');
  }

  // ------------------------------------------------------------------ cinta
  const fmt = f => ejecutar({ accion: 'formato', fmt: f });
  const fmtActivo = () => { const s = hoja().sel, x = obtener(hoja(), s.ac, s.af); return x ? x.fmt : {}; };
  const alternar = k => fmt({ [k]: !fmtActivo()[k] });
  const alinear = (k, v) => fmt({ [k]: fmtActivo()[k] === v ? null : v });
  function autosuma(fn) {
    if (editando) return;
    const p = desp.proponerAutosuma(fn);
    iniciarEdicion(p.texto, true);
    const fin = p.texto.length - 1, ini = fin - p.rango.length;
    apuntado = { ini, fin };
    editor.setSelectionRange(fin, fin);
    if (p.rango) { marca.hidden = false; colocar(marca, parseRango(p.rango), 1); }
    actualizarPista(true);
  }
  function rellenarSel(vertical) {
    const s = hoja().sel;
    if (vertical ? s.f1 === s.f2 : s.c1 === s.c2) return;
    const o = vertical ? { ...s, f2: s.f1 } : { ...s, c2: s.c1 };
    ejecutar({ accion: 'rellenar', origen: textoRango(o), destino: textoRango(s) });
  }
  const M = T.menu;
  const ACCIONES = {
    'rapido.deshacer': () => ejecutar({ accion: 'deshacer' }),
    'rapido.rehacer': () => ejecutar({ accion: 'rehacer' }),
    'inicio.pegar': () => pegar(false),
    'inicio.cortar': () => copiar(true),
    'inicio.copiar': () => copiar(false),
    'inicio.negrita': () => alternar('negrita'),
    'inicio.cursiva': () => alternar('cursiva'),
    'inicio.subrayado': () => alternar('subrayado'),
    'inicio.bordes': el => abrirMenu(el, [
      [M.bordesTodos, () => ejecutar({ accion: 'bordes', tipo: 'todos' })],
      [M.bordesExterior, () => ejecutar({ accion: 'bordes', tipo: 'exterior' })],
      [M.bordeInferior, () => ejecutar({ accion: 'bordes', tipo: 'inferior' })], '-',
      [M.sinBorde, () => ejecutar({ accion: 'bordes', tipo: 'ninguno' })]]),
    'inicio.relleno': el => paleta(el, 'relleno', M.sinRelleno),
    'inicio.color-fuente': el => paleta(el, 'color', M.automatico),
    'inicio.alin-izq': () => alinear('alinH', 'izq'),
    'inicio.alin-centro': () => alinear('alinH', 'centro'),
    'inicio.alin-der': () => alinear('alinH', 'der'),
    'inicio.alin-sup': () => alinear('alinV', 'sup'),
    'inicio.alin-medio': () => alinear('alinV', 'medio'),
    'inicio.alin-inf': () => alinear('alinV', 'inf'),
    'inicio.ajustar': () => alternar('ajustar'),
    'inicio.moneda': () => fmt({ num: 'moneda', dec: 2, miles: null }),
    'inicio.porcentaje': () => fmt({ num: 'porcentaje', dec: 0, miles: null }),
    'inicio.millares': () => fmt({ num: 'numero', dec: 2, miles: true }),
    'inicio.mas-decimales': () => ejecutar({ accion: 'decimales', delta: 1 }),
    'inicio.menos-decimales': () => ejecutar({ accion: 'decimales', delta: -1 }),
    'inicio.autosuma': () => autosuma('SUM'),
    'inicio.autosuma-mas': el => abrirMenu(el, ['SUM', 'AVERAGE', 'COUNT', 'MAX', 'MIN'].map(f => [reg.funciones[f][0], () => autosuma(f)])),
    'inicio.rellenar': el => abrirMenu(el, [[M.abajo, () => rellenarSel(true)], [M.derecha, () => rellenarSel(false)]]),
    'inicio.rellenar-abajo': () => rellenarSel(true),
    'inicio.rellenar-derecha': () => rellenarSel(false),
    'inicio.borrar': el => abrirMenu(el, [
      [M.borrarTodo, () => ejecutar({ accion: 'borrar', que: 'todo' })],
      [M.borrarFormatos, () => ejecutar({ accion: 'borrar', que: 'formatos' })],
      [M.borrarContenido, () => ejecutar({ accion: 'borrar' })]]),
    'formulas.insertar-funcion': () => dialogoFuncion('todas'),
    'formulas.autosuma': () => autosuma('SUM'),
    'formulas.logicas': () => dialogoFuncion('log'),
    'formulas.texto': () => dialogoFuncion('tex'),
    'formulas.fecha': () => dialogoFuncion('fec'),
    'formulas.busqueda': () => dialogoFuncion('bus'),
    'formulas.matematicas': () => dialogoFuncion('mat'),
    'formulas.asignar-nombre': () => { nombres.focus(); nombres.select(); aviso(T.asignarNombre); },
    'formulas.mostrar-formulas': () => { verFormulas = !verFormulas; raiz.classList.toggle('ver-formulas', verFormulas); pintar(); },
    'vista.cuadricula': () => { raiz.classList.toggle('sin-cuadricula'); actualizarCinta(); },
    'vista.encabezados': () => { raiz.classList.toggle('sin-encabezados'); refrescarSel(false); },
    'vista.barra-formulas': () => { raiz.classList.toggle('sin-barra'); actualizarCinta(); }
  };
  const EN_EDICION = new Set(['formulas.insertar-funcion', 'formulas.logicas', 'formulas.texto', 'formulas.fecha', 'formulas.busqueda', 'formulas.matematicas']);

  function cmd(id, el) {
    const boton = el || $(`[data-cmd="${id}"]`);
    const tipo = boton ? boton.dataset.tipo : (ACCIONES[id] ? 'F' : 'P');
    const permiso = ejecutar({ accion: 'comando', id, tipo });
    if (!permiso.ok) { if (permiso.mensaje) aviso(permiso.mensaje); return; }
    if (tipo === 'D') { aviso(T.decorativo); return; }
    if (tipo === 'P' || !ACCIONES[id]) { aviso(T.pendiente); return; }
    if (editando && !EN_EDICION.has(id) && !confirmar()) return;
    if (!EN_EDICION.has(id)) gesto({ accion: 'comando', id }); // el diálogo de funciones se graba como texto escrito
    ACCIONES[id](boton);
    if (editando) prevEd = entrada().value;
  }

  function construirCinta() {
    const nav = $('.pestanas'), cinta = $('.cinta');
    const rot = id => T.cinta[id] || id;
    const boton = (pest, b) => {
      const [id, tipo, ic, forma] = b, cmdId = pest + '.' + id, r = esc(rot(cmdId));
      const base = `data-cmd="${cmdId}" data-tipo="${tipo}" title="${r}" tabindex="-1"`;
      if (forma === 'fuente') return `<button class="ctl ctl-fuente" ${base}>Aptos Narrow <span class="tri">▾</span></button>`;
      if (forma === 'tamano') return `<select class="ctl ctl-tam" data-ctl="tam" title="${r}" tabindex="-1">${TAMANOS.map(t => `<option>${t}</option>`).join('')}</select>`;
      if (forma === 'formatoNumero') return `<select class="ctl ctl-num" data-ctl="num" title="${r}" tabindex="-1">${FORMATOS_NUMERO.map(f => `<option value="${f}">${esc(T.fmtNum[f])}</option>`).join('')}</select>`;
      if (forma === 'letra') return `<button class="bt p letra l-${id}" ${base}>${esc(reg.letras[id])}</button>`;
      return `<button class="bt ${forma}" ${base}>${icono(ic)}${forma === 'p' ? '' : `<span>${r}</span>`}</button>`;
    };
    let htmlNav = '', htmlCinta = '';
    for (const pest of CINTA) {
      htmlNav += `<button class="pest${pest.id === 'archivo' ? ' archivo' : ''}" role="tab" data-pest="${pest.id}" tabindex="-1">${esc(T.pest[pest.id])}</button>`;
      htmlCinta += `<div class="panel" data-pest="${pest.id}" hidden>`;
      for (const g of pest.grupos) {
        let cuerpo = '';
        if (g.filas) {
          let fila = [];
          const renglones = [];
          for (const b of g.b) { if (b[0] === 'salto') { renglones.push(fila); fila = []; } else fila.push(boton(pest.id, b)); }
          renglones.push(fila);
          cuerpo = '<div class="renglones">' + renglones.map(r => `<div class="renglon">${r.join('')}</div>`).join('') + '</div>';
        } else {
          let pila = [];
          const soltar = () => { if (pila.length) { cuerpo += `<div class="pila">${pila.join('')}</div>`; pila = []; } };
          for (const b of g.b) { if (b[3] === 'g') { soltar(); cuerpo += boton(pest.id, b); } else pila.push(boton(pest.id, b)); }
          soltar();
        }
        htmlCinta += `<div class="grupo"><div class="botones">${cuerpo}</div><div class="rotulo">${esc(T.grupo[g.id] || '')}</div></div>`;
      }
      htmlCinta += '</div>';
    }
    nav.innerHTML = htmlNav; cinta.innerHTML = htmlCinta;
    nav.addEventListener('click', e => {
      const b = e.target.closest('.pest');
      if (!b) return;
      if (b.dataset.pest === 'archivo') { aviso(T.pendiente); return; }
      // En celular la cinta está plegada: tocar una pestaña la abre y volver a tocarla la cierra.
      const abierta = raiz.classList.contains('cinta-abierta');
      raiz.classList.toggle('cinta-abierta', !(abierta && pestActiva === b.dataset.pest));
      pestActiva = b.dataset.pest; mostrarPestana();
      gesto({ accion: 'clic', en: 'pestaña:' + pestActiva });
    });
    for (const zonaBt of [nav, cinta, $('.titulo'), $('.barra-formulas')])
      zonaBt.addEventListener('mousedown', e => { if (!e.target.closest('select, input')) e.preventDefault(); });
    raiz.addEventListener('click', e => {
      const b = e.target.closest('[data-cmd]');
      if (b && !b.disabled) cmd(b.dataset.cmd, b);
    });
    cinta.addEventListener('change', e => {
      const ctl = e.target.dataset.ctl;
      if (!ctl) return;
      if (editando && !confirmar()) return;
      gesto({ accion: 'elegir', en: 'ctl:' + ctl, opcion: e.target.value });
      if (ctl === 'tam') fmt({ tam: +e.target.value === 11 ? null : +e.target.value });
      else {
        const v = e.target.value;
        fmt(v === 'general' ? { num: null, dec: null, miles: null }
          : v === 'numero' ? { num: v, dec: 2, miles: null }
          : v === 'moneda' ? { num: v, dec: 2, miles: null }
          : v === 'porcentaje' ? { num: v, dec: 2, miles: null }
          : { num: v, dec: null, miles: null });
      }
      foco();
    });
    mostrarPestana();
  }
  function mostrarPestana() {
    for (const b of raiz.querySelectorAll('.pest')) b.classList.toggle('activa', b.dataset.pest === pestActiva);
    for (const p of raiz.querySelectorAll('.panel')) p.hidden = p.dataset.pest !== pestActiva;
  }
  function actualizarCinta() {
    const m = fmtActivo();
    const on = (id, v) => { const b = $(`[data-cmd="${id}"]`); if (b) b.classList.toggle('on', !!v); };
    on('inicio.negrita', m.negrita); on('inicio.cursiva', m.cursiva); on('inicio.subrayado', m.subrayado);
    on('inicio.ajustar', m.ajustar);
    on('inicio.alin-izq', m.alinH === 'izq'); on('inicio.alin-centro', m.alinH === 'centro'); on('inicio.alin-der', m.alinH === 'der');
    on('inicio.alin-sup', m.alinV === 'sup'); on('inicio.alin-medio', m.alinV === 'medio'); on('inicio.alin-inf', m.alinV === 'inf');
    on('formulas.mostrar-formulas', verFormulas);
    on('vista.cuadricula', !raiz.classList.contains('sin-cuadricula'));
    on('vista.encabezados', !raiz.classList.contains('sin-encabezados'));
    on('vista.barra-formulas', !raiz.classList.contains('sin-barra'));
    const tam = $('[data-ctl="tam"]'), num = $('[data-ctl="num"]');
    if (tam) tam.value = m.tam || 11;
    if (num) num.value = m.num || 'general';
    $('[data-cmd="rapido.deshacer"]').disabled = !desp.puedeDeshacer();
    $('[data-cmd="rapido.rehacer"]').disabled = !desp.puedeRehacer();
  }

  // ------------------------------------------------------------------ diálogo Insertar función
  const dlg = $('.dlg-funcion');
  function dialogoFuncion(categoria) {
    const D = T.dlgFuncion;
    dlg.innerHTML = `
      <form method="dialog">
        <h2>${esc(D.titulo)}</h2>
        <label>${esc(D.buscar)}<input class="df-buscar" autocomplete="off" spellcheck="false"></label>
        <label>${esc(D.categoria)}<select class="df-cat">${Object.entries(T.cat).map(([k, v]) => `<option value="${k}">${esc(v)}</option>`).join('')}</select></label>
        <label>${esc(D.seleccionar)}<select class="df-lista" size="9"></select></label>
        <div class="df-desc"></div>
        <div class="df-botones"><button value="ok" class="primario">${esc(T.aceptar)}</button><button value="no">${esc(T.cancelar)}</button></div>
      </form>`;
    const buscar = $('.df-buscar', dlg), cat = $('.df-cat', dlg), lista = $('.df-lista', dlg), desc = $('.df-desc', dlg);
    cat.value = categoria;
    const describir = () => {
      const info = reg.funciones[lista.value];
      desc.innerHTML = info ? `<b>${esc(info[0])}(${esc(info[1])})</b><br>${esc(info[2])}` : '';
    };
    const llenar = () => {
      const q = buscar.value.trim().toUpperCase();
      const ops = Object.entries(reg.funciones)
        .filter(([k, v]) => FUNCIONES[k] && (cat.value === 'todas' || FUNCIONES[k][3] === cat.value) && (!q || v[0].includes(q) || v[2].toUpperCase().includes(q)))
        .sort((a, b) => a[1][0].localeCompare(b[1][0]));
      lista.innerHTML = ops.map(([k, v]) => `<option value="${k}">${esc(v[0])}</option>`).join('');
      if (ops.length) lista.selectedIndex = 0;
      describir();
    };
    buscar.addEventListener('input', llenar);
    cat.addEventListener('change', llenar);
    lista.addEventListener('change', describir);
    lista.addEventListener('dblclick', () => dlg.close('ok'));
    llenar();
    dlg.returnValue = '';
    dlg.onclose = () => {
      const elegida = dlg.returnValue === 'ok' && reg.funciones[lista.value];
      if (!elegida) { foco(); return; }
      const texto = elegida[0] + '(';
      gesto({ accion: 'escribir', texto: (editando ? '' : '=') + texto });
      if (!editando) iniciarEdicion('=' + texto, true);
      else {
        editor.focus();
        const p = editor.selectionStart, v = editor.value;
        editor.value = v.slice(0, p) + texto + v.slice(p);
        editor.setSelectionRange(p + texto.length, p + texto.length);
        sincronizar(editor);
        prevEd = editor.value;
      }
    };
    dlg.showModal();
    buscar.focus();
  }

  // ------------------------------------------------------------------ hojas, nombres, zoom
  const hojasEl = $('.hojas');
  function pintarHojas() {
    hojasEl.innerHTML = libro.hojas.map((h, i) => `<button class="hoja-pest${i === libro.activa ? ' activa' : ''}" data-i="${i}" tabindex="-1">${esc(h.nombre)}</button>`).join('') +
      `<button class="hoja-nueva" title="${esc(T.nuevaHoja)}" tabindex="-1">${icono('mas')}</button>`;
  }
  function renombrarHoja(i) {
    const b = hojasEl.querySelector(`[data-i="${i}"]`);
    if (!b) return;
    const inp = document.createElement('input');
    inp.className = 'hoja-edit'; inp.value = libro.hojas[i].nombre; inp.maxLength = 31;
    b.replaceWith(inp); inp.focus(); inp.select();
    let listo = false;
    const fin = guardar => {
      if (listo) return;
      listo = true;
      if (guardar && inp.value.trim() !== libro.hojas[i].nombre) {
        const r = ejecutar({ accion: 'hoja.renombrar', indice: i, nombre: inp.value });
        if (!r.ok) aviso(T.hojaInvalida);
      }
      pintarHojas();
      foco();
    };
    inp.addEventListener('keydown', e => { e.stopPropagation(); if (e.key === 'Enter') fin(true); else if (e.key === 'Escape') fin(false); });
    inp.addEventListener('blur', () => fin(true));
  }
  hojasEl.addEventListener('mousedown', e => { if (!e.target.closest('input')) e.preventDefault(); });
  hojasEl.addEventListener('click', e => {
    if (e.target.closest('.hoja-nueva')) { if (confirmar()) ejecutar({ accion: 'hoja.agregar' }); return; }
    const b = e.target.closest('.hoja-pest');
    if (b && confirmar()) { ejecutar({ accion: 'hoja.activar', indice: +b.dataset.i }); gesto({ accion: 'clic', en: 'hoja:' + hoja().nombre }); }
  });
  hojasEl.addEventListener('dblclick', e => { const b = e.target.closest('.hoja-pest'); if (b) renombrarHoja(+b.dataset.i); });
  hojasEl.addEventListener('contextmenu', e => {
    const b = e.target.closest('.hoja-pest');
    if (!b) return;
    e.preventDefault();
    const i = +b.dataset.i;
    abrirMenu(null, [
      [M.renombrar, () => renombrarHoja(i)],
      [M.eliminar, () => { const r = ejecutar({ accion: 'hoja.eliminar', indice: i }); if (!r.ok) aviso(T.ultimaHoja); }]
    ], { x: e.clientX, y: e.clientY - 70 });
  });

  nombres.addEventListener('keydown', e => {
    e.stopPropagation();
    if (e.key === 'Escape') { foco(); refrescarSel(false); return; }
    if (e.key !== 'Enter') return;
    e.preventDefault();
    const v = nombres.value.trim(), r = parseRango(v), definido = libro.nombres.get(v.toLowerCase());
    foco();
    if (r) seleccionar(r.c1, r.f1, r.c2, r.f2);
    else if (definido) {
      const i = libro.hojas.findIndex(h => h.nombre === definido.hoja);
      if (i >= 0 && i !== libro.activa) ejecutar({ accion: 'hoja.activar', indice: i });
      seleccionar(definido.c1, definido.f1, definido.c2, definido.f2);
    } else if (v) {
      const res = ejecutar({ accion: 'nombre.definir', nombre: v });
      if (!res.ok) aviso(T.nombreInvalido);
    }
    refrescarSel(false);
  });
  nombres.addEventListener('focus', () => nombres.select());

  const zoomEl = $('.zoom');
  zoomEl.addEventListener('input', () => {
    zoom = +zoomEl.value / 100;
    lienzo.style.zoom = zoom;
    $('.zoom-txt').textContent = zoomEl.value + '%';
  });
  zoomEl.addEventListener('change', () => foco());

  // ------------------------------------------------------------------ arranque
  desp.alCambiar(acc => {
    if (acc.accion === 'comando') return;
    if (acc.accion === 'seleccionar') refrescarSel(true);
    else if (acc.accion === 'copiar') refrescarSel(false);
    else { pintar(); if (acc.accion !== 'anchoColumna') { const s = hoja().sel; verCelda(s.ac, s.af); } }
  });
  // ------------------------------------------------------------------ apoyo a las lecciones
  // Ilumina un destino: "celda:D2", "rango:B2:C6", "cmd:inicio.autosuma" o "ui:barra-formulas".
  function resaltar(objetivo) {
    haloRango = null; haloEl.hidden = true;
    for (const el of raiz.querySelectorAll('.halo-bt')) el.classList.remove('halo-bt');
    if (!objetivo) return;
    const i = objetivo.indexOf(':'), tipo = objetivo.slice(0, i), valor = objetivo.slice(i + 1);
    if (tipo === 'celda' || tipo === 'rango') {
      haloRango = parseRango(valor);
      if (haloRango) { haloEl.hidden = false; colocar(haloEl, haloRango, 3); }
    } else if (tipo === 'cmd') {
      const b = $(`[data-cmd="${valor}"]`);
      if (b) {
        b.classList.add('halo-bt');
        const panel = b.closest('.panel');
        if (panel && (panel.dataset.pest !== pestActiva || (esMovil() && !raiz.classList.contains('cinta-abierta')))) { const p = $(`.pest[data-pest="${panel.dataset.pest}"]`); if (p) p.classList.add('halo-bt'); }
      }
    } else if (tipo === 'ui') {
      const el = valor === 'barra-formulas' ? barra : valor === 'cuadro-nombres' ? nombres : null;
      if (el) el.classList.add('halo-bt');
    }
  }
  // Oculta pestañas y atenúa los botones que la lección no permite. Con null se quita todo.
  function restringir(conf) {
    for (const p of raiz.querySelectorAll('.pest'))
      p.hidden = !!(conf && conf.pestanas && p.dataset.pest !== 'archivo' && !conf.pestanas.includes(p.dataset.pest));
    for (const b of raiz.querySelectorAll('.cinta [data-cmd][data-tipo="F"]'))
      b.classList.toggle('bloq', !!(conf && conf.permite && !conf.permite(b.dataset.cmd)));
    const visible = $(`.pest[data-pest="${pestActiva}"]`);
    if (visible && visible.hidden) { const primera = $('.pest:not([hidden]):not(.archivo)'); if (primera) pestActiva = primera.dataset.pest; }
    mostrarPestana();
  }

  // ------------------------------------------------------------------ apoyo a las demostraciones
  // El reproductor de "Mostrar cómo" usa estas funciones para actuar como lo haría una persona.
  function rectDe(destino) {
    const i = destino.indexOf(':'), tipo = destino.slice(0, i), v = destino.slice(i + 1);
    let el = null;
    if (tipo === 'celda' || tipo === 'rango') {
      const r = parseRango(v);
      if (!r) return null;
      verCelda(r.c2, r.f2); verCelda(r.c1, r.f1);
      const a = td(r.c1, r.f1).getBoundingClientRect(), b = td(r.c2, r.f2).getBoundingClientRect();
      return { left: a.left, top: a.top, width: b.right - a.left, height: b.bottom - a.top };
    }
    if (tipo === 'cmd') {
      el = $(`[data-cmd="${v}"]`);
      const panel = el && el.closest('.panel');
      if (panel && panel.dataset.pest !== pestActiva) { pestActiva = panel.dataset.pest; mostrarPestana(); }
      if (el && esMovil()) raiz.classList.add('cinta-abierta');
      if (el && el.scrollIntoView) el.scrollIntoView({ block: 'nearest', inline: 'nearest' });
    } else if (tipo === 'pestaña' || tipo === 'pestana') el = $(`.pest[data-pest="${v}"]`);
    else if (tipo === 'hoja') el = [...hojasEl.querySelectorAll('.hoja-pest')].find(b => b.textContent === v);
    else if (tipo === 'opcion') el = menuAbierto && [...menuAbierto.querySelectorAll('button')].find(b => b.dataset.opcion === v);
    else if (tipo === 'ctl') el = $(`[data-ctl="${v}"]`);
    else if (tipo === 'ui') el = v === 'barra-formulas' ? barra : v === 'cuadro-nombres' ? nombres : v === 'controlador-relleno' ? $('.asa') : v === 'barra-estado' ? $('.estado') : null;
    return el ? el.getBoundingClientRect() : null;
  }
  const simular = {
    rectDe,
    clic(destino) {
      const i = destino.indexOf(':'), tipo = destino.slice(0, i), v = destino.slice(i + 1);
      if (tipo === 'celda') {
        const p = parseDir(v);
        if (!p) return;
        if (editando) { if (puedeApuntar()) { insertarRef(p.c, p.f, p.c, p.f); return; } if (!confirmar()) return; }
        seleccionar(p.c, p.f);
      } else if (tipo === 'cmd') cmd(v);
      else if (tipo === 'pestaña' || tipo === 'pestana') { pestActiva = v; mostrarPestana(); }
      else if (tipo === 'hoja') { const k = libro.hojas.findIndex(h => h.nombre === v); if (k >= 0 && confirmar()) ejecutar({ accion: 'hoja.activar', indice: k }); }
      else if (tipo === 'ui' && v === 'barra-formulas') barra.focus();
    },
    dobleClic(destino) { simular.clic(destino); if (!editando) iniciarEdicion(null, false); },
    arrastrar(desde, hasta) {
      const b = parseDir(hasta.slice(hasta.indexOf(':') + 1));
      if (!b) return;
      if (desde === 'ui:controlador-relleno') {
        if (!confirmar()) return;
        const s = hoja().sel, o = { c1: s.c1, f1: s.f1, c2: s.c2, f2: s.f2 };
        const d = b.f > o.f2 ? { ...o, f2: b.f } : b.c > o.c2 ? { ...o, c2: b.c } : null;
        if (d) ejecutar({ accion: 'rellenar', origen: textoRango(o), destino: textoRango(d) });
        return;
      }
      const a = parseDir(desde.slice(desde.indexOf(':') + 1));
      if (!a) return;
      if (editando) { if (puedeApuntar()) { insertarRef(a.c, a.f, b.c, b.f); return; } if (!confirmar()) return; }
      seleccionar(a.c, a.f, b.c, b.f, a.c, a.f);
    },
    teclear(ch) {
      if (!editando) { editor.value = ch; iniciarEdicion(ch, true); return; }
      const inp = entrada(), p = inp.selectionStart, v = inp.value;
      inp.value = v.slice(0, p) + ch + v.slice(inp.selectionEnd);
      inp.setSelectionRange(p + ch.length, p + ch.length);
      sincronizar(inp);
      prevEd = inp.value;
    },
    fijarTexto(t) {
      if (!editando) { editor.value = t; iniciarEdicion(t, true); return; }
      const inp = entrada();
      inp.value = t; inp.setSelectionRange(t.length, t.length);
      sincronizar(inp);
      prevEd = t;
    },
    tecla(k, mods = {}) {
      const ev = { key: k, shiftKey: !!mods.mayus, ctrlKey: !!mods.ctrl, metaKey: false, altKey: false, currentTarget: entrada(), preventDefault() {}, stopPropagation() {} };
      if (editando) teclaEdicion(ev); else teclaListo(ev);
    },
    elegir(opcion, en) {
      if (en && en.startsWith('ctl:')) {
        const s = $(`[data-ctl="${en.slice(4)}"]`);
        if (s) { s.value = opcion; s.dispatchEvent(new Event('change', { bubbles: true })); }
        return;
      }
      const b = menuAbierto && [...menuAbierto.querySelectorAll('button')].find(x => x.dataset.opcion === opcion);
      if (b) b.click();
    }
  };

  construirCinta();
  pintar();
  foco();

  return {
    simular,
    alGesto: fn => { oyentesGesto.add(fn); return () => oyentesGesto.delete(fn); },
    pintar, aviso, iniciarEdicion, confirmar, cmd, resaltar, restringir, foco,
    cancelarEdicion: () => { if (editando) terminarEdicion(); },
    estaEditando: () => editando
  };
}
