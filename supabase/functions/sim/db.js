// Acceso a las tablas mediante la interfaz web de Supabase (PostgREST), con la llave de
// servicio que solo existe dentro del servidor. Sin dependencias externas.

export function crearDb(url, llave, traer = fetch) {
  const cab = { apikey: llave, Authorization: 'Bearer ' + llave, 'Content-Type': 'application/json' };
  const filtro = f => Object.entries(f || {}).map(([k, v]) => k + '=eq.' + encodeURIComponent(v));

  async function pedir(ruta, opc = {}) {
    const r = await traer(url + '/rest/v1/' + ruta, { ...opc, headers: { ...cab, ...(opc.headers || {}) } });
    if (!r.ok) throw new Error('Base de datos: ' + r.status + ' ' + (await r.text()).slice(0, 300));
    const t = await r.text();
    return t ? JSON.parse(t) : null;
  }

  return {
    lista(tabla, f, o = {}) {
      const q = [...filtro(f), 'select=' + (o.columnas || '*')];
      if (o.orden) q.push('order=' + o.orden);
      if (o.limite) q.push('limit=' + o.limite);
      return pedir(tabla + '?' + q.join('&'));
    },
    async uno(tabla, f) { return (await this.lista(tabla, f, { limite: 1 }))[0] || null; },
    // o.conflicto: columnas de la clave única; si existe la fila, se actualiza.
    // o.ignorarDuplicados: si existe la fila, se deja como está.
    insertar(tabla, filas, o = {}) {
      const pref = ['return=minimal'];
      if (o.ignorarDuplicados) pref.push('resolution=ignore-duplicates');
      else if (o.conflicto) pref.push('resolution=merge-duplicates');
      return pedir(tabla + (o.conflicto ? '?on_conflict=' + o.conflicto : ''), { method: 'POST', headers: { Prefer: pref.join(',') }, body: JSON.stringify(filas) });
    },
    actualizar(tabla, f, cambios) {
      return pedir(tabla + '?' + filtro(f).join('&'), { method: 'PATCH', headers: { Prefer: 'return=minimal' }, body: JSON.stringify(cambios) });
    },
    borrar(tabla, f) {
      return pedir(tabla + '?' + filtro(f).join('&'), { method: 'DELETE', headers: { Prefer: 'return=minimal' } });
    }
  };
}
