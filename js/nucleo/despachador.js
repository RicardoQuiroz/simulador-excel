// Despachador: el único camino para modificar el libro.
// Lo usan la vista, y más adelante el guion de demostración, la grabadora,
// las restricciones de lección y la telemetría.

import { ErrorFormula, parseDir, parseRango, textoRango, dir, desplazar, recorrer, MAXC, MAXF } from '../formulas/analizador.js';
import { Err } from '../formulas/funciones.js';
import { hojaActiva, obtener, asegurar, podar, resultado, crearHoja, aJSON, cargarJSON } from './libro.js';
import { interpretar, mostrar } from './formato.js';

const NO_MUTAN = new Set(['seleccionar', 'copiar', 'comando', 'hoja.activar', 'deshacer', 'rehacer']);
const LIMITE_DESHACER = 60;
const no = (codigo) => ({ ok: false, codigo });
const limpiarTexto = t => t.replace(/\r/g, '').replace(/\n$/, '');

export function crearDespachador(libro, motor, reg) {
  const oyentes = new Set(), filtros = new Set(), rechazos = new Set();
  const des = [], re = [];
  let porta = null;

  const foto = () => JSON.stringify(aJSON(libro, motor));
  const restaurar = s => { cargarJSON(libro, JSON.parse(s), motor); motor.recalcular(); };
  const hojaDe = a => a.hoja !== undefined ? libro.hojas[a.hoja] : hojaActiva(libro);
  const rangoDe = (a, h) => a.rango ? parseRango(a.rango) : { c1: h.sel.c1, f1: h.sel.f1, c2: h.sel.c2, f2: h.sel.f2 };
  const cada = (r, fn) => { for (let f = r.f1; f <= r.f2; f++) for (let c = r.c1; c <= r.c2; c++) fn(c, f); };
  const selRango = (h, r, ac, af) => { h.sel = { c1: r.c1, f1: r.f1, c2: r.c2, f2: r.f2, ac: ac === undefined ? r.c1 : ac, af: af === undefined ? r.f1 : af }; };

  function poner(h, c, f, texto) {
    const cel = asegurar(h, c, f);
    try {
      const r = interpretar(texto, cel.fmt, reg, motor);
      cel.v = r.v; cel.ast = r.ast;
      if (r.fmt) Object.assign(cel.fmt, r.fmt);
    } finally { podar(h, c, f); }
  }

  // Generador de valores para el controlador de relleno.
  function generador(fu, vertical) {
    const n = fu.length;
    const numeros = n >= 2 && fu.every(x => x && !x.ast && typeof x.v === 'number');
    let paso = null;
    if (numeros) {
      paso = fu[1].v - fu[0].v;
      for (let i = 2; i < n; i++) if (Math.abs(fu[i].v - fu[i - 1].v - paso) > 1e-9) paso = null;
    }
    const listas = [reg.dias, reg.meses, reg.diasCortos, reg.mesesCortos];
    return k => {
      const src = fu[k % n], vueltas = Math.floor(k / n);
      if (!src) return null;
      const fmt = { ...src.fmt };
      if (src.ast) { const m = k - (k % n); return { v: null, ast: desplazar(src.ast, vertical ? 0 : m, vertical ? m : 0), fmt }; }
      if (paso !== null) return { v: parseFloat((fu[n - 1].v + paso * (k - n + 1)).toPrecision(15)), ast: null, fmt };
      if (n === 1 && typeof src.v === 'number' && (fmt.num === 'fecha' || fmt.num === 'fechaLarga')) return { v: src.v + k, ast: null, fmt };
      if (typeof src.v === 'string') {
        const bajo = src.v.toLowerCase();
        for (const lista of listas) {
          const i = lista.indexOf(bajo);
          if (i < 0) continue;
          let t = lista[(i + vueltas * n) % lista.length];
          if (src.v[0] !== bajo[0]) t = t[0].toUpperCase() + t.slice(1);
          return { v: t, ast: null, fmt };
        }
        const m = /^(.*?)(\d+)$/.exec(src.v);
        if (m) return { v: m[1] + (parseInt(m[2], 10) + vueltas * n), ast: null, fmt };
      }
      return { v: src.v, ast: null, fmt };
    };
  }

  const M = {
    seleccionar(a) {
      const h = hojaDe(a), r = parseRango(a.rango);
      if (!r) return no('rango');
      const act = a.activa ? parseDir(a.activa) : null;
      selRango(h, r, act ? act.c : undefined, act ? act.f : undefined);
    },
    comando() {},
    escribir(a) {
      const h = hojaDe(a), p = parseDir(a.celda);
      if (!p) return no('celda');
      poner(h, p.c, p.f, a.texto);
    },
    borrar(a) {
      const h = hojaDe(a), que = a.que || 'contenido';
      cada(rangoDe(a, h), (c, f) => {
        const cel = obtener(h, c, f);
        if (!cel) return;
        if (que !== 'formatos') { cel.v = null; cel.ast = null; }
        if (que !== 'contenido') cel.fmt = {};
        podar(h, c, f);
      });
    },
    formato(a) {
      const h = hojaDe(a);
      cada(rangoDe(a, h), (c, f) => {
        const cel = asegurar(h, c, f);
        for (const [k, v] of Object.entries(a.fmt)) {
          if (v === null || v === false || v === undefined) delete cel.fmt[k]; else cel.fmt[k] = v;
        }
        podar(h, c, f);
      });
    },
    bordes(a) {
      const h = hojaDe(a), r = rangoDe(a, h);
      cada(r, (c, f) => {
        const cel = asegurar(h, c, f);
        let b;
        if (a.tipo === 'ninguno') b = '';
        else if (a.tipo === 'todos') b = 'trbl';
        else {
          const nuevos = a.tipo === 'exterior'
            ? (f === r.f1 ? 't' : '') + (c === r.c2 ? 'r' : '') + (f === r.f2 ? 'b' : '') + (c === r.c1 ? 'l' : '')
            : (f === r.f2 ? 'b' : '');
          b = [...new Set((cel.fmt.bordes || '') + nuevos)].join('');
        }
        if (b) cel.fmt.bordes = b; else delete cel.fmt.bordes;
        podar(h, c, f);
      });
    },
    decimales(a) {
      const h = hojaDe(a);
      cada(rangoDe(a, h), (c, f) => {
        const cel = obtener(h, c, f), v = resultado(cel);
        if (typeof v !== 'number') return;
        let d = cel.fmt.dec;
        if (d === undefined) {
          if (cel.fmt.num) d = cel.fmt.num === 'porcentaje' ? 0 : 2;
          else { const s = String(parseFloat(v.toPrecision(10))), i = s.indexOf('.'); d = (s.includes('e') || i < 0) ? 0 : s.length - i - 1; }
        }
        cel.fmt.dec = Math.max(0, Math.min(10, d + a.delta));
      });
    },
    copiar(a) {
      const h = hojaDe(a), r = rangoDe(a, h), celdas = [], lineas = [];
      for (let f = r.f1; f <= r.f2; f++) {
        const fila = [], txt = [];
        for (let c = r.c1; c <= r.c2; c++) {
          const x = obtener(h, c, f), v = resultado(x);
          fila.push(x ? { v: x.v, ast: x.ast, fmt: { ...x.fmt }, r: v } : null);
          txt.push(mostrar(v, x && x.fmt, reg));
        }
        celdas.push(fila); lineas.push(txt.join('\t'));
      }
      porta = { hoja: h.nombre, r, corte: !!a.corte, celdas, tsv: lineas.join('\n') };
      return { tsv: porta.tsv, rango: textoRango(r) };
    },
    pegar(a) {
      const h = hojaDe(a);
      const d = a.destino ? parseRango(a.destino) : { c1: h.sel.c1, f1: h.sel.f1, c2: h.sel.c2, f2: h.sel.f2 };
      if (!d) return no('rango');

      // Texto que viene de fuera del simulador
      if (a.texto !== undefined && (!porta || limpiarTexto(a.texto) !== porta.tsv)) {
        const filas = limpiarTexto(a.texto).split('\n').map(l => l.split('\t'));
        let ancho = 1;
        filas.forEach((fila, i) => fila.forEach((t, j) => {
          const c = d.c1 + j, f = d.f1 + i;
          if (c >= MAXC || f >= MAXF) return;
          ancho = Math.max(ancho, j + 1);
          try { poner(h, c, f, t); } catch (e) { if (!(e instanceof ErrorFormula)) throw e; poner(h, c, f, "'" + t); }
        }));
        selRango(h, { c1: d.c1, f1: d.f1, c2: Math.min(MAXC - 1, d.c1 + ancho - 1), f2: Math.min(MAXF - 1, d.f1 + filas.length - 1) });
        return;
      }
      if (!porta) return no('sinPortapapeles');

      const alto = porta.celdas.length, ancho = porta.celdas[0].length;
      const dh = d.f2 - d.f1 + 1, dw = d.c2 - d.c1 + 1;
      const repF = dh % alto === 0 ? dh / alto : 1, repC = dw % ancho === 0 ? dw / ancho : 1;
      if (porta.corte) {
        const origen = libro.hojas.find(x => x.nombre === porta.hoja);
        if (origen) cada(porta.r, (c, f) => { origen.celdas.delete(dir(c, f)); });
      }
      for (let i = 0; i < alto * repF; i++) for (let j = 0; j < ancho * repC; j++) {
        const c = d.c1 + j, f = d.f1 + i;
        if (c >= MAXC || f >= MAXF) continue;
        const src = porta.celdas[i % alto][j % ancho];
        const cel = asegurar(h, c, f);
        if (a.soloValores) {
          cel.ast = null;
          cel.v = !src ? null : src.r instanceof Err ? (reg.errores[src.r.c] || src.r.c) : (src.r === undefined ? null : src.r);
        } else if (!src) { cel.v = null; cel.ast = null; cel.fmt = {}; }
        else {
          cel.fmt = { ...src.fmt };
          cel.v = src.v;
          cel.ast = !src.ast ? null : porta.corte ? src.ast
            : desplazar(src.ast, c - (porta.r.c1 + (j % ancho)), f - (porta.r.f1 + (i % alto)));
        }
        podar(h, c, f);
      }
      selRango(h, { c1: d.c1, f1: d.f1, c2: Math.min(MAXC - 1, d.c1 + ancho * repC - 1), f2: Math.min(MAXF - 1, d.f1 + alto * repF - 1) });
      if (porta.corte) porta = null;
    },
    rellenar(a) {
      const h = hojaDe(a), o = parseRango(a.origen), d = parseRango(a.destino);
      if (!o || !d) return no('rango');
      const vertical = d.f2 > o.f2;
      if (!vertical && d.c2 <= o.c2) return no('rango');
      const escribir = (c, f, x) => {
        const cel = asegurar(h, c, f);
        if (!x) { cel.v = null; cel.ast = null; cel.fmt = {}; }
        else { cel.v = x.v; cel.ast = x.ast; cel.fmt = x.fmt; }
        podar(h, c, f);
      };
      if (vertical) {
        const n = o.f2 - o.f1 + 1;
        for (let c = o.c1; c <= o.c2; c++) {
          const fu = []; for (let f = o.f1; f <= o.f2; f++) fu.push(obtener(h, c, f));
          const g = generador(fu, true);
          for (let k = n; o.f1 + k <= d.f2; k++) escribir(c, o.f1 + k, g(k));
        }
      } else {
        const n = o.c2 - o.c1 + 1;
        for (let f = o.f1; f <= o.f2; f++) {
          const fu = []; for (let c = o.c1; c <= o.c2; c++) fu.push(obtener(h, c, f));
          const g = generador(fu, false);
          for (let k = n; o.c1 + k <= d.c2; k++) escribir(o.c1 + k, f, g(k));
        }
      }
      selRango(h, { c1: o.c1, f1: o.f1, c2: vertical ? o.c2 : d.c2, f2: vertical ? d.f2 : o.f2 }, h.sel.ac, h.sel.af);
    },
    anchoColumna(a) {
      const h = hojaDe(a);
      h.anchos[a.col] = Math.max(20, Math.min(500, Math.round(a.ancho)));
    },
    'hoja.agregar'(a) {
      let nombre = a.nombre, i = libro.hojas.length;
      const existe = n => libro.hojas.some(h => h.nombre.toLowerCase() === n.toLowerCase());
      if (!nombre) do { i++; nombre = reg.textos.hoja + i; } while (existe(nombre));
      else if (existe(nombre)) return no('hojaInvalida');
      libro.hojas.push(crearHoja(nombre));
      libro.activa = libro.hojas.length - 1;
    },
    'hoja.renombrar'(a) {
      const h = libro.hojas[a.indice], nombre = (a.nombre || '').trim();
      if (!h || !nombre || nombre.length > 31 || /[\[\]:*?\/\\']/.test(nombre)) return no('hojaInvalida');
      if (libro.hojas.some(x => x !== h && x.nombre.toLowerCase() === nombre.toLowerCase())) return no('hojaInvalida');
      const viejo = h.nombre.toLowerCase();
      for (const x of libro.hojas) for (const cel of x.celdas.values())
        if (cel.ast) recorrer(cel.ast, n => { if (n.hoja && n.hoja.toLowerCase() === viejo) n.hoja = nombre; });
      for (const d of libro.nombres.values()) if (d.hoja.toLowerCase() === viejo) d.hoja = nombre;
      h.nombre = nombre;
    },
    'hoja.eliminar'(a) {
      if (libro.hojas.length < 2) return no('ultimaHoja');
      if (!libro.hojas[a.indice]) return no('hojaInvalida');
      libro.hojas.splice(a.indice, 1);
      libro.activa = Math.min(libro.activa, libro.hojas.length - 1);
    },
    'hoja.activar'(a) {
      if (!libro.hojas[a.indice]) return no('hojaInvalida');
      libro.activa = a.indice;
    },
    'nombre.definir'(a) {
      const h = hojaDe(a), r = rangoDe(a, h), nombre = (a.nombre || '').trim();
      if (!r || !/^[A-Za-z_À-ɏ][\w.À-ɏ]*$/.test(nombre) || parseDir(nombre) || /^[A-Za-z]{1,3}\d+$/.test(nombre)) return no('nombreInvalido');
      libro.nombres.set(nombre.toLowerCase(), { nombre, hoja: h.nombre, c1: r.c1, f1: r.f1, c2: r.c2, f2: r.f2 });
    }
  };

  // Consulta a los filtros (restricciones de lección) sin ejecutar nada.
  function permite(acc) {
    for (const f of filtros) { const motivo = f(acc); if (motivo) return motivo; }
    return null;
  }
  // Sustituye el libro completo (inicio de lección, reiniciar paso) y borra el historial.
  function cargar(json) {
    cargarJSON(libro, json, motor);
    motor.recalcular();
    des.length = 0; re.length = 0; porta = null;
    for (const o of oyentes) o({ accion: 'cargar' }, { ok: true });
  }

  function ejecutar(acc) {
    const motivo = permite(acc);
    if (motivo) return { ok: false, codigo: 'restringido', mensaje: motivo };
    let res;
    if (acc.accion === 'deshacer' || acc.accion === 'rehacer') {
      const de = acc.accion === 'deshacer' ? des : re, a = acc.accion === 'deshacer' ? re : des;
      if (!de.length) return no('nada');
      a.push(foto());
      restaurar(de.pop());
      res = {};
    } else {
      const m = M[acc.accion];
      if (!m) return no('desconocida');
      const muta = !NO_MUTAN.has(acc.accion);
      const antes = muta ? foto() : null;
      try { res = m(acc) || {}; }
      catch (e) {
        if (!(e instanceof ErrorFormula)) throw e;
        const fallo = { ok: false, codigo: e.codigo, detalle: e.detalle, formula: true };
        for (const o of rechazos) o(acc, fallo);
        return fallo;
      }
      if (res.ok === false) return res;
      if (muta) {
        des.push(antes);
        if (des.length > LIMITE_DESHACER) des.shift();
        re.length = 0;
        motor.recalcular();
      }
    }
    res.ok = true;
    for (const o of oyentes) o(acc, res);
    return res;
  }

  // Propuesta de Autosuma: números contiguos arriba; si no hay, a la izquierda.
  function proponerAutosuma(fnCanon = 'SUM') {
    const h = hojaActiva(libro), { ac: c, af: f } = h.sel;
    const esNum = (x, y) => typeof resultado(obtener(h, x, y)) === 'number';
    const vacia = (x, y) => { const v = resultado(obtener(h, x, y)); return v === null || v === ''; };
    // Como Excel: salta las celdas vacías inmediatas y toma el bloque de números contiguo.
    let rango = '', fin = f - 1;
    while (fin >= 0 && vacia(c, fin)) fin--;
    let i = fin;
    while (i >= 0 && esNum(c, i)) i--;
    if (f > 0 && i < fin) rango = textoRango({ c1: c, f1: i + 1, c2: c, f2: f - 1 });
    else {
      fin = c - 1;
      while (fin >= 0 && vacia(fin, f)) fin--;
      i = fin;
      while (i >= 0 && esNum(i, f)) i--;
      if (c > 0 && i < fin) rango = textoRango({ c1: i + 1, f1: f, c2: c - 1, f2: f });
    }
    return { texto: '=' + motor.dialecto.nombreFn(fnCanon) + '(' + rango + ')', rango };
  }

  return {
    ejecutar,
    proponerAutosuma,
    alCambiar: fn => { oyentes.add(fn); return () => oyentes.delete(fn); },
    filtrar: fn => { filtros.add(fn); return () => filtros.delete(fn); },
    alRechazar: fn => { rechazos.add(fn); return () => rechazos.delete(fn); },
    permite,
    cargar,
    foto: () => aJSON(libro, motor),
    reiniciarHistorial: () => { des.length = 0; re.length = 0; },
    puedeDeshacer: () => des.length > 0,
    puedeRehacer: () => re.length > 0,
    portapapeles: () => porta
  };
}
