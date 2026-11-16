// Servidor del simulador: arranque desde el LMS con LTI 1.3, sesiones, entrega de la
// lección, recepción de eventos e intentos, y envío de la nota al LMS.
// No depende del entorno: recibe la base de datos y la función de red, así se puede probar.

import { firmar, verificar, generarClave, aleatorio, sha256 } from './jwt.js';

const LTI = 'https://purl.imsglobal.org/spec/lti/claim/';
const AGS = 'https://purl.imsglobal.org/spec/lti-ags/claim/endpoint';
const ALCANCE_NOTA = 'https://purl.imsglobal.org/spec/lti-ags/scope/score';
const MIN = 60000;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

class Fallo extends Error { constructor(estado, mensaje) { super(mensaje); this.estado = estado; } }
const exigir = (cond, estado, mensaje) => { if (!cond) throw new Fallo(estado, mensaje); };

export function crearNucleo({ db, traer = fetch, ahora = () => Date.now(), urlBase }) {
  const iso = (ms = ahora()) => new Date(ms).toISOString();
  const ajuste = async clave => { const r = await db.uno('ajustes', { clave }); return r ? r.valor : null; };

  async function claveHerramienta() {
    let k = (await db.lista('claves_lti', {}, { orden: 'creada.desc', limite: 1 }))[0];
    if (!k) { k = { ...(await generarClave()), creada: iso() }; await db.insertar('claves_lti', k); }
    return k;
  }

  // ------------------------------------------------------------ arranque LTI 1.3
  async function jwks() {
    const k = await claveHerramienta();
    return { cuerpo: { keys: [{ ...k.publica, kid: k.kid, alg: 'RS256', use: 'sig' }] } };
  }

  // Paso 1: el LMS avisa que alguien quiere entrar. Se le devuelve al LMS para que lo identifique.
  async function login(p) {
    exigir(p.iss && p.login_hint, 400, 'Faltan datos del LMS');
    const plat = await db.uno('plataformas_lti', p.client_id ? { emisor: p.iss, client_id: p.client_id } : { emisor: p.iss });
    exigir(plat, 400, 'Este LMS no está registrado en el simulador');
    const estado = aleatorio(24), nonce = aleatorio(24);
    await db.insertar('estados_lti', { estado, nonce, plataforma: plat.id, creado: iso() });
    const u = new URL(plat.url_login);
    const q = { scope: 'openid', response_type: 'id_token', response_mode: 'form_post', prompt: 'none', client_id: plat.client_id,
      redirect_uri: urlBase + '/lti/launch', login_hint: p.login_hint, state: estado, nonce };
    if (p.lti_message_hint) q.lti_message_hint = p.lti_message_hint;
    for (const [k, v] of Object.entries(q)) u.searchParams.set(k, v);
    return { redirigir: u.toString() };
  }

  // Paso 2: el LMS entrega un mensaje firmado con quién es la persona, su curso y su enlace.
  async function launch(p) {
    exigir(p.id_token && p.state, 400, 'Faltan datos del LMS');
    const fila = await db.uno('estados_lti', { estado: p.state });
    exigir(fila, 400, 'El arranque caducó o ya se usó. Vuelve a abrir la actividad desde el curso.');
    await db.borrar('estados_lti', { estado: p.state }); // un solo uso
    exigir(ahora() - Date.parse(fila.creado) < 10 * MIN, 400, 'El arranque caducó. Vuelve a abrir la actividad desde el curso.');
    const plat = await db.uno('plataformas_lti', { id: fila.plataforma });
    exigir(plat, 400, 'Este LMS no está registrado en el simulador');

    let c;
    try { c = await verificar(p.id_token, async () => (await traer(plat.url_jwks)).json()); }
    catch (e) { throw new Fallo(401, e.message); }
    const aud = Array.isArray(c.aud) ? c.aud : [c.aud];
    exigir(c.iss === plat.emisor, 401, 'El mensaje no viene del LMS registrado');
    exigir(aud.includes(plat.client_id), 401, 'El mensaje no está dirigido a esta herramienta');
    exigir(c.exp * 1000 > ahora() - MIN, 401, 'El mensaje del LMS caducó');
    exigir(c.nonce === fila.nonce, 401, 'El mensaje no corresponde a este arranque');
    exigir(!plat.deployment_id || c[LTI + 'deployment_id'] === plat.deployment_id, 401, 'El despliegue no coincide');
    exigir(c[LTI + 'message_type'] === 'LtiResourceLinkRequest', 400, 'Tipo de mensaje no admitido');
    exigir(c.sub, 400, 'El LMS no identificó a la persona. ¿Estás conectado al curso?');

    const contexto = c[LTI + 'context'] || {}, enlace = c[LTI + 'resource_link'] || {};
    exigir(enlace.id, 400, 'El LMS no indicó qué actividad se abrió');
    const nombre = c.name || [c.given_name, c.family_name].filter(Boolean).join(' ') || null;

    let usuario = await db.uno('usuarios', { plataforma: plat.id, sub: c.sub });
    if (!usuario) { usuario = { id: crypto.randomUUID(), plataforma: plat.id, sub: c.sub, nombre }; await db.insertar('usuarios', usuario); }
    else if (nombre && nombre !== usuario.nombre) await db.actualizar('usuarios', { id: usuario.id }, { nombre });

    const idCurso = contexto.id || 'sin-curso';
    let curso = await db.uno('cursos', { plataforma: plat.id, contexto: idCurso });
    if (!curso) { curso = { id: crypto.randomUUID(), plataforma: plat.id, contexto: idCurso, titulo: contexto.title || null, region: 'es-MX' }; await db.insertar('cursos', curso); }

    const roles = c[LTI + 'roles'] || [];
    let rol = roles.some(r => /(Instructor|Administrator|ContentDeveloper|TeachingAssistant)$/.test(r)) ? 'docente' : 'estudiante';
    if (await db.uno('propietarios', { plataforma: plat.id, sub: c.sub })) rol = 'propietario';
    await db.insertar('inscripciones', { usuario: usuario.id, curso: curso.id, rol }, { conflicto: 'usuario,curso' });

    const ags = c[AGS] || {}, propio = c[LTI + 'custom'] || {};
    let col = await db.uno('colocaciones', { plataforma: plat.id, enlace: enlace.id });
    if (!col) {
      col = { id: crypto.randomUUID(), plataforma: plat.id, curso: curso.id, enlace: enlace.id, titulo: enlace.title || null,
        leccion: null, modo: 'guiado', max_intentos: null, lineitem: ags.lineitem || null };
      if (propio.leccion && await db.uno('lecciones', { id: propio.leccion })) col.leccion = propio.leccion;
      await db.insertar('colocaciones', col);
    } else if (ags.lineitem && ags.lineitem !== col.lineitem) await db.actualizar('colocaciones', { id: col.id }, { lineitem: ags.lineitem });

    // Código de canje de un solo uso: viaja en la dirección solo 60 segundos y no sirve después.
    const codigo = aleatorio(24);
    await db.insertar('sesiones', { id: crypto.randomUUID(), codigo_hash: await sha256(codigo), codigo_expira: iso(ahora() + MIN),
      token_hash: null, expira: iso(ahora() + 8 * 60 * MIN), usuario: usuario.id, curso: curso.id, colocacion: col.id,
      plataforma: plat.id, sub: c.sub, rol, creada: iso() });
    const app = await ajuste('app_url');
    exigir(app, 500, 'Falta indicar la dirección del simulador en la tabla "ajustes"');
    return { redirigir: app + '#c=' + codigo, estado: 303 };
  }

  // Paso 3: la página canjea el código por su pase de sesión.
  async function canjear(cuerpo) {
    exigir(cuerpo && typeof cuerpo.codigo === 'string', 400, 'Falta el código');
    const s = await db.uno('sesiones', { codigo_hash: await sha256(cuerpo.codigo) });
    exigir(s && Date.parse(s.codigo_expira) > ahora(), 401, 'El código caducó. Vuelve a abrir la actividad desde el curso.');
    const token = aleatorio(32);
    await db.actualizar('sesiones', { id: s.id }, { codigo_hash: null, codigo_expira: null, token_hash: await sha256(token) });
    return { cuerpo: { token, expira: s.expira } };
  }

  async function sesionDe(auth) {
    const m = /^Bearer\s+(.+)$/i.exec(auth || '');
    exigir(m, 401, 'Abre esta actividad desde tu curso.');
    const s = await db.uno('sesiones', { token_hash: await sha256(m[1]) });
    exigir(s && Date.parse(s.expira) > ahora(), 401, 'La sesión terminó. Vuelve a abrir la actividad desde tu curso.');
    return s;
  }
  const esDocente = s => s.rol === 'docente' || s.rol === 'propietario';

  // ------------------------------------------------------------ lección
  async function catalogos() {
    const out = {};
    for (const f of await db.lista('catalogos', {})) out[f.clave] = f.datos;
    return out;
  }
  async function resumenIntentos(s) {
    return (await db.lista('intentos', { usuario: s.usuario, colocacion: s.colocacion }, { orden: 'fin.asc' }))
      .map(x => ({ id: x.id, modo: x.modo, nota: Number(x.nota), completo: x.completo, fecha: x.fin }));
  }

  async function leccion(s) {
    const col = await db.uno('colocaciones', { id: s.colocacion });
    const usuario = await db.uno('usuarios', { id: s.usuario });
    // El id sirve para que, en un celular compartido, cada persona guarde lo suyo por separado.
    const quien = { id: s.usuario, nombre: usuario && usuario.nombre, rol: s.rol };
    if (!col.leccion) {
      if (!esDocente(s)) return { cuerpo: { pendiente: true, usuario: quien } };
      return { cuerpo: { configurar: true, usuario: quien, lecciones: await db.lista('lecciones', {}, { columnas: 'id,titulo', orden: 'id.asc' }) } };
    }
    const lec = await db.uno('lecciones', { id: col.leccion });
    exigir(lec, 404, 'La lección asignada ya no existe');
    const curso = await db.uno('cursos', { id: s.curso });
    const region = await db.uno('config_regional', { codigo: (curso && curso.region) || 'es-MX' });
    return { cuerpo: {
      leccion: lec.datos, regional: region ? region.datos : null, catalogos: await catalogos(), usuario: quien,
      colocacion: { modo: col.modo, maxIntentos: col.max_intentos, titulo: col.titulo },
      intentos: await resumenIntentos(s),
      lecciones: esDocente(s) ? await db.lista('lecciones', {}, { columnas: 'id,titulo', orden: 'id.asc' }) : undefined
    } };
  }

  async function configurar(s, cuerpo) {
    exigir(esDocente(s), 403, 'Solo el docente puede elegir la lección');
    exigir(cuerpo && await db.uno('lecciones', { id: cuerpo.leccion }), 400, 'Esa lección no existe');
    const max = Number.isInteger(cuerpo.maxIntentos) && cuerpo.maxIntentos > 0 ? cuerpo.maxIntentos : null;
    await db.actualizar('colocaciones', { id: s.colocacion }, { leccion: cuerpo.leccion, max_intentos: max });
    return { cuerpo: { ok: true } };
  }

  // ------------------------------------------------------------ eventos e intentos
  async function eventos(s, cuerpo) {
    const lista = (cuerpo && Array.isArray(cuerpo.eventos) ? cuerpo.eventos : []).filter(e => e && UUID.test(e.id)).slice(0, 200);
    if (!lista.length) return { cuerpo: { recibidos: 0 } };
    const filas = lista.map(e => {
      const { id, tipo, t, leccion: lec, paso, clase, ...datos } = e;
      return { id, usuario: s.usuario, colocacion: s.colocacion, leccion: lec || null, paso: paso || null,
        tipo: String(tipo || 'evento').slice(0, 40), datos, t_cliente: iso(Number(t) || ahora()), recibido: iso() };
    });
    await db.insertar('eventos', filas, { ignorarDuplicados: true });
    return { cuerpo: { recibidos: filas.length } };
  }

  // ------------------------------------------------------------ seguimiento en vivo
  // Latido: el dispositivo avisa cada medio minuto (y en cada cambio de paso) dónde está.
  async function latido(s, cuerpo) {
    const b = cuerpo || {}, corto = (v, n) => v === undefined || v === null ? null : String(v).slice(0, n);
    const antes = await db.uno('presencia', { usuario: s.usuario, colocacion: s.colocacion });
    const leccion = corto(b.leccion, 80), paso = corto(b.paso, 80);
    const mismoPaso = antes && antes.leccion === leccion && antes.paso === paso && antes.paso_desde;
    await db.insertar('presencia', { usuario: s.usuario, colocacion: s.colocacion, leccion, paso, estado: corto(b.estado, 20),
      dispositivo: b.dispositivo === 'movil' ? 'movil' : 'escritorio', paso_desde: mismoPaso ? antes.paso_desde : iso(), ultimo_latido: iso() },
      { conflicto: 'usuario,colocacion' });
    return { cuerpo: { ok: true } };
  }

  // Datos del panel del docente: quién está conectado, quién está trabado, en qué paso
  // está cada uno, la actividad reciente y el resumen del día. El docente ve sus cursos;
  // el propietario, todos.
  async function monitor(s, q) {
    exigir(esDocente(s), 403, 'Solo el docente puede ver el seguimiento');
    const cuerpo = await datosMonitor(s, q || {});
    // Los textos de la pantalla se piden una sola vez, al abrirla.
    if (q && q.textos) {
      const curso = await db.uno('cursos', { id: s.curso });
      const region = await db.uno('config_regional', { codigo: (curso && curso.region) || 'es-MX' });
      cuerpo.regional = region ? region.datos : null;
    }
    return { cuerpo };
  }

  async function datosMonitor(s, q) {
    const pol = { conectadoSeg: 90, atascoSeg: 180, atascoErrores: 4, latidoSeg: 30,
      ...(((await db.uno('catalogos', { clave: 'politica' })) || {}).datos || {}).monitor };
    const t = ahora();
    let desde = Date.parse((q && q.desde) || '');
    if (!(desde > t - 7 * 24 * 60 * MIN && desde <= t)) desde = t - 24 * 60 * MIN;

    // Cursos que puede ver esta persona.
    let cursos;
    if (s.rol === 'propietario') cursos = await db.lista('cursos', { plataforma: s.plataforma });
    else {
      const mias = (await db.lista('inscripciones', { usuario: s.usuario })).filter(i => i.rol !== 'estudiante').map(i => i.curso);
      cursos = mias.length ? await db.lista('cursos', { id: { en: mias } }) : [];
    }
    const vacio = { cursos: [], actividades: [], conectados: [], recientes: [], resumen: { iniciados: 0, terminados: 0, promedio: null, dificiles: [], errores: [] }, ajustes: pol };
    if (!cursos.length) return vacio;
    const idsCurso = cursos.map(c => c.id);
    const cols = await db.lista('colocaciones', { curso: { en: idsCurso } });
    if (!cols.length) return { ...vacio, cursos: cursos.map(c => ({ id: c.id, titulo: c.titulo })) };
    const idsCol = cols.map(c => c.id);
    const idsLec = [...new Set(cols.map(c => c.leccion).filter(Boolean))];
    const lecs = idsLec.length ? await db.lista('lecciones', { id: { en: idsLec } }) : [];
    const [pres, evs, ints, ins] = await Promise.all([
      db.lista('presencia', { colocacion: { en: idsCol }, ultimo_latido: { desde: iso(t - pol.conectadoSeg * 1000) } }),
      db.lista('eventos', { colocacion: { en: idsCol }, t_cliente: { desde: iso(desde) } }, { orden: 't_cliente.asc', limite: 20000 }),
      db.lista('intentos', { colocacion: { en: idsCol }, fin: { desde: iso(desde) } }),
      db.lista('inscripciones', { curso: { en: idsCurso } })
    ]);
    // Solo cuentan los estudiantes: las pruebas de los docentes no ensucian el panel.
    const noEstudiantes = new Set(ins.filter(i => i.rol !== 'estudiante').map(i => i.usuario));
    const esEst = x => !noEstudiantes.has(x.usuario);
    const presE = pres.filter(esEst), evsE = evs.filter(esEst), intsE = ints.filter(esEst);
    const idsUsu = [...new Set([...presE, ...evsE].map(x => x.usuario))];
    const usuarios = idsUsu.length ? await db.lista('usuarios', { id: { en: idsUsu } }) : [];
    const nombre = id => ((usuarios.find(u => u.id === id) || {}).nombre) || 'Sin nombre';
    const colDe = id => cols.find(c => c.id === id) || {};
    const lecDe = id => lecs.find(l => l.id === id);
    const pasosDe = id => { const l = lecDe(id); return l && Array.isArray(l.datos.pasos) ? l.datos.pasos : []; };
    // Nombre corto de un paso: su título o, si no tiene, el comienzo de la instrucción.
    const nombrePaso = p => { if (p.titulo) return p.titulo; const t = String(p.instruccion || p.id).split(/(?<=[.!?])\s/)[0]; return t.length > 70 ? t.slice(0, 67).trimEnd() + '…' : t; };
    const tituloPaso = (lec, paso) => { const p = pasosDe(lec).find(x => x.id === paso); return p ? nombrePaso(p) : paso; };
    const cursoDe = id => (cursos.find(c => c.id === id) || {}).titulo || '';
    const ms = x => Date.parse(x);

    const conectados = presE.map(p => {
      const pasos = pasosDe(p.leccion), n = pasos.findIndex(x => x.id === p.paso);
      const errores = evsE.filter(e => e.usuario === p.usuario && e.colocacion === p.colocacion && e.paso === p.paso && e.tipo === 'paso_intento'
        && e.datos && e.datos.correcto === false && (!p.paso_desde || ms(e.t_cliente) >= ms(p.paso_desde))).length;
      const seg = p.paso_desde ? Math.max(0, Math.round((t - ms(p.paso_desde)) / 1000)) : null;
      const trabado = p.estado === 'guiado' && ((seg !== null && seg >= pol.atascoSeg) || errores >= pol.atascoErrores);
      return { usuario: p.usuario, nombre: nombre(p.usuario), actividad: p.colocacion, curso: cursoDe(colDe(p.colocacion).curso),
        leccion: (lecDe(p.leccion) || {}).titulo || p.leccion, paso: p.paso, pasoTitulo: p.paso ? tituloPaso(p.leccion, p.paso) : null,
        pasoNumero: n >= 0 ? n + 1 : null, pasosTotal: pasos.length, estado: p.estado, dispositivo: p.dispositivo,
        segundosPaso: seg, errores, trabado, ultimo: p.ultimo_latido };
    }).sort((a, b) => (b.trabado - a.trabado) || a.nombre.localeCompare(b.nombre));

    // Mapa: cuántos conectados hay en cada paso de cada actividad.
    const actividades = cols.filter(c => c.leccion).map(c => {
      const aqui = conectados.filter(x => x.actividad === c.id);
      return { id: c.id, titulo: c.titulo, curso: cursoDe(c.curso), leccion: (lecDe(c.leccion) || {}).titulo || c.leccion,
        conectados: aqui.length,
        pasos: pasosDe(c.leccion).map((p, i) => ({ numero: i + 1, titulo: nombrePaso(p),
          personas: aqui.filter(x => x.paso === p.id && ['guiado', 'checkpoint', 'pausa', 'microdemo'].includes(x.estado)).map(x => x.nombre) })),
        fuera: aqui.filter(x => !['guiado', 'checkpoint', 'pausa', 'microdemo'].includes(x.estado)).map(x => ({ nombre: x.nombre, estado: x.estado })) };
    }).filter(a => a.conectados || evsE.some(e => e.colocacion === a.id));

    const VISIBLES = ['leccion_inicio', 'paso_completado', 'pista_solicitada', 'muestrame', 'checkpoint_respuesta', 'intento_fin'];
    const recientes = evsE.filter(e => VISIBLES.includes(e.tipo)).slice(-40).reverse().map(e => ({
      t: e.t_cliente, nombre: nombre(e.usuario), tipo: e.tipo, actividad: colDe(e.colocacion).titulo,
      paso: e.paso ? tituloPaso(e.leccion, e.paso) : null, datos: e.datos || {} }));

    // Resumen: dificultad de cada paso = cuántos lo lograron al primer intento, sin pistas.
    const porPaso = new Map();
    for (const e of evsE.filter(x => x.tipo === 'paso_completado')) {
      const k = e.leccion + '|' + e.paso, d = e.datos || {};
      const v = porPaso.get(k) || { leccion: (lecDe(e.leccion) || {}).titulo || e.leccion, paso: tituloPaso(e.leccion, e.paso), veces: 0, primera: 0, ms: [] };
      v.veces++; if (!d.errores && !d.pista && !d.muestrame) v.primera++; if (d.ms) v.ms.push(d.ms);
      porPaso.set(k, v);
    }
    const mediana = a => { if (!a.length) return null; const b = [...a].sort((x, y) => x - y); return b[Math.floor(b.length / 2)]; };
    const dificiles = [...porPaso.values()].map(v => ({ leccion: v.leccion, paso: v.paso, veces: v.veces,
      primeraPct: Math.round(100 * v.primera / v.veces), segundos: v.ms.length ? Math.round(mediana(v.ms) / 1000) : null }))
      .sort((a, b) => a.primeraPct - b.primeraPct || b.veces - a.veces).slice(0, 5);
    const cuenta = new Map();
    for (const e of evsE) if (e.tipo === 'paso_intento' && e.datos && e.datos.errorComun) cuenta.set(e.datos.errorComun, (cuenta.get(e.datos.errorComun) || 0) + 1);
    const textos = ((await db.uno('catalogos', { clave: 'errores_comunes' })) || {}).datos || {};
    const errores = [...cuenta].sort((a, b) => b[1] - a[1]).slice(0, 5).map(([id, veces]) => ({ id, texto: textos[id] || id, veces }));
    const notas = intsE.filter(x => x.completo).map(x => Number(x.nota));

    return {
      cursos: cursos.map(c => ({ id: c.id, titulo: c.titulo })), actividades, conectados, recientes, ajustes: pol,
      resumen: { iniciados: evsE.filter(e => e.tipo === 'leccion_inicio').length, terminados: intsE.length,
        promedio: notas.length ? Math.round(notas.reduce((a, b) => a + b, 0) / notas.length) : null, dificiles, errores }
    };
  }

  // La nota se vuelve a calcular aquí con las reglas guardadas, no se confía en la que envía el dispositivo.
  function calcularNota(lec, pol, modo, detalle) {
    const res = (detalle && detalle.res) || [], cp = (detalle && detalle.cpRes) || {};
    const pasos = modo === 'reto' ? [{ id: 'reto', puntos: (lec.reto && lec.reto.puntos) || 100 }] : (lec.pasos || []);
    let total = 0, logrado = 0;
    for (const p of pasos) {
      const pts = p.puntos === undefined ? 10 : p.puntos, r = res.find(x => x && x.id === p.id);
      total += pts;
      if (!r || !r.hecho) continue;
      let pct;
      if (r.muestrame) pct = pol.muestrame;
      else {
        const pista = r.pista ? pol.descuentoPista[Math.min(r.pista, pol.descuentoPista.length) - 1] : 0;
        pct = Math.max(pol.minimo, 100 - pol.descuentoPorError * Math.max(0, (r.errores || 0) - pol.erroresSinCosto) - pista);
      }
      logrado += pts * pct / 100;
    }
    if (modo !== 'reto') for (const c of lec.checkpoints || []) { if (c.puntos) { total += c.puntos; if (cp[c.id]) logrado += c.puntos; } }
    return total ? Math.round(100 * logrado / total) : 0;
  }

  async function intento(s, cuerpo) {
    exigir(cuerpo && UUID.test(cuerpo.id), 400, 'Intento sin identificador');
    const col = await db.uno('colocaciones', { id: s.colocacion });
    const lec = col.leccion && await db.uno('lecciones', { id: col.leccion });
    const pol = (await db.uno('catalogos', { clave: 'politica' }) || {}).datos;
    const modo = cuerpo.modo === 'reto' ? 'reto' : 'guiado';
    const nota = lec && pol ? calcularNota(lec.datos, pol, modo, cuerpo.detalle) : Math.max(0, Math.min(100, Math.round(Number(cuerpo.nota) || 0)));
    await db.insertar('intentos', { id: cuerpo.id, usuario: s.usuario, colocacion: s.colocacion, leccion: col.leccion, modo, nota,
      completo: cuerpo.completo !== false, detalle: cuerpo.detalle || null, fin: iso() }, { ignorarDuplicados: true });
    const todos = await resumenIntentos(s);
    const promedio = todos.length ? Math.round(todos.reduce((a, x) => a + x.nota, 0) / todos.length) : nota;
    let enviada = false, motivo = null;
    if (col.lineitem) {
      try { await enviarNota(s, col.lineitem, promedio); enviada = true; }
      catch (e) { motivo = e.message; } // se reintenta con el siguiente intento
    }
    return { cuerpo: { nota, promedio, intentos: todos, enviada, motivo } };
  }

  // Envía el promedio al libro de calificaciones del LMS (servicio de calificaciones de LTI).
  async function enviarNota(s, lineitem, promedio) {
    const plat = await db.uno('plataformas_lti', { id: s.plataforma });
    const k = await claveHerramienta(), ya = Math.floor(ahora() / 1000);
    const prueba = await firmar({ iss: plat.client_id, sub: plat.client_id, aud: plat.url_token, iat: ya, exp: ya + 300, jti: aleatorio(12) }, k.privada, k.kid);
    const r = await traer(plat.url_token, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ grant_type: 'client_credentials', client_assertion_type: 'urn:ietf:params:oauth:client-assertion-type:jwt-bearer',
        client_assertion: prueba, scope: ALCANCE_NOTA }).toString() });
    if (!r.ok) throw new Error('El LMS no autorizó el envío de la nota (' + r.status + ')');
    const pase = (await r.json()).access_token;
    const [base, consulta] = lineitem.split('?');
    const r2 = await traer(base.replace(/\/$/, '') + '/scores' + (consulta ? '?' + consulta : ''), { method: 'POST',
      headers: { Authorization: 'Bearer ' + pase, 'Content-Type': 'application/vnd.ims.lis.v1.score+json' },
      body: JSON.stringify({ userId: s.sub, scoreGiven: promedio, scoreMaximum: 100, activityProgress: 'Completed', gradingProgress: 'FullyGraded', timestamp: iso() }) });
    if (!r2.ok) throw new Error('El LMS no aceptó la nota (' + r2.status + ')');
  }

  // ------------------------------------------------------------ entrada única
  // pedido = { metodo, ruta, consulta, cuerpo, auth, origen }
  async function atender(pedido) {
    const app = await ajuste('app_url'), extra = (await ajuste('origenes_extra')) || '';
    const permitidos = [app, ...extra.split(',')].filter(Boolean).map(u => { try { return new URL(u.trim()).origin; } catch (_) { return null; } });
    const cabeceras = {};
    if (pedido.origen && permitidos.includes(pedido.origen)) {
      cabeceras['Access-Control-Allow-Origin'] = pedido.origen;
      cabeceras['Access-Control-Allow-Headers'] = 'authorization, content-type';
      cabeceras['Access-Control-Allow-Methods'] = 'GET, POST, OPTIONS';
      cabeceras['Vary'] = 'Origin';
    }
    if (pedido.metodo === 'OPTIONS') return { estado: 204, cabeceras };
    try {
      const datos = { ...(pedido.consulta || {}), ...(pedido.cuerpo || {}) };
      let r;
      switch (pedido.ruta) {
        case '/lti/jwks': r = await jwks(); break;
        case '/lti/login': r = await login(datos); break;
        case '/lti/launch': r = await launch(datos); break;
        case '/sesion': r = await canjear(pedido.cuerpo); break;
        case '/leccion': r = await leccion(await sesionDe(pedido.auth)); break;
        case '/colocacion': r = await configurar(await sesionDe(pedido.auth), pedido.cuerpo); break;
        case '/eventos': r = await eventos(await sesionDe(pedido.auth), pedido.cuerpo); break;
        case '/intento': r = await intento(await sesionDe(pedido.auth), pedido.cuerpo); break;
        case '/latido': r = await latido(await sesionDe(pedido.auth), pedido.cuerpo); break;
        case '/monitor': r = await monitor(await sesionDe(pedido.auth), pedido.consulta); break;
        default: throw new Fallo(404, 'Ruta desconocida');
      }
      return { estado: r.estado || (r.redirigir ? 302 : 200), cabeceras, ...r };
    } catch (e) {
      if (e instanceof Fallo) return { estado: e.estado, cabeceras, cuerpo: { error: e.message } };
      return { estado: 500, cabeceras, cuerpo: { error: 'Error interno del servidor', detalle: String(e && e.message).slice(0, 200) } };
    }
  }

  return { atender, calcularNota };
}
