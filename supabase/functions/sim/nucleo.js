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
    const quien = { nombre: usuario && usuario.nombre, rol: s.rol };
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
    const u = filas[filas.length - 1];
    await db.insertar('presencia', { usuario: s.usuario, colocacion: s.colocacion, leccion: u.leccion, paso: u.paso, estado: u.tipo, ultimo_latido: iso() },
      { conflicto: 'usuario,colocacion' });
    return { cuerpo: { recibidos: filas.length } };
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
