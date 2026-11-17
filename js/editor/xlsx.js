// Lector de archivos de Excel (.xlsx) sin librerías.
// Un .xlsx es una carpeta comprimida (zip) con archivos de texto XML adentro.
// Se descomprime con DecompressionStream (incluido en los navegadores y en Node 18+)
// y se convierte al formato de `libroInicial` de las lecciones.
// Devuelve { libro, avisos } donde avisos es una lista de { clave, ...datos } para mostrar al docente.

import { analizar, serializar, recorrer, desplazar, parseDir, colALetra, letraACol, MAXC, MAXF, CANON } from '../formulas/analizador.js';
import { FUNCIONES } from '../formulas/funciones.js';

// ------------------------------------------------------------------ zip
async function inflar(bytes) {
  const s = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
  return new Uint8Array(await new Response(s).arrayBuffer());
}

export async function leerZip(buffer) {
  const b = new Uint8Array(buffer), v = new DataView(b.buffer, b.byteOffset, b.byteLength);
  let fin = -1;
  for (let i = b.length - 22; i >= Math.max(0, b.length - 65557); i--) if (v.getUint32(i, true) === 0x06054b50) { fin = i; break; }
  if (fin < 0) throw new Error('noEsXlsx');
  const total = v.getUint16(fin + 10, true);
  let p = v.getUint32(fin + 16, true);
  const archivos = new Map(), dec = new TextDecoder();
  for (let k = 0; k < total; k++) {
    if (v.getUint32(p, true) !== 0x02014b50) throw new Error('noEsXlsx');
    const metodo = v.getUint16(p + 10, true), tam = v.getUint32(p + 20, true);
    const nl = v.getUint16(p + 28, true), el = v.getUint16(p + 30, true), cl = v.getUint16(p + 32, true);
    const local = v.getUint32(p + 42, true);
    const nombre = dec.decode(b.subarray(p + 46, p + 46 + nl));
    archivos.set(nombre, { metodo, tam, local });
    p += 46 + nl + el + cl;
  }
  return {
    nombres: [...archivos.keys()],
    async texto(nombre) {
      const a = archivos.get(nombre);
      if (!a) return null;
      const ini = a.local + 30 + v.getUint16(a.local + 26, true) + v.getUint16(a.local + 28, true);
      const crudo = b.subarray(ini, ini + a.tam);
      return dec.decode(a.metodo === 8 ? await inflar(crudo) : crudo);
    }
  };
}

// ------------------------------------------------------------------ xml (mínimo)
const ENT = { lt: '<', gt: '>', amp: '&', quot: '"', apos: "'" };
const desc = s => s.indexOf('&') < 0 ? s : s.replace(/&(#x[0-9a-f]+|#\d+|\w+);/gi, (m, e) =>
  e[0] === '#' ? String.fromCodePoint(e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : +e.slice(1)) : (ENT[e] ?? m));

export function xml(s) {
  const raiz = { n: '#', a: {}, h: [], t: '' }, pila = [raiz];
  const re = /<!\[CDATA\[([\s\S]*?)\]\]>|<!--[\s\S]*?-->|<[?!][^>]*>|<(\/?)([\w:.-]+)((?:\s+[\w:.-]+\s*=\s*(?:"[^"]*"|'[^']*'))*)\s*(\/?)>|([^<]+)/g;
  let m;
  while ((m = re.exec(s))) {
    const arriba = pila[pila.length - 1];
    if (m[1] !== undefined) { arriba.t += m[1]; continue; }
    if (m[6] !== undefined) { arriba.t += desc(m[6]); continue; }
    if (!m[3]) continue;
    const n = m[3].split(':').pop();
    if (m[2]) { if (pila.length > 1) pila.pop(); continue; }
    const a = {};
    m[4].replace(/([\w:.-]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g, (_, k, x, y) => { a[k] = desc(x ?? y); a[k.split(':').pop()] ??= a[k]; });
    const el = { n, a, h: [], t: '' };
    arriba.h.push(el);
    if (!m[5]) pila.push(el);
  }
  return raiz;
}
const hijos = (el, n) => el ? el.h.filter(x => x.n === n) : [];
const hijo = (el, n) => el && el.h.find(x => x.n === n);
const buscar = (el, n) => { if (!el) return null; for (const x of el.h) { if (x.n === n) return x; const r = buscar(x, n); if (r) return r; } return null; };
const textoDe = el => !el ? '' : el.n === 'rPh' ? '' : el.t + el.h.map(textoDe).join('');

// ------------------------------------------------------------------ estilos
const NUM_FIJOS = { 1: ['numero', 0], 2: ['numero', 2], 3: ['numero', 0, 1], 4: ['numero', 2, 1], 9: ['porcentaje', 0], 10: ['porcentaje', 2],
  14: ['fecha'], 15: ['fecha'], 16: ['fecha'], 17: ['fecha'], 22: ['fecha'], 18: ['hora'], 19: ['hora'], 20: ['hora'], 21: ['hora'], 45: ['hora'], 46: ['hora'], 47: ['hora'],
  5: ['moneda', 0], 6: ['moneda', 0], 7: ['moneda', 2], 8: ['moneda', 2], 37: ['numero', 0, 1], 38: ['numero', 0, 1], 39: ['numero', 2, 1], 40: ['numero', 2, 1],
  44: ['moneda', 2], 49: ['texto'] };

export function formatoNumero(codigo) {
  if (!codigo || /^general$/i.test(codigo)) return null;
  const sec = codigo.split(';')[0];
  const limpio = sec.replace(/"[^"]*"/g, '').replace(/\\./g, '').replace(/\[(?!\$)[^\]]*\]/g, '');
  const moneda = /\[\$[^\]]*\]|[$€£¥]/.test(sec) || /"(Bs|S\/|\$)[^"]*"/.test(sec);
  let sinMon = limpio.replace(/\[\$[^\]]*\]/g, '');
  // Algunos programas guardan el código con los separadores regionales ("#.##0,00"): se normaliza.
  if (/[#0]\.[#0]{3}(?![#0])/.test(sinMon) && !/[#0],[#0]{3}(?![#0])/.test(sinMon)) sinMon = sinMon.replace(/[.,]/g, x => x === '.' ? ',' : '.');
  if (sinMon.trim() === '@') return { num: 'texto' };
  if (/[hs]/i.test(sinMon) && /:/.test(sinMon) && !/[dy]/i.test(sinMon)) return { num: 'hora' };
  if (/[dy]/i.test(sinMon) || /m{3,}/i.test(sinMon)) return /d{4}|m{4}/i.test(sinMon) ? { num: 'fechaLarga' } : { num: 'fecha' };
  const d = /\.([0#]+)/.exec(sinMon), dec = d ? d[1].length : 0;
  if (/%/.test(sinMon)) return { num: 'porcentaje', dec };
  if (moneda) return { num: 'moneda', dec };
  if (/[0#]/.test(sinMon)) { const r = { num: 'numero', dec }; if (/[#0],[#0]/.test(sinMon)) r.miles = true; return r; }
  return null;
}

function colorDe(el, tema) {
  if (!el) return null;
  let hex = null;
  if (el.a.rgb && /^[0-9a-f]{8}$/i.test(el.a.rgb)) hex = el.a.rgb.slice(2); // AARRGGBB: se ignora la transparencia
  else if (el.a.rgb && /^[0-9a-f]{6}$/i.test(el.a.rgb)) hex = el.a.rgb;
  else if (el.a.theme !== undefined && tema[+el.a.theme]) hex = tema[+el.a.theme];
  if (!hex) return null;
  const tint = parseFloat(el.a.tint || '0');
  let c = [0, 2, 4].map(i => parseInt(hex.substr(i, 2), 16));
  if (tint > 0) c = c.map(x => Math.round(x + (255 - x) * tint));
  else if (tint < 0) c = c.map(x => Math.round(x * (1 + tint)));
  return '#' + c.map(x => x.toString(16).padStart(2, '0')).join('').toUpperCase();
}

function leerTema(txt) {
  if (!txt) return [];
  const esq = buscar(xml(txt), 'clrScheme');
  if (!esq) return [];
  const val = n => { const e = hijo(esq, n); const x = e && e.h[0]; return x ? (x.a.lastClr || x.a.val || null) : null; };
  // Orden de Excel: 0 lt1, 1 dk1, 2 lt2, 3 dk2, 4..9 accent1..6, 10 hlink, 11 folHlink
  return ['lt1', 'dk1', 'lt2', 'dk2', 'accent1', 'accent2', 'accent3', 'accent4', 'accent5', 'accent6', 'hlink', 'folHlink'].map(val);
}

function leerEstilos(txt, tema) {
  if (!txt) return [];
  const r = xml(txt), raiz = r.h[0];
  const formatos = {};
  for (const f of hijos(hijo(raiz, 'numFmts'), 'numFmt')) formatos[f.a.numFmtId] = f.a.formatCode;
  const fuentes = hijos(hijo(raiz, 'fonts'), 'font').map(f => {
    const o = {};
    const b = hijo(f, 'b'), i = hijo(f, 'i'), u = hijo(f, 'u'), sz = hijo(f, 'sz');
    if (b && b.a.val !== '0' && b.a.val !== 'false') o.negrita = true;
    if (i && i.a.val !== '0' && i.a.val !== 'false') o.cursiva = true;
    if (u && u.a.val !== 'none') o.subrayado = true;
    if (sz) o.tam = parseFloat(sz.a.val);
    const c = colorDe(hijo(f, 'color'), tema);
    if (c && c !== '#000000') o.color = c;
    return o;
  });
  const tamBase = (fuentes[0] && fuentes[0].tam) || 11;
  const rellenos = hijos(hijo(raiz, 'fills'), 'fill').map(f => {
    const p = hijo(f, 'patternFill');
    if (!p || p.a.patternType !== 'solid') return null;
    return colorDe(hijo(p, 'fgColor'), tema);
  });
  const bordes = hijos(hijo(raiz, 'borders'), 'border').map(b =>
    [['top', 't'], ['bottom', 'b'], ['left', 'l'], ['right', 'r']].filter(([n]) => { const e = hijo(b, n); return e && e.a.style && e.a.style !== 'none'; }).map(x => x[1]).join(''));
  const H = { left: 'izq', center: 'centro', right: 'der', centerContinuous: 'centro' }, V = { top: 'sup', center: 'medio', bottom: 'inf' };
  return hijos(hijo(raiz, 'cellXfs'), 'xf').map(x => {
    const fmt = {};
    const fu = fuentes[+x.a.fontId || 0] || {};
    for (const k of ['negrita', 'cursiva', 'subrayado', 'color']) if (fu[k]) fmt[k] = fu[k];
    if (fu.tam && fu.tam !== tamBase) fmt.tam = fu.tam;
    const re = rellenos[+x.a.fillId || 0];
    if (re && re !== '#FFFFFF') fmt.relleno = re;
    const bo = bordes[+x.a.borderId || 0];
    if (bo) fmt.bordes = bo;
    const id = +x.a.numFmtId || 0;
    const n = formatos[id] ? formatoNumero(formatos[id]) : NUM_FIJOS[id] ? (([num, dec, miles]) => { const o = { num }; if (dec !== undefined) o.dec = dec; if (miles) o.miles = true; return o; })(NUM_FIJOS[id]) : null;
    if (n) Object.assign(fmt, n);
    const al = hijo(x, 'alignment');
    if (al) {
      if (H[al.a.horizontal]) fmt.alinH = H[al.a.horizontal];
      if (V[al.a.vertical] && al.a.vertical !== 'bottom') fmt.alinV = V[al.a.vertical];
      if (al.a.wrapText === '1' || al.a.wrapText === 'true') fmt.ajustar = true;
    }
    return fmt;
  });
}

// ------------------------------------------------------------------ fórmulas
const limpiarFormula = f => f.replace(/_xlfn\._xlws\.|_xlfn\.|_xlws\./g, '').replace(/^=/, '');

function revisarFormula(texto, avisos, celda, hoja) {
  let ast;
  try { ast = analizar(texto, CANON); }
  catch (_) { avisos.push({ clave: 'formulaIlegible', celda, hoja, formula: texto }); return null; }
  const faltan = [];
  recorrer(ast, n => { if (n.t === 'fn' && !FUNCIONES[n.n] && n.n !== 'IF' && n.n !== 'IFERROR') faltan.push(n.n); });
  if (faltan.length) { avisos.push({ clave: 'funcionNoDisponible', celda, hoja, funciones: [...new Set(faltan)] }); return null; }
  return ast;
}

// ------------------------------------------------------------------ libro
const anchoPx = w => Math.max(20, Math.round(parseFloat(w) * 7 + 5));
const ruta = (base, t) => t.startsWith('/') ? t.slice(1) : (base.replace(/[^/]*$/, '') + t).replace(/[^/]+\/\.\.\//g, '');

export async function leerXlsx(buffer) {
  let zip;
  try { zip = await leerZip(buffer); } catch (_) { throw new Error('noEsXlsx'); }
  const libroXml = await zip.texto('xl/workbook.xml');
  if (!libroXml) throw new Error('noEsXlsx');
  const avisos = [];
  const wb = xml(libroXml).h[0];
  const rels = {};
  for (const r of hijos(xml((await zip.texto('xl/_rels/workbook.xml.rels')) || '').h[0], 'Relationship')) rels[r.a.Id] = ruta('xl/workbook.xml', r.a.Target);
  const compartidos = hijos(xml((await zip.texto('xl/sharedStrings.xml')) || '<sst/>').h[0], 'si').map(textoDe);
  const tema = leerTema(await zip.texto('xl/theme/theme1.xml'));
  const estilos = leerEstilos(await zip.texto('xl/styles.xml'), tema);

  const hojasXml = hijos(hijo(wb, 'sheets'), 'sheet');
  const libro = { hojaActiva: null, hojas: [], nombres: {} };
  const activa = +((hijo(hijo(wb, 'bookViews'), 'workbookView') || { a: {} }).a.activeTab || 0);
  for (const [k, sh] of hojasXml.entries()) {
    const nombre = sh.a.name;
    if (sh.a.state === 'hidden' || sh.a.state === 'veryHidden') { avisos.push({ clave: 'hojaOculta', hoja: nombre }); continue; }
    const destino = rels[sh.a['r:id'] || sh.a.id];
    const txt = destino && await zip.texto(destino);
    if (!txt) { avisos.push({ clave: 'hojaNoLeida', hoja: nombre }); continue; }
    const raiz = xml(txt).h[0];
    if (raiz.n !== 'worksheet') { avisos.push({ clave: 'hojaNoLeida', hoja: nombre }); continue; }
    const hoja = { nombre, anchos: {}, celdas: {} };
    for (const col of hijos(hijo(raiz, 'cols'), 'col')) {
      if (!col.a.width || col.a.hidden === '1') continue;
      for (let c = +col.a.min - 1; c <= Math.min(+col.a.max - 1, MAXC - 1); c++) hoja.anchos[colALetra(c)] = anchoPx(col.a.width);
    }
    const maestras = {};
    let fuera = 0;
    for (const fila of hijos(hijo(raiz, 'sheetData'), 'row')) for (const c of hijos(fila, 'c')) {
      const p = parseDir(c.a.r || '');
      if (!p) { fuera++; continue; }
      const celda = c.a.r, o = {};
      const fmt = estilos[+c.a.s || 0];
      if (fmt && Object.keys(fmt).length) o.fmt = { ...fmt };
      const vEl = hijo(c, 'v'), fEl = hijo(c, 'f'), t = c.a.t || 'n';
      let v = null;
      if (t === 's') v = vEl ? compartidos[+vEl.t] ?? '' : null;
      else if (t === 'inlineStr') v = textoDe(hijo(c, 'is'));
      else if (t === 'str') v = vEl ? vEl.t : '';
      else if (t === 'b') v = vEl ? vEl.t === '1' : null;
      else if (t === 'e') v = vEl ? vEl.t : null;
      else if (vEl && vEl.t !== '') v = Number(vEl.t);
      let formula = null;
      if (fEl) {
        if (fEl.a.t === 'shared' && fEl.a.si !== undefined) {
          if (fEl.t) { maestras[fEl.a.si] = { texto: limpiarFormula(fEl.t), c: p.c, f: p.f }; formula = maestras[fEl.a.si].texto; }
          else if (maestras[fEl.a.si]) {
            const m = maestras[fEl.a.si];
            try { formula = serializar(desplazar(analizar(m.texto, CANON), p.c - m.c, p.f - m.f), CANON); } catch (_) { formula = null; }
          }
        } else if (fEl.t) formula = limpiarFormula(fEl.t);
      }
      if (formula && revisarFormula(formula, avisos, celda, nombre)) o.f = formula;
      else if (v !== null && v !== '') o.v = v;
      if (o.f || o.v !== undefined || o.fmt) hoja.celdas[celda] = o;
    }
    if (fuera) avisos.push({ clave: 'fueraDeLimites', hoja: nombre, n: fuera, ultima: colALetra(MAXC - 1) + MAXF });
    for (const n of ['mergeCells', 'drawing', 'tableParts', 'conditionalFormatting', 'dataValidations'])
      if (buscar(raiz, n)) avisos.push({ clave: 'noImportado_' + n, hoja: nombre });
    libro.hojas.push(hoja);
    if (k === activa) libro.hojaActiva = nombre;
  }
  if (!libro.hojas.length) throw new Error('sinHojas');
  if (!libro.hojaActiva) libro.hojaActiva = libro.hojas[0].nombre;

  // Nombres definidos que apuntan a un rango simple: Hoja!$A$1:$B$5
  for (const d of hijos(hijo(wb, 'definedNames'), 'definedName')) {
    if (d.a.name.startsWith('_xlnm')) continue;
    const m = /^(?:'((?:[^']|'')+)'|([^!]+))!\$?([A-Z]+)\$?(\d+)(?::\$?([A-Z]+)\$?(\d+))?$/.exec(d.t.trim());
    if (!m) { avisos.push({ clave: 'nombreNoImportado', nombre: d.a.name }); continue; }
    const hoja = (m[1] || m[2]).replace(/''/g, "'");
    const c1 = letraACol(m[3]), f1 = +m[4] - 1, c2 = m[5] ? letraACol(m[5]) : c1, f2 = m[6] ? +m[6] - 1 : f1;
    if (c2 >= MAXC || f2 >= MAXF) { avisos.push({ clave: 'nombreNoImportado', nombre: d.a.name }); continue; }
    libro.nombres[d.a.name.toLowerCase()] = { nombre: d.a.name, hoja, c1, f1, c2, f2 };
  }
  if (zip.nombres.some(n => /vbaProject/i.test(n))) avisos.push({ clave: 'macros' });
  if (zip.nombres.some(n => /^xl\/charts\//.test(n))) avisos.push({ clave: 'graficos' });
  if (zip.nombres.some(n => /^xl\/pivotTables\//.test(n))) avisos.push({ clave: 'tablasDinamicas' });
  return { libro, avisos };
}
