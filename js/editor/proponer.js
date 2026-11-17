// Propone una lección a partir de dos libros: el ejercicio (lo que ve el estudiante al
// empezar) y el solucionario. Las diferencias entre ambos son lo que el estudiante debe
// hacer: de ahí salen los pasos, las reglas de revisión, las pistas y las celdas editables.
// Los textos salen de la configuración regional (reg.textos.editor.propuesta).

import { analizar, serializar, desplazar, recorrer, parseDir, dir, textoRango, crearDialecto, CANON } from '../formulas/analizador.js';

const pon = (txt, v) => Object.entries(v).reduce((a, [k, x]) => a.split('{' + k + '}').join(x), String(txt || ''));
const igualJSON = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const orden = (a, b) => a.f - b.f || a.c - b.c;

// Lección vacía con la estructura completa: sirve para "empezar en blanco" y como base.
export function leccionVacia(titulo = '') {
  return {
    identidad: { id: '', titulo, materia: '', tema: '', idioma: 'es', nivel: 'básico', duracionMin: 10 },
    pedagogia: { objetivos: [], destreza: '' },
    libroInicial: { hojaActiva: 'Hoja1', hojas: [{ nombre: 'Hoja1', anchos: {}, celdas: {} }], nombres: {} },
    interfaz: { pestanasVisibles: ['inicio', 'formulas'], celdasEditables: [], permitir: { pegar: true, rellenar: true, insertarFilas: false, agregarHojas: false, menuContextual: true } },
    modos: { mostrar: true, guiado: true, reto: false, libre: true },
    pasos: [], checkpoints: [], demo: [],
    cierre: { mensaje: '', resumen: [] }
  };
}

// Fórmula canónica -> como la escribe el docente o el estudiante (=SI(...;...)).
export function formulaLocal(canon, reg) {
  try { return '=' + serializar(analizar(canon, CANON), crearDialecto(reg)); } catch (_) { return '=' + canon; }
}
// Lo que escribe el docente -> canónica. Lanza un error si no se entiende.
export function formulaCanon(local, reg) {
  return serializar(analizar(String(local).trim().replace(/^=/, '').replace(/[“”„«»]/g, '"'), crearDialecto(reg)), CANON);
}

function funcionesDe(canon) {
  const r = [];
  try { recorrer(analizar(canon, CANON), n => { if (n.t === 'fn' && !r.includes(n.n)) r.push(n.n); }); } catch (_) { /* sin funciones */ }
  return r;
}
function celdasQueUsa(canon) {
  const r = [];
  try { recorrer(analizar(canon, CANON), n => { if (n.t === 'ref' && !n.hoja) { const d = dir(n.c, n.f); if (!r.includes(d)) r.push(d); } }); } catch (_) { /* nada */ }
  return r;
}

// Título de lo que calcula una celda: el rótulo a su izquierda (para totales sueltos)
// o el encabezado de su columna (para columnas que se rellenan).
function tituloDe(hoja, c, f, preferirColumna) {
  const txt = (cc, ff) => { const x = hoja.celdas[dir(cc, ff)]; return x && typeof x.v === 'string' && x.v.trim() ? x.v.trim() : null; };
  let izq = null, arriba = null;
  for (let k = c - 1; k >= 0 && !izq; k--) izq = txt(k, f);
  for (let k = f - 1; k >= 0 && !arriba; k--) arriba = txt(c, k);
  return preferirColumna ? (arriba || izq) : (izq || arriba);
}

export function proponer(ejercicio, solucion, reg, opciones = {}) {
  const T = reg.textos.editor.propuesta, N = reg.textos.editor.formatos;
  const dialecto = crearDialecto(reg);
  const local = canon => formulaLocal(canon, reg).slice(1);
  const nombreFn = n => dialecto.nombreFn(n);
  const activa = ejercicio.hojaActiva;
  const pasos = [], editables = [], iniciales = {};
  let n = 0;
  const id = () => 'p' + (++n);

  for (const hs of solucion.hojas) {
    const he = ejercicio.hojas.find(h => h.nombre === hs.nombre) || { celdas: {} };
    const conHoja = r => hs.nombre === activa ? r : { ...r, hoja: hs.nombre };
    const formulas = [], valores = [], formatos = [];
    for (const [k, s] of Object.entries(hs.celdas)) {
      const p = parseDir(k); if (!p) continue;
      const e = he.celdas[k] || {};
      if (s.f && s.f !== e.f) formulas.push({ ...p, k, fx: s.f });
      else if (!s.f && s.v !== undefined && s.v !== e.v) valores.push({ ...p, k, v: s.v });
      const fs = s.fmt || {}, fe = e.fmt || {}, delta = {};
      // Excel da formato de número solo al escribir una fórmula: eso no se pide como paso,
      // se pone ya en la hoja inicial para que el resultado se vea igual.
      const auto = s.f && s.f !== e.f ? ['num', 'dec', 'miles'] : [];
      for (const x of new Set([...Object.keys(fs), ...Object.keys(fe)])) {
        if (igualJSON(fs[x], fe[x])) continue;
        if (auto.includes(x)) { if (fs[x] !== undefined) (iniciales[hs.nombre] ||= {})[k] = { ...((iniciales[hs.nombre] || {})[k] || {}), [x]: fs[x] }; continue; }
        delta[x] = fs[x] === undefined ? false : fs[x];
      }
      if (Object.keys(delta).length) formatos.push({ ...p, k, delta });
    }

    // Fórmulas: se agrupan las que son la misma fórmula copiada hacia abajo o a la derecha.
    const grupos = [], usadas = new Set();
    formulas.sort((a, b) => a.c - b.c || a.f - b.f);
    const enPos = (c, f) => formulas.find(x => x.c === c && x.f === f && !usadas.has(x.k));
    const mismo = (base, x, dc, df) => { try { return serializar(desplazar(analizar(base.fx, CANON), dc, df), CANON) === x.fx; } catch (_) { return false; } };
    for (const x of formulas) {
      if (usadas.has(x.k)) continue;
      usadas.add(x.k);
      const g = [x];
      for (const [dc, df] of [[0, 1], [1, 0]]) {
        if (g.length > 1) break;
        let sig;
        while ((sig = enPos(x.c + dc * g.length, x.f + df * g.length)) && mismo(x, sig, dc * g.length, df * g.length)) { g.push(sig); usadas.add(sig.k); }
      }
      grupos.push(g);
    }
    grupos.sort((a, b) => orden(a[0], b[0]));

    for (const g of grupos) {
      const x = g[0], fns = funcionesDe(x.fx), refs = celdasQueUsa(x.fx);
      const titulo = tituloDe(hs, x.c, x.f, g.length > 1);
      const reglas = [conHoja({ tipo: 'es_formula', celda: x.k })];
      if (fns.length) reglas.push(conHoja({ tipo: 'usa_funcion', celda: x.k, funcion: fns[0] }));
      reglas.push(conHoja({ tipo: 'formula_equivalente', celda: x.k, referencia: x.fx, ignorarMayusculas: true }));
      const errores = [{ error: 'valor-en-vez-de-formula' }];
      if (fns.includes('IF')) errores.push({ error: 'argumentos-si-invertidos' });
      if (/"/.test(x.fx)) errores.push({ error: 'texto-sin-comillas' });
      if (/:/.test(x.fx)) errores.push({ error: 'rango-incompleto' });
      pasos.push({
        id: id(),
        instruccion: titulo ? pon(T.formula, { celda: x.k, titulo }) : pon(T.formulaSinTitulo, { celda: x.k }),
        resaltar: 'celda:' + x.k, puntos: g.length > 1 ? 30 : 20,
        validar: { combinar: 'todas', reglas },
        pistas: [
          fns.length ? pon(T.pistaFuncion, { funciones: fns.map(nombreFn).join(', ') }) : T.pistaSinFuncion,
          refs.length ? pon(T.pistaCeldas, { celda: x.k, celdas: refs.join(', ') }) : pon(T.pistaSeleccionar, { celda: x.k }),
          pon(T.pistaForma, { formula: '=' + local(x.fx) })
        ],
        erroresComunes: errores,
        alCompletar: { sonido: 'correcto' }
      });
      if (g.length > 1) {
        const y = g[1], fin = g[g.length - 1];
        const rango = textoRango({ c1: y.c, f1: y.f, c2: fin.c, f2: fin.f });
        pasos.push({
          id: id(),
          instruccion: pon(T.relleno, { celda: x.k, fin: fin.k }),
          resaltar: 'rango:' + textoRango({ c1: x.c, f1: x.f, c2: fin.c, f2: fin.f }), puntos: 20,
          validar: { combinar: 'todas', reglas: [conHoja({ tipo: 'rango_relleno', rango, referenciaPrimeraFila: y.fx })] },
          pistas: [T.pistaRelleno1, pon(T.pistaRelleno2, { celda: x.k }), pon(T.pistaRelleno3, { fin: fin.k })],
          erroresComunes: [{ si: conHoja({ tipo: 'rango_valores_fijos', rango }), feedback: T.rellenoAMano }],
          alCompletar: { sonido: 'correcto' }
        });
      }
      editables.push(textoRango({ c1: x.c, f1: x.f, c2: g[g.length - 1].c, f2: g[g.length - 1].f }));
    }

    // Valores escritos: se agrupan por columna en bloques seguidos.
    valores.sort((a, b) => a.c - b.c || a.f - b.f);
    const bloques = [];
    for (const v of valores) { const u = bloques[bloques.length - 1]; if (u && u[0].c === v.c && u[u.length - 1].f === v.f - 1) u.push(v); else bloques.push([v]); }
    for (const b of bloques.sort((a, c) => orden(a[0], c[0]))) {
      const r = textoRango({ c1: b[0].c, f1: b[0].f, c2: b[0].c, f2: b[b.length - 1].f });
      pasos.push({
        id: id(),
        instruccion: b.length === 1 ? pon(T.valor, { valor: b[0].v, celda: b[0].k }) : pon(T.valores, { rango: r }),
        resaltar: (b.length === 1 ? 'celda:' : 'rango:') + r, puntos: 10,
        validar: { combinar: 'todas', reglas: b.slice(0, 30).map(v => conHoja({ tipo: 'valor_celda', celda: v.k, valor: v.v })) },
        pistas: [T.pistaValor1, pon(T.pistaValor2, { celda: b[0].k }), b.length === 1 ? pon(T.pistaValor3, { valor: b[0].v }) : T.pistaValores3],
        erroresComunes: [], alCompletar: { sonido: 'correcto' }
      });
      editables.push(r);
    }

    // Formatos: se agrupan las celdas que reciben el mismo cambio y forman un rectángulo.
    const porDelta = new Map();
    for (const x of formatos) { const k = JSON.stringify(x.delta); if (!porDelta.has(k)) porDelta.set(k, []); porDelta.get(k).push(x); }
    for (const [k, celdas] of porDelta) {
      const delta = JSON.parse(k);
      const restantes = [...celdas].sort(orden);
      while (restantes.length) {
        const a = restantes[0];
        let c2 = a.c, f2 = a.f;
        const hay = (c, f) => restantes.some(x => x.c === c && x.f === f);
        while (hay(c2 + 1, a.f)) c2++;
        const filaCompleta = f => { for (let c = a.c; c <= c2; c++) if (!hay(c, f)) return false; return true; };
        while (filaCompleta(f2 + 1)) f2++;
        for (let i = restantes.length - 1; i >= 0; i--) { const x = restantes[i]; if (x.c >= a.c && x.c <= c2 && x.f >= a.f && x.f <= f2) restantes.splice(i, 1); }
        const r = textoRango({ c1: a.c, f1: a.f, c2, f2 });
        const lista = Object.entries(delta).map(([kk, v]) => v === false ? pon(N.quitar, { x: N[kk] || kk }) : kk === 'num' ? (N['num_' + v] || v) : (N[kk] || kk)).filter((x, i, arr) => x && arr.indexOf(x) === i);
        const fmt = {};
        for (const [kk, v] of Object.entries(delta)) fmt[kk] = v === false ? false : v;
        pasos.push({
          id: id(),
          instruccion: pon(T.formato, { rango: r, lista: lista.join(', ') }),
          resaltar: (r.includes(':') ? 'rango:' : 'celda:') + r, puntos: 10,
          validar: { combinar: 'todas', reglas: [conHoja({ tipo: 'formato', rango: r, fmt })] },
          pistas: [T.pistaFormato1, pon(T.pistaFormato2, { rango: r }), T.pistaFormato3],
          erroresComunes: [], alCompletar: { sonido: 'correcto' }
        });
        editables.push(r);
      }
    }
  }

  const lec = leccionVacia(opciones.titulo || '');
  lec.libroInicial = JSON.parse(JSON.stringify(ejercicio));
  for (const [hoja, celdas] of Object.entries(iniciales)) {
    const h = lec.libroInicial.hojas.find(x => x.nombre === hoja); if (!h) continue;
    for (const [k, fmt] of Object.entries(celdas)) h.celdas[k] = { ...(h.celdas[k] || {}), fmt: { ...((h.celdas[k] || {}).fmt || {}), ...fmt } };
  }
  lec.interfaz.celdasEditables = [...new Set(editables)];
  lec.pasos = pasos;
  return lec;
}
