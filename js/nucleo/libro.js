// Modelo del libro: datos puros, sin nada de pantalla.
// Celda: { v: valor escrito, ast: fórmula analizada, fmt: formato, r: resultado calculado }

import { MAXC, MAXF, dir, parseDir } from '../formulas/analizador.js';
export { MAXC, MAXF };

export const nuevaSel = () => ({ c1: 0, f1: 0, c2: 0, f2: 0, ac: 0, af: 0 });
export const crearHoja = nombre => ({ nombre, celdas: new Map(), anchos: {}, sel: nuevaSel() });
export const crearLibro = () => ({ hojas: [crearHoja('Hoja1')], activa: 0, nombres: new Map() });
export const hojaActiva = libro => libro.hojas[libro.activa];

export const obtener = (hoja, c, f) => hoja.celdas.get(dir(c, f));
export function asegurar(hoja, c, f) {
  const k = dir(c, f);
  let x = hoja.celdas.get(k);
  if (!x) { x = { v: null, ast: null, fmt: {} }; hoja.celdas.set(k, x); }
  return x;
}
export function podar(hoja, c, f) {
  const k = dir(c, f), x = hoja.celdas.get(k);
  if (x && x.v === null && !x.ast && !Object.keys(x.fmt).length) hoja.celdas.delete(k);
}
export const resultado = cel => !cel ? null : cel.ast ? cel.r : cel.v;

// Formato de intercambio: el mismo de `libroInicial` en las lecciones.
export function aJSON(libro, motor) {
  return {
    hojaActiva: libro.hojas[libro.activa].nombre,
    hojas: libro.hojas.map(h => ({
      nombre: h.nombre,
      anchos: { ...h.anchos },
      sel: { ...h.sel },
      celdas: Object.fromEntries([...h.celdas].map(([k, x]) => {
        const o = {};
        if (x.ast) o.f = motor.aCanon(x.ast); else if (x.v !== null) o.v = x.v;
        if (Object.keys(x.fmt).length) o.fmt = { ...x.fmt };
        return [k, o];
      }))
    })),
    nombres: Object.fromEntries(libro.nombres)
  };
}

export function cargarJSON(libro, json, motor) {
  libro.hojas = json.hojas.map(j => {
    const h = crearHoja(j.nombre);
    h.anchos = { ...(j.anchos || {}) };
    if (j.sel) h.sel = { ...j.sel };
    for (const [k, x] of Object.entries(j.celdas || {})) {
      if (!parseDir(k)) continue;
      h.celdas.set(k, {
        v: x.f ? null : (x.v === undefined ? null : x.v),
        ast: x.f ? motor.analizarCanon(x.f) : null,
        fmt: { ...(x.fmt || {}) }
      });
    }
    return h;
  });
  if (!libro.hojas.length) libro.hojas = [crearHoja('Hoja1')];
  libro.activa = Math.max(0, libro.hojas.findIndex(h => h.nombre === json.hojaActiva));
  libro.nombres = new Map(Object.entries(json.nombres || {}));
}
