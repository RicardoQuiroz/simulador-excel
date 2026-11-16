// Servidor de ensayo: el simulador + su servidor real + un Moodle de mentira, todo en esta
// computadora y con la base de datos en memoria (se borra al cerrar). Sirve para probar la
// entrada desde "Moodle", la elección de lección, los intentos y el envío de notas sin
// tener todavía Supabase ni Moodle configurados.
//
//   Uso:  node pruebas/servidor-lti.mjs      y abrir  http://localhost:8130/moodle
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { crearNucleo } from '../supabase/functions/sim/nucleo.js';
import { firmar, generarClave } from '../supabase/functions/sim/jwt.js';
import reg from '../js/regional/es-MX.js';
import { POLITICA, MENSAJES, ERRORES_COMUNES, ERRORES_UNIVERSALES, SONIDOS } from '../js/leccion/catalogos.js';

const RAIZ = resolve(fileURLToPath(new URL('..', import.meta.url)));
const PUERTO = Number(process.env.PORT) || 8130;
const AQUI = 'http://localhost:' + PUERTO, MOODLE = AQUI + '/moodle';
const TIPOS = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8', '.svg': 'image/svg+xml', '.webp': 'image/webp' };

import { crearMemoria } from './memoria.mjs';
const db = crearMemoria();

// ---- Moodle de mentira ----
const llave = await generarClave();
const notas = [];
async function traer(url, opc = {}) {
  const ok = (cuerpo, estado = 200) => ({ ok: estado < 300, status: estado, json: async () => cuerpo, text: async () => JSON.stringify(cuerpo) });
  if (url === MOODLE + '/certs.php') return ok({ keys: [{ ...llave.publica, kid: llave.kid }] });
  if (url === MOODLE + '/token.php') return ok({ access_token: 'pase', token_type: 'Bearer' });
  if (url.startsWith(MOODLE + '/notas/')) { notas.push({ actividad: url.split('/notas/')[1].split('/')[0], ...JSON.parse(opc.body) }); return ok({}); }
  return ok({}, 404);
}
const nucleo = crearNucleo({ db, traer, urlBase: AQUI + '/sim' });

const PERSONAS = { ana: ['Ana Flores', 'Learner'], luis: ['Luis Mamani', 'Learner'], docente: ['Docente de prueba', 'Instructor'] };
const leccion = JSON.parse(await readFile(join(RAIZ, 'lecciones', 'ejemplo-funcion-si.json'), 'utf8'));
await db.insertar('ajustes', { clave: 'app_url', valor: AQUI + '/' }, { conflicto: 'clave' });
await db.insertar('plataformas_lti', { id: 'plat-1', nombre: 'Moodle de mentira', emisor: MOODLE, client_id: 'cliente-ensayo', deployment_id: '1',
  url_login: MOODLE + '/auth.php', url_jwks: MOODLE + '/certs.php', url_token: MOODLE + '/token.php' });
await db.insertar('config_regional', { codigo: 'es-MX', datos: JSON.parse(JSON.stringify(reg)) }, { conflicto: 'codigo' });
for (const [clave, datos] of Object.entries({ politica: POLITICA, mensajes: MENSAJES, errores_comunes: ERRORES_COMUNES, errores_universales: ERRORES_UNIVERSALES, sonidos: SONIDOS }))
  await db.insertar('catalogos', { clave, datos }, { conflicto: 'clave' });
await db.insertar('lecciones', { id: leccion.identidad.id, titulo: leccion.identidad.titulo, datos: leccion });

const pagina = (titulo, cuerpo) => `<!doctype html><html lang="es"><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${titulo}</title>
<style>body{font:15px/1.5 system-ui,sans-serif;max-width:640px;margin:30px auto;padding:0 16px;color:#222}a.b{display:inline-block;margin:4px 6px 4px 0;padding:8px 14px;background:#f98012;color:#fff;border-radius:5px;text-decoration:none}
h1{font-size:20px}h2{font-size:16px;margin-top:22px}table{border-collapse:collapse}td,th{border:1px solid #ccc;padding:4px 10px;text-align:left}small{color:#666}</style>
<h1>${titulo}</h1>${cuerpo}</html>`;

async function moodle(url, res) {
  const ruta = url.pathname.slice('/moodle'.length) || '/';
  const html = t => { res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' }); res.end(t); };
  if (ruta === '/') {
    const fila = (act, titulo) => `<h2>${titulo}</h2>` + Object.entries(PERSONAS).map(([k, [n]]) => `<a class="b" href="/moodle/abrir?actividad=${act}&quien=${k}">Entrar como ${n}</a>`).join('');
    return html(pagina('Moodle de mentira: curso "Excel básico"',
      `<p>Esta página imita un curso de Moodle. Cada botón equivale a que esa persona haga clic en la actividad dentro del curso.</p>
       ${fila('enlace-1', 'Actividad 1: Práctica de la función SI')}${fila('enlace-2', 'Actividad 2: otra práctica (todavía sin lección)')}
       <h2>Libro de calificaciones</h2><p><a href="/moodle/calificaciones">Ver las notas que el simulador envió</a></p>
       <p><small>Los datos viven en la memoria de este programa y se borran al cerrarlo.</small></p>`));
  }
  if (ruta === '/calificaciones') {
    const filas = notas.map(n => `<tr><td>${n.actividad}</td><td>${n.userId}</td><td>${n.scoreGiven} / ${n.scoreMaximum}</td><td>${n.timestamp}</td></tr>`).join('');
    return html(pagina('Libro de calificaciones (de mentira)', `<table><tr><th>Actividad</th><th>Persona</th><th>Nota</th><th>Recibida</th></tr>${filas || '<tr><td colspan="4">Todavía no llegó ninguna nota.</td></tr>'}</table><p><a href="/moodle">Volver al curso</a></p>`));
  }
  if (ruta === '/abrir') { // la persona hace clic en la actividad: Moodle avisa al simulador
    const q = new URLSearchParams({ iss: MOODLE, client_id: 'cliente-ensayo', login_hint: url.searchParams.get('quien'), lti_message_hint: url.searchParams.get('actividad'), target_link_uri: AQUI + '/sim/lti/launch' });
    res.writeHead(302, { Location: '/sim/lti/login?' + q }); return res.end();
  }
  if (ruta === '/auth.php') { // Moodle identifica a la persona y entrega el mensaje firmado
    const p = url.searchParams, quien = p.get('login_hint'), act = p.get('lti_message_hint'), [nombre, rol] = PERSONAS[quien] || PERSONAS.ana;
    const ya = Math.floor(Date.now() / 1000), C = 'https://purl.imsglobal.org/spec/lti/claim/';
    const token = await firmar({
      iss: MOODLE, aud: p.get('client_id'), sub: quien, name: nombre, iat: ya, exp: ya + 60, nonce: p.get('nonce'),
      [C + 'message_type']: 'LtiResourceLinkRequest', [C + 'version']: '1.3.0', [C + 'deployment_id']: '1',
      [C + 'roles']: ['http://purl.imsglobal.org/vocab/lis/v2/membership#' + rol],
      [C + 'context']: { id: 'curso-1', title: 'Excel básico' },
      [C + 'resource_link']: { id: act, title: act },
      'https://purl.imsglobal.org/spec/lti-ags/claim/endpoint': { lineitem: MOODLE + '/notas/' + act + '/lineitem', scope: ['https://purl.imsglobal.org/spec/lti-ags/scope/score'] }
    }, llave.privada, llave.kid);
    return html(`<!doctype html><meta charset="utf-8"><form id="f" method="post" action="${p.get('redirect_uri')}"><input type="hidden" name="id_token" value="${token}"><input type="hidden" name="state" value="${p.get('state')}"></form><script>document.getElementById('f').submit()</script>`);
  }
  res.writeHead(404).end();
}

createServer(async (req, res) => {
  const url = new URL(req.url, AQUI);
  try {
    if (url.pathname.startsWith('/moodle')) return await moodle(url, res);
    if (url.pathname.startsWith('/sim/')) {
      let texto = '';
      for await (const trozo of req) texto += trozo;
      let cuerpo = null;
      if (req.method === 'POST') cuerpo = (req.headers['content-type'] || '').includes('x-www-form-urlencoded') ? Object.fromEntries(new URLSearchParams(texto)) : (texto ? JSON.parse(texto) : {});
      const r = await nucleo.atender({ metodo: req.method, ruta: url.pathname.slice(4), cuerpo, consulta: Object.fromEntries(url.searchParams), auth: req.headers.authorization, origen: req.headers.origin });
      const cab = { ...(r.cabeceras || {}), 'Cache-Control': 'no-store' };
      if (r.redirigir) { res.writeHead(r.estado, { ...cab, Location: r.redirigir }); return res.end(); }
      res.writeHead(r.estado, { ...cab, 'Content-Type': 'application/json; charset=utf-8' });
      return res.end(r.cuerpo === undefined ? '' : JSON.stringify(r.cuerpo));
    }
    let ruta = decodeURIComponent(url.pathname);
    if (ruta.endsWith('/')) ruta += 'index.html';
    const archivo = normalize(join(RAIZ, ruta));
    if (!archivo.startsWith(RAIZ)) { res.writeHead(403); return res.end(); }
    const datos = await readFile(archivo);
    res.writeHead(200, { 'Content-Type': TIPOS[extname(archivo)] || 'application/octet-stream', 'Cache-Control': 'no-store' });
    res.end(datos);
  } catch (e) {
    res.writeHead(e.code === 'ENOENT' ? 404 : 500, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end(e.code === 'ENOENT' ? 'No encontrado' : 'Error: ' + e.message);
  }
}).listen(PUERTO, () => console.log('Ensayo listo. Abre ' + AQUI + '/moodle'));
