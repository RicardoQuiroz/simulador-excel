// Base de datos en memoria con la misma interfaz que supabase/functions/sim/db.js.
// La usan las pruebas y el servidor de ensayo. Se borra al cerrar el programa.
export function crearMemoria({ estricta = false } = {}) {
  const t = {};
  const tabla = n => (t[n] = t[n] || []);
  const vale = (x, v) => {
    if (v && typeof v === 'object' && 'desde' in v) return x !== null && x !== undefined && String(x) >= String(v.desde);
    if (v && typeof v === 'object' && 'en' in v) return v.en.map(String).includes(String(x));
    return String(x) === String(v);
  };
  const cumple = (fila, f) => Object.entries(f || {}).every(([k, v]) => vale(fila[k], v));
  return {
    tablas: t,
    async lista(n, f, o = {}) {
      const r = tabla(n).filter(x => cumple(x, f)).map(x => ({ ...x }));
      if (o.orden) { const [col, dir] = o.orden.split('.'); r.sort((a, b) => (a[col] < b[col] ? -1 : a[col] > b[col] ? 1 : 0) * (dir === 'desc' ? -1 : 1)); }
      return o.limite ? r.slice(0, o.limite) : r;
    },
    async uno(n, f) { return (await this.lista(n, f, { limite: 1 }))[0] || null; },
    async insertar(n, filas, o = {}) {
      const claves = o.conflicto ? o.conflicto.split(',') : ['id'];
      for (const fila of Array.isArray(filas) ? filas : [filas]) {
        const i = tabla(n).findIndex(x => claves.every(k => x[k] !== undefined && x[k] === fila[k]));
        if (i < 0) tabla(n).push({ ...fila });
        else if (o.ignorarDuplicados) continue;
        else if (o.conflicto || !estricta) tabla(n)[i] = { ...tabla(n)[i], ...fila };
        else throw new Error('duplicado en ' + n);
      }
    },
    async actualizar(n, f, c) { for (const x of tabla(n)) if (cumple(x, f)) Object.assign(x, c); },
    async borrar(n, f) { t[n] = tabla(n).filter(x => !cumple(x, f)); }
  };
}
