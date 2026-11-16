// Bandeja de salida: guarda en el dispositivo lo que hay que enviar al servidor (eventos
// y resultados) y lo entrega cuando hay conexión. Cada elemento lleva un identificador
// único, así reenviarlo no lo duplica. En la fase 5 se conectará la función "enviar".

const LIMITE = 2000;
const nuevoId = () => (crypto.randomUUID ? crypto.randomUUID() : Date.now().toString(36) + Math.random().toString(36).slice(2));

export function crearBuzon(clave, enviar) {
  let cola = [];
  try { cola = JSON.parse(localStorage.getItem(clave)) || []; } catch (_) { cola = []; }
  let ocupado = false, reloj = 0;
  const guardar = () => { try { localStorage.setItem(clave, JSON.stringify(cola)); } catch (_) { /* sin almacenamiento */ } };

  async function vaciar() {
    if (!enviar || ocupado || !cola.length || !navigator.onLine) return;
    ocupado = true;
    try {
      const lote = cola.slice(0, 50);
      await enviar(lote); // debe lanzar un error si el servidor no confirma
      const enviados = new Set(lote.map(x => x.id));
      cola = cola.filter(x => !enviados.has(x.id));
      guardar();
    } catch (_) { /* se reintenta más tarde */ } finally { ocupado = false; }
    if (cola.length) reloj = setTimeout(vaciar, 15000);
  }
  addEventListener('online', vaciar);

  return {
    agregar(dato) {
      cola.push({ id: nuevoId(), ...dato });
      if (cola.length > LIMITE) cola.splice(0, cola.length - LIMITE);
      guardar();
      clearTimeout(reloj);
      reloj = setTimeout(vaciar, 2000);
    },
    pendientes: () => cola.length,
    vaciar
  };
}
