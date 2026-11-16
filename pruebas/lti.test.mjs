// Pruebas del servidor con un Moodle simulado y una base de datos en memoria.
// Ejecutar con:  node pruebas/lti.test.mjs
import { readFileSync } from 'node:fs';
import { crearNucleo } from '../supabase/functions/sim/nucleo.js';
import { firmar, verificar, generarClave } from '../supabase/functions/sim/jwt.js';
import reg from '../js/regional/es-MX.js';
import { POLITICA } from '../js/leccion/catalogos.js';

const leccion = JSON.parse(readFileSync(new URL('../lecciones/ejemplo-funcion-si.json', import.meta.url)));
let fallos = 0, total = 0;
function igual(nombre, real, esperado) {
  total++;
  if (real !== esperado) { fallos++; console.log('FALLA  ' + nombre + '  esperado=' + JSON.stringify(esperado) + ' obtenido=' + JSON.stringify(real)); }
}

import { crearMemoria } from './memoria.mjs';
const memoria = () => crearMemoria({ estricta: true });

// ---- Moodle simulado ----
const MOODLE = 'https://moodle.prueba', FUNCION = 'https://proyecto.supabase.co/functions/v1/sim', APP = 'https://usuario.github.io/simulador/';
const llaveMoodle = await generarClave();
const notasRecibidas = [];
let nucleo;
async function traer(url, opc = {}) {
  const ok = (cuerpo, estado = 200) => ({ ok: estado < 300, status: estado, json: async () => cuerpo, text: async () => JSON.stringify(cuerpo) });
  if (url === MOODLE + '/mod/lti/certs.php') return ok({ keys: [{ ...llaveMoodle.publica, kid: llaveMoodle.kid }] });
  if (url === MOODLE + '/mod/lti/token.php') {
    const p = new URLSearchParams(opc.body);
    // Moodle comprueba que la petición viene firmada por la herramienta registrada
    const c = await verificar(p.get('client_assertion'), async () => (await nucleo.atender({ metodo: 'GET', ruta: '/lti/jwks' })).cuerpo);
    if (c.iss !== 'cliente-123' || c.aud !== url) return ok({ error: 'invalid_client' }, 400);
    return ok({ access_token: 'pase-de-moodle', token_type: 'Bearer' });
  }
  if (url.startsWith(MOODLE + '/mod/lti/services.php/4/lineitems/9/lineitem/scores')) {
    if (opc.headers.Authorization !== 'Bearer pase-de-moodle') return ok({}, 401);
    notasRecibidas.push({ url, ...JSON.parse(opc.body) });
    return ok({});
  }
  return ok({}, 404);
}

const db = memoria();
let reloj = Date.parse('2026-11-16T15:00:00Z');
nucleo = crearNucleo({ db, traer, ahora: () => reloj, urlBase: FUNCION });
await db.insertar('ajustes', [{ clave: 'app_url', valor: APP }, { clave: 'origenes_extra', valor: 'http://localhost:8123' }], { conflicto: 'clave' });
await db.insertar('plataformas_lti', { id: 'plat-1', nombre: 'Moodle de prueba', emisor: MOODLE, client_id: 'cliente-123', deployment_id: '7',
  url_login: MOODLE + '/mod/lti/auth.php', url_jwks: MOODLE + '/mod/lti/certs.php', url_token: MOODLE + '/mod/lti/token.php' });
await db.insertar('config_regional', { codigo: 'es-MX', datos: JSON.parse(JSON.stringify(reg)) }, { conflicto: 'codigo' });
await db.insertar('catalogos', { clave: 'politica', datos: POLITICA }, { conflicto: 'clave' });
await db.insertar('lecciones', { id: leccion.identidad.id, titulo: leccion.identidad.titulo, datos: leccion });

const ROL = 'http://purl.imsglobal.org/vocab/lis/v2/membership#';
async function arrancar({ sub, nombre, rol, cambios = {}, alterar }) {
  const r1 = await nucleo.atender({ metodo: 'POST', ruta: '/lti/login', cuerpo: { iss: MOODLE, login_hint: sub, client_id: 'cliente-123', lti_message_hint: 'x', target_link_uri: FUNCION + '/lti/launch' } });
  const u = new URL(r1.redirigir);
  const ya = Math.floor(reloj / 1000);
  let token = await firmar({
    iss: MOODLE, aud: 'cliente-123', sub, name: nombre, iat: ya, exp: ya + 60, nonce: u.searchParams.get('nonce'),
    'https://purl.imsglobal.org/spec/lti/claim/message_type': 'LtiResourceLinkRequest',
    'https://purl.imsglobal.org/spec/lti/claim/version': '1.3.0',
    'https://purl.imsglobal.org/spec/lti/claim/deployment_id': '7',
    'https://purl.imsglobal.org/spec/lti/claim/roles': [ROL + rol],
    'https://purl.imsglobal.org/spec/lti/claim/context': { id: 'curso-37', title: 'Excel básico' },
    'https://purl.imsglobal.org/spec/lti/claim/resource_link': { id: 'enlace-1', title: 'Práctica: función SI' },
    'https://purl.imsglobal.org/spec/lti-ags/claim/endpoint': { lineitem: MOODLE + '/mod/lti/services.php/4/lineitems/9/lineitem?type_id=2', scope: ['https://purl.imsglobal.org/spec/lti-ags/scope/score'] },
    ...cambios
  }, llaveMoodle.privada, llaveMoodle.kid);
  if (alterar) token = alterar(token);
  const r2 = await nucleo.atender({ metodo: 'POST', ruta: '/lti/launch', cuerpo: { id_token: token, state: u.searchParams.get('state') } });
  return { login: u, r1, r2, token, estado: u.searchParams.get('state') };
}
const pedir = (ruta, pase, cuerpo, origen) => nucleo.atender({ metodo: cuerpo ? 'POST' : 'GET', ruta, cuerpo, auth: pase && 'Bearer ' + pase, origen });
async function entrar(datos) {
  const a = await arrancar(datos);
  const codigo = a.r2.redirigir.split('#c=')[1];
  return (await pedir('/sesion', null, { codigo })).cuerpo.token;
}

// ---- 1. arranque ----
const a = await arrancar({ sub: 'est-1', nombre: 'Ana Flores', rol: 'Learner' });
igual('login redirige al Moodle', a.login.origin + a.login.pathname, MOODLE + '/mod/lti/auth.php');
igual('login pide volver a la función', a.login.searchParams.get('redirect_uri'), FUNCION + '/lti/launch');
igual('login no depende de cookies: el estado queda en la base', db.tablas.estados_lti.length, 0); // ya se consumió en el launch
igual('launch redirige al simulador', a.r2.estado, 303);
igual('launch entrega un código en el fragmento', a.r2.redirigir.startsWith(APP + '#c='), true);
igual('launch crea el usuario', db.tablas.usuarios[0].nombre, 'Ana Flores');
igual('launch crea el curso', db.tablas.cursos[0].contexto, 'curso-37');
igual('launch crea la colocación con destino de nota', !!db.tablas.colocaciones[0].lineitem, true);

// ---- 2. ataques y errores ----
const repetido = await nucleo.atender({ metodo: 'POST', ruta: '/lti/launch', cuerpo: { id_token: a.token, state: a.estado } });
igual('un arranque no se puede reutilizar', repetido.estado, 400);
const falso = await arrancar({ sub: 'est-1', nombre: 'X', rol: 'Learner', alterar: t => { const p = t.split('.'); p[1] = p[1].slice(0, -2) + 'AA'; return p.join('.'); } });
igual('mensaje alterado se rechaza', falso.r2.estado, 401);
const otroNonce = await arrancar({ sub: 'est-1', nombre: 'X', rol: 'Learner', cambios: { nonce: 'inventado' } });
igual('nonce distinto se rechaza', otroNonce.r2.estado, 401);
const otroDestino = await arrancar({ sub: 'est-1', nombre: 'X', rol: 'Learner', cambios: { aud: 'otra-herramienta' } });
igual('mensaje para otra herramienta se rechaza', otroDestino.r2.estado, 401);
const otroEmisor = await arrancar({ sub: 'est-1', nombre: 'X', rol: 'Learner', cambios: { iss: 'https://impostor.example' } });
igual('emisor distinto se rechaza', otroEmisor.r2.estado, 401);
const desconocido = await nucleo.atender({ metodo: 'POST', ruta: '/lti/login', cuerpo: { iss: 'https://otro.moodle', login_hint: '1' } });
igual('LMS no registrado se rechaza', desconocido.estado, 400);

// ---- 3. sesión ----
const codigo = a.r2.redirigir.split('#c=')[1];
const s1 = await pedir('/sesion', null, { codigo });
igual('el código se canjea por un pase', typeof s1.cuerpo.token, 'string');
igual('el código no sirve dos veces', (await pedir('/sesion', null, { codigo })).estado, 401);
igual('el pase no se guarda en claro', db.tablas.sesiones.some(x => x.token_hash === s1.cuerpo.token), false);
const paseEst = s1.cuerpo.token;
igual('sin pase no hay lección', (await pedir('/leccion')).estado, 401);
igual('pase inventado se rechaza', (await pedir('/leccion', 'inventado')).estado, 401);
const b = await arrancar({ sub: 'est-2', nombre: 'Luis', rol: 'Learner' });
reloj += 2 * 60000;
igual('código caducado (más de 60 s) se rechaza', (await pedir('/sesion', null, { codigo: b.r2.redirigir.split('#c=')[1] })).estado, 401);

// ---- 4. lección y configuración por el docente ----
igual('enlace sin configurar: el estudiante ve "pendiente"', (await pedir('/leccion', paseEst)).cuerpo.pendiente, true);
igual('el estudiante no puede elegir la lección', (await pedir('/colocacion', paseEst, { leccion: leccion.identidad.id })).estado, 403);
const paseDoc = await entrar({ sub: 'doc-1', nombre: 'Docente', rol: 'Instructor' });
const conf = await pedir('/leccion', paseDoc);
igual('el docente ve el selector de lecciones', conf.cuerpo.configurar, true);
igual('el selector lista las lecciones', conf.cuerpo.lecciones[0].id, leccion.identidad.id);
igual('lección inexistente se rechaza', (await pedir('/colocacion', paseDoc, { leccion: 'no-existe' })).estado, 400);
igual('el docente elige la lección', (await pedir('/colocacion', paseDoc, { leccion: leccion.identidad.id, maxIntentos: 3 })).cuerpo.ok, true);
const paquete = (await pedir('/leccion', paseEst)).cuerpo;
igual('el estudiante recibe la lección', paquete.leccion.identidad.id, leccion.identidad.id);
igual('recibe la configuración regional', paquete.regional.sepArg, ';');
igual('recibe los catálogos', paquete.catalogos.politica.minimo, POLITICA.minimo);
igual('recibe su nombre y rol', paquete.usuario.nombre + '|' + paquete.usuario.rol, 'Ana Flores|estudiante');
igual('recibe el máximo de intentos', paquete.colocacion.maxIntentos, 3);
igual('recibe su identificador para separar lo guardado en el dispositivo', paquete.usuario.id, db.tablas.usuarios[0].id);
igual('el segundo enlace del mismo curso no duplica el curso', db.tablas.cursos.length, 1);

// ---- 5. eventos ----
const ev = [
  { id: '11111111-1111-4111-8111-111111111111', tipo: 'paso_inicio', t: reloj, leccion: 'L07-funcion-si', paso: 'p1' },
  { id: '22222222-2222-4222-8222-222222222222', tipo: 'paso_intento', t: reloj, leccion: 'L07-funcion-si', paso: 'p1', correcto: false, errorComun: 'valor-en-vez-de-formula' }
];
igual('eventos recibidos', (await pedir('/eventos', paseEst, { eventos: ev })).cuerpo.recibidos, 2);
await pedir('/eventos', paseEst, { eventos: ev });
igual('reenviar los mismos eventos no los duplica', db.tablas.eventos.length, 2);
igual('los datos del evento se conservan', db.tablas.eventos[1].datos.errorComun, 'valor-en-vez-de-formula');
igual('eventos sin identificador válido se descartan', (await pedir('/eventos', paseEst, { eventos: [{ id: 'x', tipo: 'a' }] })).cuerpo.recibidos, 0);

// ---- 6. intentos y nota hacia Moodle ----
const perfecto = { res: leccion.pasos.map(p => ({ id: p.id, hecho: true, errores: 0, pista: 0, muestrame: false })), cpRes: { c1: true } };
const i1 = await pedir('/intento', paseEst, { id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', modo: 'guiado', nota: 5, completo: true, detalle: perfecto });
igual('la nota la calcula el servidor, no el dispositivo', i1.cuerpo.nota, 100);
igual('la nota se envió a Moodle', i1.cuerpo.enviada, true);
igual('Moodle recibió 100', notasRecibidas[0].scoreGiven, 100);
igual('la nota va al estudiante correcto', notasRecibidas[0].userId, 'est-1');
igual('la dirección de envío conserva sus parámetros', notasRecibidas[0].url, MOODLE + '/mod/lti/services.php/4/lineitems/9/lineitem/scores?type_id=2');
const flojo = { res: leccion.pasos.map((p, k) => ({ id: p.id, hecho: k < 2, errores: 5, pista: 3, muestrame: false })), cpRes: {} };
const i2 = await pedir('/intento', paseEst, { id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', modo: 'guiado', nota: 100, completo: false, detalle: flojo });
igual('intento incompleto: nota baja aunque el dispositivo diga 100', i2.cuerpo.nota, 8);
igual('el promedio incluye todos los intentos', i2.cuerpo.promedio, 54);
igual('Moodle recibe el promedio', notasRecibidas[1].scoreGiven, 54);
await pedir('/intento', paseEst, { id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', modo: 'guiado', detalle: flojo });
igual('reenviar un intento no lo duplica', db.tablas.intentos.length, 2);
igual('la lección informa los intentos previos', (await pedir('/leccion', paseEst)).cuerpo.intentos.length, 2);

// ---- 7. seguimiento en vivo ----
const latir = (pase, paso, estado = 'guiado') => pedir('/latido', pase, { leccion: 'L07-funcion-si', paso, estado, dispositivo: 'movil' });
igual('el latido se acepta', (await latir(paseEst, 'p1')).cuerpo.ok, true);
const pres = () => db.tablas.presencia.find(x => x.paso !== undefined && db.tablas.usuarios.find(u => u.id === x.usuario).sub === 'est-1');
igual('el latido registra el paso', pres().paso, 'p1');
igual('el latido registra el equipo', pres().dispositivo, 'movil');
const desde1 = pres().paso_desde;
reloj += 60000; await latir(paseEst, 'p1');
igual('en el mismo paso no se reinicia el tiempo', pres().paso_desde, desde1);
igual('el estudiante no ve el seguimiento', (await pedir('/monitor', paseEst)).estado, 403);
await latir(paseDoc, 'p1'); // el docente probando no debe aparecer
let m = (await pedir('/monitor', paseDoc)).cuerpo;
igual('el docente ve a la estudiante conectada', m.conectados.length + '|' + m.conectados[0].nombre, '1|Ana Flores');
igual('ve en qué paso está', m.conectados[0].pasoNumero + ' de ' + m.conectados[0].pasosTotal, '1 de ' + leccion.pasos.length);
igual('cuenta los errores del paso actual', m.conectados[0].errores, 1);
igual('todavía no está trabada', m.conectados[0].trabado, false);
igual('el mapa ubica a la estudiante en el paso 1', m.actividades[0].pasos[0].personas.join(), 'Ana Flores');
igual('el resumen cuenta los intentos terminados', m.resumen.terminados, 2);
igual('el promedio usa solo los intentos completos', m.resumen.promedio, 100);
igual('el resumen lista los errores frecuentes', m.resumen.errores[0].id + '|' + m.resumen.errores[0].veces, 'valor-en-vez-de-formula|1');
reloj += 3 * 60000; await latir(paseEst, 'p1');
m = (await pedir('/monitor', paseDoc)).cuerpo;
igual('más de 3 minutos en el paso: aparece trabada', m.conectados[0].trabado, true);
await latir(paseEst, 'p2');
await pedir('/eventos', paseEst, { eventos: [{ id: '33333333-3333-4333-8333-333333333333', tipo: 'paso_completado', t: reloj, leccion: 'L07-funcion-si', paso: 'p1', errores: 2, ms: 240000 }] });
m = (await pedir('/monitor', paseDoc)).cuerpo;
igual('al cambiar de paso el tiempo empieza de nuevo', m.conectados[0].trabado + '|' + m.conectados[0].segundosPaso, 'false|0');
igual('la actividad reciente muestra el paso completado', m.recientes[0].tipo + '|' + m.recientes[0].nombre, 'paso_completado|Ana Flores');
igual('paso con errores: 0 % de acierto al primer intento', m.resumen.dificiles[0].primeraPct, 0);
igual('los textos se piden solo al abrir', (await pedir('/monitor', paseDoc)).cuerpo.regional, undefined);
igual('al abrir llegan los textos de la región', !!(await nucleo.atender({ metodo: 'GET', ruta: '/monitor', consulta: { textos: '1' }, auth: 'Bearer ' + paseDoc })).cuerpo.regional, true);
reloj += 2 * 60000;
igual('sin latidos por 2 minutos: deja de figurar conectada', (await pedir('/monitor', paseDoc)).cuerpo.conectados.length, 0);

// ---- 8. permisos de origen ----
igual('origen permitido recibe permiso', (await pedir('/leccion', paseEst, null, 'https://usuario.github.io')).cabeceras['Access-Control-Allow-Origin'], 'https://usuario.github.io');
igual('origen extra permitido', (await pedir('/leccion', paseEst, null, 'http://localhost:8123')).cabeceras['Access-Control-Allow-Origin'], 'http://localhost:8123');
igual('origen ajeno no recibe permiso', (await pedir('/leccion', paseEst, null, 'https://malo.example')).cabeceras['Access-Control-Allow-Origin'], undefined);
reloj += 9 * 3600000;
igual('la sesión caduca a las 8 horas', (await pedir('/leccion', paseEst)).estado, 401);

console.log(fallos ? `\n${fallos} de ${total} pruebas fallaron` : `Las ${total} pruebas pasaron`);
process.exit(fallos ? 1 : 0);
