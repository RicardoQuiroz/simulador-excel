// Máquina de estados de la lección. Es práctica para adquirir destreza:
// nunca bloquea al estudiante, el error produce ayuda y siempre se puede repetir.
// Estados: intro -> guiado <-> checkpoint -> resumen ; libre (sin nota).

import { parseDir, parseRango, textoRango } from '../formulas/analizador.js';
import { hojaActiva } from '../nucleo/libro.js';
import { validar, areaRegla, DETECTORES } from './validadores.js';
import { POLITICA, MENSAJES, ERRORES_COMUNES, ERRORES_UNIVERSALES } from './catalogos.js';

const copia = x => JSON.parse(JSON.stringify(x));
const cruza = (a, b) => a.c1 <= b.c2 && a.c2 >= b.c1 && a.f1 <= b.f2 && a.f2 >= b.f1;

export function crearLeccion({ leccion, libro, motor, desp, vista, reg, sonidos, almacen, repro, grab, buzon, intentosPrevios, maxIntentos }) {
  const T = reg.textos.leccion;
  const interfaz = leccion.interfaz || {};
  const hojaNombre = leccion.libroInicial.hojaActiva || leccion.libroInicial.hojas[0].nombre;
  const oyentes = new Set(), registro = [];
  let guardado = almacen.leer() || {};
  guardado.intentos = guardado.intentos || [];
  // Con servidor, la lista de intentos que vale es la suya; se le suman los de este
  // dispositivo que todavía no se pudieron enviar (por falta de conexión).
  if (intentosPrevios) {
    const ids = new Set(intentosPrevios.map(x => x.id));
    guardado.intentos = [...intentosPrevios, ...guardado.intentos.filter(x => x.pendiente && x.id && !ids.has(x.id))];
  }
  const agotado = () => !!maxIntentos && guardado.intentos.length >= maxIntentos;
  let reloj = 0, espera = 0;

  const st = {
    estado: 'intro', modo: null, i: 0, pasos: [], res: [], fotos: [], desbloq: [],
    comandos: new Set(), feedback: null, pistaVista: 0, pistaDisp: 0, avisoPista: false,
    solucion: null, checkpoint: null, cpRes: {}, nota: null, inicioPaso: 0, demo: null, grabacion: null
  };
  sonidos.silenciar(!!guardado.silencio);

  const notificar = () => { for (const o of oyentes) o(); };
  function emitir(tipo, datos) {
    const ev = { tipo, t: Date.now(), leccion: leccion.identidad.id, paso: st.pasos[st.i] && st.pasos[st.i].id, ...datos };
    registro.push(ev);
    if (registro.length > 500) registro.shift();
    if (buzon) buzon.agregar(ev); // queda en el dispositivo hasta que haya conexión y servidor
  }
  const persistir = () => almacen.escribir(guardado);
  const ctx = rech => ({ libro, motor, reg, hojaNombre, comandos: st.comandos, rech: rech || null });
  const normal = v => !v ? { combinar: 'todas', reglas: [] } : v.reglas ? v : { combinar: 'todas', reglas: [v] };

  // ---------------------------------------------------------------- restricciones
  function zonasEditables() {
    const lista = st.modo === 'reto' ? leccion.reto.celdasEditables : interfaz.celdasEditables;
    return lista ? [...lista, ...st.desbloq].map(parseRango).filter(Boolean) : null;
  }
  function rangoEditable(r, excepto) {
    const zonas = zonasEditables();
    if (!zonas) return true;
    for (let f = r.f1; f <= r.f2; f++) for (let c = r.c1; c <= r.c2; c++) {
      if (excepto && c >= excepto.c1 && c <= excepto.c2 && f >= excepto.f1 && f <= excepto.f2) continue;
      if (!zonas.some(z => c >= z.c1 && c <= z.c2 && f >= z.f1 && f <= z.f2)) return false;
    }
    return true;
  }
  function cmdPermitido(id) {
    const p = interfaz.permitir || {};
    if (id.startsWith('rapido.') || id === 'inicio.copiar' || id === 'inicio.cortar') return true;
    if (id === 'inicio.pegar') return p.pegar !== false;
    if (id.startsWith('inicio.rellenar')) return p.rellenar !== false;
    const lista = interfaz.comandosHabilitados;
    if (!lista) return true;
    return lista.includes(id) || lista.includes(id.replace(/-mas$/, '')) || (id === 'formulas.autosuma' && lista.includes('inicio.autosuma'));
  }
  function bloqueo(acc, texto) {
    sonidos.tocar('bloqueado');
    emitir('accion_bloqueada', { accion: acc.accion, detalle: acc.celda || acc.rango || acc.id });
    return texto || T.celdaProtegida;
  }
  function filtro(acc) {
    if (st.estado !== 'guiado' && st.estado !== 'pausa') return null;
    const p = interfaz.permitir || {}, sel = () => hojaActiva(libro).sel;
    switch (acc.accion) {
      case 'escribir': { const q = parseRango(acc.celda); return q && rangoEditable(q) ? null : bloqueo(acc); }
      case 'borrar': case 'formato': case 'bordes': case 'decimales':
        return rangoEditable(acc.rango ? parseRango(acc.rango) : sel()) ? null : bloqueo(acc);
      case 'copiar':
        return !acc.corte || rangoEditable(acc.rango ? parseRango(acc.rango) : sel()) ? null : bloqueo(acc);
      case 'pegar': {
        if (p.pegar === false) return bloqueo(acc, T.noPermitido);
        const s = acc.destino ? parseRango(acc.destino) : sel(), pt = desp.portapapeles();
        let alto = 1, ancho = 1;
        if (acc.texto !== undefined) { const filas = acc.texto.replace(/\r/g, '').replace(/\n$/, '').split('\n'); alto = filas.length; ancho = Math.max(...filas.map(x => x.split('\t').length)); }
        else if (pt) { alto = pt.celdas.length; ancho = pt.celdas[0].length; }
        return rangoEditable({ c1: s.c1, f1: s.f1, c2: Math.min(25, Math.max(s.c2, s.c1 + ancho - 1)), f2: Math.min(199, Math.max(s.f2, s.f1 + alto - 1)) }) ? null : bloqueo(acc);
      }
      case 'rellenar':
        if (p.rellenar === false) return bloqueo(acc, T.noPermitido);
        return rangoEditable(parseRango(acc.destino), parseRango(acc.origen)) ? null : bloqueo(acc);
      case 'hoja.agregar': case 'hoja.eliminar': case 'hoja.renombrar':
        return p.agregarHojas ? null : bloqueo(acc, T.noPermitido);
      case 'comando':
        if (acc.tipo !== 'F') { emitir('clic_decorativo', { id: acc.id }); return null; }
        return cmdPermitido(acc.id) ? null : bloqueo(acc, T.cmdNoDisponible);
    }
    return null;
  }

  // ---------------------------------------------------------------- libro inicial
  function libroInicial() {
    const j = copia(leccion.libroInicial), dv = leccion.datosVariables;
    if (dv && dv.activo) {
      const h = j.hojas.find(x => x.nombre === hojaNombre) || j.hojas[0];
      for (const [zona, esp] of Object.entries(dv.celdas || {})) {
        const r = parseRango(zona);
        if (!r || esp.tipo !== 'enteroAleatorio') continue;
        const m = esp.multiploDe || 1;
        for (let f = r.f1; f <= r.f2; f++) for (let c = r.c1; c <= r.c2; c++) {
          const k = textoRango({ c1: c, f1: f, c2: c, f2: f });
          const v = Math.round((esp.min + Math.random() * (esp.max - esp.min)) / m) * m;
          h.celdas[k] = { ...(h.celdas[k] || {}), v };
          delete h.celdas[k].f;
        }
      }
    }
    return j;
  }

  // ---------------------------------------------------------------- flujo
  function prepararModo(modo) {
    st.modo = modo;
    st.pasos = modo === 'reto'
      ? [{ id: 'reto', instruccion: leccion.reto.enunciado, validar: leccion.reto.validar, puntos: leccion.reto.puntos || 100, pistas: leccion.reto.pistas || [] }]
      : modo === 'libre' ? [] : leccion.pasos;
    vista.restringir(modo === 'libre' ? null : { pestanas: interfaz.pestanasVisibles, permite: cmdPermitido });
  }
  function empezar(modo) {
    if (modo !== 'libre' && agotado()) return;
    vista.cancelarEdicion();
    prepararModo(modo);
    st.res = st.pasos.map(p => ({ id: p.id, errores: 0, pista: 0, muestrame: false, hecho: false, pct: 0, ms: 0 }));
    st.cpRes = {}; st.desbloq = []; st.i = 0; st.nota = null; st.checkpoint = null;
    st.estado = 'cargando';
    desp.cargar(libroInicial());
    st.fotos = [desp.foto()];
    emitir('leccion_inicio', { modo, intento: guardado.intentos.length + 1 });
    if (modo === 'libre') { st.estado = 'libre'; st.feedback = null; vista.resaltar(null); notificar(); vista.foco(); return; }
    st.estado = 'guiado';
    entrarPaso(false);
    vista.foco();
  }
  function reanudar() {
    const g = guardado.progreso;
    if (!g) return empezar('guiado');
    vista.cancelarEdicion();
    prepararModo(g.modo);
    st.res = g.res; st.cpRes = g.cpRes || {}; st.desbloq = g.desbloq || []; st.i = g.i; st.nota = null;
    st.estado = 'cargando';
    desp.cargar(g.libro);
    st.fotos = []; st.fotos[st.i] = desp.foto();
    st.estado = 'guiado';
    entrarPaso(false);
    vista.foco();
  }

  function entrarPaso(conservarMensaje) {
    const paso = st.pasos[st.i];
    if (!conservarMensaje) st.feedback = null;
    st.pistaVista = 0; st.pistaDisp = 0; st.avisoPista = false; st.solucion = null;
    st.comandos = new Set(); st.inicioPaso = Date.now();
    if (paso.desbloquearCeldas) st.desbloq.push(...paso.desbloquearCeldas);
    vista.resaltar(paso.resaltar || null);
    if (st.modo === 'guiado') {
      guardado.progreso = { modo: st.modo, i: st.i, libro: st.fotos[st.i], res: st.res, cpRes: st.cpRes, desbloq: st.desbloq };
      persistir();
    }
    emitir('paso_inicio');
    armarInactividad();
    notificar();
    evaluar(null, null); // puede que ya esté cumplido (por ejemplo, la celda ya estaba seleccionada)
  }

  function armarInactividad() {
    clearTimeout(reloj);
    if (st.estado !== 'guiado') return;
    reloj = setTimeout(() => {
      if (st.estado !== 'guiado' || st.pistaDisp > 0 || st.pistaVista > 0) return;
      const paso = st.pasos[st.i];
      if (!paso || !(paso.pistas || []).length) return;
      st.pistaDisp = 1; st.avisoPista = true;
      sonidos.tocar('pista');
      emitir('inactividad', { segundos: POLITICA.inactividadSeg });
      notificar();
    }, POLITICA.inactividadSeg * 1000);
  }

  function mensajeDe(falla) {
    const r = falla.r, grupo = MENSAJES[r.tipo] || {};
    let t = grupo[falla.x.motivo] || grupo.defecto || MENSAJES.defecto;
    const fn = r.funcion ? motor.dialecto.nombreFn(r.funcion) : '';
    return t.replace('{funcion}', fn).replace('{celda}', r.celda || r.rango || '').replace('{a}', r.a || '').replace('{rango}', r.rango || '').replace('{nombre}', r.nombre || '');
  }
  function errorComun(paso, c) {
    for (const e of paso.erroresComunes || []) {
      if (e.si) { if (validar(e.si, c).ok) return { id: 'propio', texto: e.feedback }; }
      else if (e.error && DETECTORES[e.error] && DETECTORES[e.error](c, paso)) return { id: e.error, texto: e.feedback || ERRORES_COMUNES[e.error] };
    }
    for (const id of ERRORES_UNIVERSALES) if (DETECTORES[id](c, paso)) return { id, texto: ERRORES_COMUNES[id] };
    return null;
  }

  function evaluar(acc, rech) {
    const paso = st.pasos[st.i];
    if (!paso || st.estado !== 'guiado') return;
    const c = ctx(rech), v = normal(paso.validar);
    const rs = v.reglas.map(r => ({ r, x: validar(r, c) }));
    const bien = rs.length > 0 && (v.combinar === 'alguna' ? rs.some(q => q.x.ok) : rs.every(q => q.x.ok));
    if (bien && !rech) { completar(paso); return; }
    if (!acc) return;

    // ¿Fue un intento de resolver el paso? Solo cuenta si se escribió contenido en una celda del paso.
    const contenido = rech || (acc.accion === 'escribir' && acc.texto !== '') || acc.accion === 'pegar' || acc.accion === 'rellenar';
    if (!contenido) return;
    const s = hojaActiva(libro).sel;
    const area = acc.accion === 'escribir' ? parseRango(acc.celda) : { c1: s.c1, f1: s.f1, c2: s.c2, f2: s.f2 };
    const toca = r => { const a = areaRegla(r); return !!a && cruza(a, area); };
    if (!v.reglas.some(toca)) {
      // Escribió en una celda que pertenece a un paso posterior: se le avisa, sin contar error.
      if (st.pasos.slice(st.i + 1).some(p => normal(p.validar).reglas.some(toca))) { st.feedback = { tipo: 'info', texto: T.pasoPosterior }; notificar(); }
      return;
    }
    const falla = rs.find(q => !q.x.ok && toca(q.r)) || rs.find(q => !q.x.ok);

    const r = st.res[st.i];
    r.errores++;
    const comun = errorComun(paso, c);
    const texto = comun ? comun.texto
      : rech ? (reg.textos.errFormula[rech.codigo] || reg.textos.errFormula.sintaxis).replace('{d}', rech.detalle || '')
      : falla ? mensajeDe(falla) : MENSAJES.defecto;
    st.feedback = { tipo: 'error', texto };
    sonidos.tocar('incorrecto');
    emitir('paso_intento', { correcto: false, regla: falla && falla.r.tipo, motivo: falla && falla.x.motivo, errorComun: comun && comun.id, escrito: acc.texto });
    const umbral = POLITICA.pistaTrasErrores, max = (paso.pistas || []).length;
    const nivel = Math.min(max, umbral.filter(n => r.errores >= n).length);
    if (nivel > st.pistaDisp) { st.pistaDisp = nivel; st.avisoPista = nivel > st.pistaVista; }
    notificar();
  }

  function porcentaje(r) {
    if (r.muestrame) return POLITICA.muestrame;
    const pista = r.pista ? POLITICA.descuentoPista[Math.min(r.pista, POLITICA.descuentoPista.length) - 1] : 0;
    return Math.max(POLITICA.minimo, 100 - POLITICA.descuentoPorError * Math.max(0, r.errores - POLITICA.erroresSinCosto) - pista);
  }

  function completar(paso) {
    const r = st.res[st.i];
    r.hecho = true; r.ms = Date.now() - st.inicioPaso; r.pct = porcentaje(r);
    const fin = paso.alCompletar || {};
    st.feedback = { tipo: 'ok', texto: fin.mensaje || T.bien };
    st.avisoPista = false; st.solucion = null;
    sonidos.tocar(fin.sonido || 'correcto');
    vista.resaltar(null);
    st.fotos[st.i + 1] = desp.foto();
    desp.reiniciarHistorial(); // deshacer no puede cruzar a un paso ya completado
    emitir('paso_completado', { ms: r.ms, errores: r.errores, pista: r.pista, muestrame: r.muestrame, pct: r.pct });
    clearTimeout(reloj);
    const cp = st.modo === 'guiado' && (leccion.checkpoints || []).find(x => x.despuesDelPaso === paso.id);
    if (cp) {
      st.estado = 'pausa';
      notificar();
      clearTimeout(espera);
      espera = setTimeout(() => {
        st.estado = 'checkpoint'; st.checkpoint = { cp, elegida: null };
        sonidos.tocar('checkpoint');
        emitir('checkpoint_inicio', { id: cp.id });
        notificar();
      }, 1100);
    } else avanzar();
  }

  function avanzar() {
    st.i++;
    if (st.i >= st.pasos.length) terminar(); else entrarPaso(true);
  }

  function notaActual() {
    let total = 0, logrado = 0;
    st.pasos.forEach((p, k) => { const pts = p.puntos === undefined ? 10 : p.puntos; total += pts; logrado += pts * st.res[k].pct / 100; });
    if (st.modo === 'guiado') for (const cp of leccion.checkpoints || []) {
      if (!cp.puntos) continue;
      total += cp.puntos;
      if (st.cpRes[cp.id]) logrado += cp.puntos;
    }
    return total ? Math.round(100 * logrado / total) : 0;
  }
  function cerrarIntento(completo) {
    st.nota = notaActual();
    const id = crypto.randomUUID();
    guardado.intentos.push({ id, modo: st.modo, nota: st.nota, completo, fecha: new Date().toISOString(), pendiente: true });
    // El intento viaja al servidor por la bandeja de salida; el servidor recalcula la nota.
    if (buzon) buzon.agregar({ id, clase: 'intento', modo: st.modo, nota: st.nota, completo, detalle: { res: st.res, cpRes: st.cpRes } });
    delete guardado.progreso;
    persistir();
    emitir('intento_fin', { nota: st.nota, completo });
  }
  function terminar() {
    cerrarIntento(true);
    clearTimeout(reloj);
    st.estado = 'resumen'; st.i = st.pasos.length;
    vista.resaltar(null);
    sonidos.tocar('fin');
    notificar();
  }

  // ---------------------------------------------------------------- ayudas
  function pedirPista() {
    const paso = st.pasos[st.i], pistas = (paso && paso.pistas) || [];
    if (st.estado !== 'guiado' || st.pistaVista >= pistas.length) return;
    st.pistaVista++; st.avisoPista = false;
    st.pistaDisp = Math.max(st.pistaDisp, st.pistaVista);
    st.res[st.i].pista = Math.max(st.res[st.i].pista, st.pistaVista);
    emitir('pista_solicitada', { nivel: st.pistaVista, ms: Date.now() - st.inicioPaso });
    notificar();
    vista.foco();
  }
  function puedeMuestrame() {
    const paso = st.pasos[st.i], r = st.res[st.i];
    if (!paso || !r || st.estado !== 'guiado') return false;
    const pistas = (paso.pistas || []).length;
    return r.errores >= POLITICA.pistaTrasErrores[2] || (pistas > 0 && st.pistaVista >= pistas);
  }
  function muestrame() {
    if (!puedeMuestrame()) return;
    const paso = st.pasos[st.i], reglas = normal(paso.validar).reglas;
    const eq = reglas.find(r => r.tipo === 'formula_equivalente'), rel = reglas.find(r => r.tipo === 'rango_relleno');
    const local = t => '=' + motor.aLocal(motor.analizarCanon(t));
    if (eq) st.solucion = T.solucion.replace('{celda}', eq.celda).replace('{formula}', local(eq.referencia));
    else if (rel) { const q = parseRango(rel.rango); st.solucion = T.solucionRelleno.replace('{celda}', textoRango({ c1: q.c1, f1: q.f1, c2: q.c1, f2: q.f1 })).replace('{formula}', local(rel.referenciaPrimeraFila)).replace('{fin}', textoRango({ c1: q.c2, f1: q.f2, c2: q.c2, f2: q.f2 })); }
    else st.solucion = (paso.pistas || []).slice(-1)[0] || paso.instruccion;
    st.res[st.i].muestrame = true;
    emitir('muestrame');
    const md = paso.microDemo;
    if (md && leccion.demo && repro) {
      // Hace el paso a la vista del estudiante, lo deshace y se lo devuelve para que lo repita.
      const foto = desp.foto();
      vista.cancelarEdicion(); clearTimeout(reloj);
      st.estado = 'microdemo';
      notificar();
      repro.iniciar(leccion.demo.slice(md.desde, md.hasta + 1), {
        alTerminar: () => { espera = setTimeout(() => {
          repro.detener();
          st.estado = 'cargando';
          desp.cargar(foto);
          st.estado = 'guiado';
          vista.resaltar(paso.resaltar || null);
          armarInactividad();
          notificar();
          vista.foco();
        }, 1800); }
      });
      return;
    }
    notificar();
    vista.foco();
  }
  function reiniciarPaso() {
    if (st.estado !== 'guiado' || !st.fotos[st.i]) return;
    vista.cancelarEdicion();
    desp.cargar(copia(st.fotos[st.i]));
    st.feedback = null;
    vista.resaltar(st.pasos[st.i].resaltar || null);
    emitir('reinicio_paso');
    notificar();
    vista.foco();
  }
  function reiniciarLeccion() {
    if (st.estado === 'guiado' && st.res.some(r => r.hecho || r.errores)) cerrarIntento(false);
    else { delete guardado.progreso; persistir(); }
    emitir('reinicio_leccion');
    irAIntro();
  }

  // ---------------------------------------------------------------- demostración y grabación
  function demo(guion, volverA) {
    vista.cancelarEdicion(); clearTimeout(reloj); clearTimeout(espera);
    st.modo = null; st.estado = 'demo'; st.demo = { volverA: volverA || 'intro' };
    vista.restringir(null); vista.resaltar(null);
    desp.cargar(copia(leccion.libroInicial));
    emitir('demo_inicio');
    notificar();
    repro.iniciar(guion || leccion.demo, { alTerminar: () => { emitir('demo_completa'); notificar(); } });
  }
  function salirDemo(destino) {
    const volver = st.demo && st.demo.volverA;
    if (repro.estado().estado !== 'fin') emitir('demo_omitida', { accion: repro.estado().i });
    repro.detener();
    st.demo = null;
    if (destino === 'guiado') return empezar('guiado');
    if (volver === 'grabado') { st.estado = 'grabado'; desp.cargar(copia(leccion.libroInicial)); notificar(); return; }
    irAIntro();
  }
  function grabar() {
    vista.cancelarEdicion();
    st.modo = null; st.estado = 'grabando'; st.grabacion = null;
    vista.restringir(null); vista.resaltar(null);
    desp.cargar(copia(leccion.libroInicial));
    grab.iniciar();
    notificar();
    vista.foco();
  }
  function detenerGrabacion() {
    vista.confirmar();
    st.grabacion = grab.detener().map(a => ({ ...a }));
    st.estado = 'grabado';
    notificar();
  }

  // ---------------------------------------------------------------- checkpoints
  function responder(indice) {
    const k = st.checkpoint;
    if (!k || k.elegida !== null) return;
    const op = k.cp.pregunta.opciones[indice];
    k.elegida = indice;
    st.cpRes[k.cp.id] = !!op.correcta;
    sonidos.tocar(op.correcta ? 'correcto' : 'incorrecto');
    emitir('checkpoint_respuesta', { id: k.cp.id, opcion: indice, correcta: !!op.correcta });
    notificar();
  }
  function cerrarCheckpoint() {
    if (st.estado !== 'checkpoint') return;
    st.checkpoint = null; st.estado = 'guiado';
    avanzar();
    vista.foco();
  }

  function alternarSonido() {
    sonidos.silenciar(!sonidos.mudo());
    guardado.silencio = sonidos.mudo();
    persistir();
    if (!sonidos.mudo()) sonidos.tocar('pista');
    notificar();
  }
  function irAIntro() {
    clearTimeout(reloj);
    vista.cancelarEdicion();
    st.estado = 'intro'; st.modo = null; st.demo = null;
    if (repro) repro.detener();
    if (grab && grab.activa()) grab.detener();
    vista.resaltar(null);
    notificar();
  }

  // ---------------------------------------------------------------- conexiones
  if (repro) repro.alCambiar(notificar);
  if (grab) grab.alCambiar(notificar);
  desp.filtrar(filtro);
  desp.alCambiar(acc => {
    if (acc.accion === 'cargar' || st.estado !== 'guiado') return;
    if (acc.accion === 'comando') st.comandos.add(acc.id);
    armarInactividad();
    evaluar(acc, null);
  });
  desp.alRechazar((acc, res) => {
    if (st.estado !== 'guiado' || acc.accion !== 'escribir') return;
    evaluar(acc, { texto: acc.texto, codigo: res.codigo, detalle: res.detalle });
  });

  return {
    leccion, registro,
    alCambiar: fn => { oyentes.add(fn); return () => oyentes.delete(fn); },
    estado: () => {
      const notas = guardado.intentos.map(x => x.nota);
      const paso = st.pasos[st.i];
      return {
        ...st,
        paso,
        pistas: paso ? (paso.pistas || []).slice(0, st.pistaVista) : [],
        totalPistas: paso ? (paso.pistas || []).length : 0,
        puedeMuestrame: puedeMuestrame(),
        intentos: guardado.intentos,
        promedio: notas.length ? Math.round(notas.reduce((a, b) => a + b, 0) / notas.length) : null,
        hayProgreso: !!guardado.progreso,
        mudo: sonidos.mudo(),
        dominio: POLITICA.dominio,
        agotado: agotado(), maxIntentos: maxIntentos || null,
        rep: repro ? repro.estado() : null,
        grabados: grab ? grab.guion() : [],
        tieneDemo: !!(repro && leccion.demo && leccion.demo.length && (!leccion.modos || leccion.modos.mostrar !== false))
      };
    },
    empezar, reanudar, pedirPista, muestrame, reiniciarPaso, reiniciarLeccion,
    responder, cerrarCheckpoint, alternarSonido, irAIntro,
    demo, salirDemo, grabar, detenerGrabacion, repro
  };
}
