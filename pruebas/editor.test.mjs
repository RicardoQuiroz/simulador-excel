// Pruebas del editor de lecciones (fase 7): lectura de Excel, propuesta de pasos, revisión
// automática y rutas del servidor (guardar, permisos, asistente).
// Ejecutar con:  node pruebas/editor.test.mjs
import { readFileSync } from 'node:fs';
import { leerXlsx, formatoNumero, xml } from '../js/editor/xlsx.js';
import { proponer, leccionVacia, formulaLocal, formulaCanon } from '../js/editor/proponer.js';
import { revisar, probar } from '../js/editor/probar.js';
import reg from '../js/regional/es-MX.js';
import { crearNucleo } from '../supabase/functions/sim/nucleo.js';
import { firmar, generarClave } from '../supabase/functions/sim/jwt.js';
import { crearMemoria } from './memoria.mjs';
import { POLITICA, ERRORES_COMUNES } from '../js/leccion/catalogos.js';

let fallos = 0, total = 0;
function igual(nombre, real, esperado) {
  total++;
  const a = JSON.stringify(real), b = JSON.stringify(esperado);
  if (a !== b) { fallos++; console.log('FALLA  ' + nombre + '\n   esperado=' + b + '\n   obtenido=' + a); }
}
const leer = n => readFileSync(new URL('./muestras/' + n, import.meta.url));
const ejemplo = JSON.parse(readFileSync(new URL('../lecciones/ejemplo-funcion-si.json', import.meta.url)));

// ---- 1. lectura de archivos de Excel ----
const ej = await leerXlsx(leer('si-ejercicio.xlsx')), sol = await leerXlsx(leer('si-solucion.xlsx'));
const h = sol.libro.hojas[0];
igual('nombre de la hoja', h.nombre, 'Consumo');
igual('texto compartido', h.celdas.A1.v, 'Cliente');
igual('negrita y relleno', h.celdas.A1.fmt, { negrita: true, relleno: '#D9E1F2' });
igual('número', h.celdas.B2.v, 2000);
igual('formato de miles', ej.libro.hojas[0].celdas.B2.fmt, { num: 'numero', dec: 0, miles: true });
igual('fórmula escrita', h.celdas.C8.f, 'SUM(C2:C6)');
igual('fórmula compartida (copiada) se desplaza', h.celdas.D5.f, 'IF(C5>B5,"Excedido","Dentro del plan")');
igual('ancho de columna', h.anchos.A > 100 && h.anchos.A < 160, true);
igual('nombre definido', sol.libro.nombres.consumos, { nombre: 'Consumos', hoja: 'Consumo', c1: 2, f1: 1, c2: 2, f2: 5 });
igual('sin avisos', sol.avisos, []);
let error = null;
try { await leerXlsx(new TextEncoder().encode('no soy un excel')); } catch (e) { error = e.message; }
igual('archivo que no es xlsx', error, 'noEsXlsx');

igual('formato moneda', formatoNumero('"Bs"#,##0.00'), { num: 'moneda', dec: 2 });
igual('formato porcentaje', formatoNumero('0.0%'), { num: 'porcentaje', dec: 1 });
igual('formato fecha', formatoNumero('dd/mm/yyyy'), { num: 'fecha' });
igual('formato hora', formatoNumero('h:mm:ss'), { num: 'hora' });
igual('formato texto', formatoNumero('@'), { num: 'texto' });
igual('formato general', formatoNumero('General'), null);
igual('xml con entidades', xml('<a x="1 &amp; 2"><b>&lt;hola&gt;</b></a>').h[0].h[0].t, '<hola>');

// ---- 2. propuesta a partir de ejercicio y solucionario ----
const lec = proponer(ej.libro, sol.libro, reg, { titulo: 'Prueba' });
igual('cantidad de pasos', lec.pasos.length, 4);
igual('paso 1: fórmula con SI', lec.pasos[0].validar.reglas.map(r => r.tipo), ['es_formula', 'usa_funcion', 'formula_equivalente']);
igual('paso 1: instrucción con el encabezado', lec.pasos[0].instruccion, 'En la celda D2 escribe una fórmula que calcule «Estado».');
igual('paso 1: pista con la fórmula en español', lec.pasos[0].pistas[2], 'La fórmula tiene esta forma: =SI(C2>B2;"Excedido";"Dentro del plan")');
igual('paso 1: errores comunes', lec.pasos[0].erroresComunes.map(e => e.error), ['valor-en-vez-de-formula', 'argumentos-si-invertidos', 'texto-sin-comillas']);
igual('paso 2: copiar hacia abajo', lec.pasos[1].validar.reglas[0], { tipo: 'rango_relleno', rango: 'D3:D6', referenciaPrimeraFila: 'IF(C3>B3,"Excedido","Dentro del plan")' });
igual('paso 3: total con el rótulo de la fila', lec.pasos[2].instruccion, 'En la celda C8 escribe una fórmula que calcule «Total consumido».');
igual('paso 4: formato que pide el solucionario', lec.pasos[3].validar.reglas[0], { tipo: 'formato', rango: 'C8', fmt: { negrita: true } });
igual('formato de número automático pasa a la hoja inicial', lec.libroInicial.hojas[0].celdas.C8.fmt, { num: 'numero', dec: 0, miles: true });
igual('celdas editables', lec.interfaz.celdasEditables, ['D2:D6', 'C8']);
igual('la propuesta pasa la revisión', revisar(lec), []);
igual('la propuesta se resuelve sola', probar(lec, reg).ok, true);

// ---- 3. revisión y prueba automática ----
igual('el ejemplo pasa la revisión', revisar(ejemplo), []);
igual('el ejemplo se resuelve solo', probar(ejemplo, reg).ok, true);
igual('lección vacía', revisar(leccionVacia('')).map(p => p.clave), ['sinTitulo', 'sinPasos']);
const mala = JSON.parse(JSON.stringify(ejemplo));
mala.pasos[0].validar.reglas[1].referencia = 'SUMAR(C2:C6';
mala.pasos[1].validar.reglas[0].rango = 'ZZ999';
mala.checkpoints[0].pregunta.opciones.forEach(o => { o.correcta = true; });
igual('detecta fórmula, rango y pregunta mal hechos', revisar(mala).map(p => p.clave), ['formulaInvalida', 'rangoInvalido', 'preguntaSinCorrecta']);
const imposible = JSON.parse(JSON.stringify(ejemplo));
imposible.pasos[4].validar.reglas[1].valor = 'Dentro del plan'; // con C2=2500 nunca da eso
const r = probar(imposible, reg);
igual('detecta un paso imposible', r.pasos[4].ok, false);
const regalado = JSON.parse(JSON.stringify(ejemplo));
regalado.pasos[0].validar = { combinar: 'todas', reglas: [{ tipo: 'valor_celda', celda: 'A1', valor: 'Cliente' }] };
igual('detecta un paso que ya está hecho', probar(regalado, reg).pasos[0].yaCumplido, true);
igual('fórmula local a interna', formulaCanon('=SI(C2>B2;"Sí";"No")', reg), 'IF(C2>B2,"Sí","No")');
igual('fórmula interna a local', formulaLocal('SUM(C2:C6)', reg), '=SUMA(C2:C6)');

// ---- 4. servidor: lista, guardado y permisos ----
const MOODLE = 'https://moodle.prueba', FUNCION = 'https://p.supabase.co/functions/v1/sim';
const llave = await generarClave();
const traer = async url => ({ ok: true, status: 200, json: async () => ({ keys: [{ ...llave.publica, kid: llave.kid }] }) });
const db = crearMemoria({ estricta: true });
let respuestaIA = null, pedidosIA = [];
const ia = async p => { pedidosIA.push(p); return respuestaIA; };
const nucleo = crearNucleo({ db, traer, urlBase: FUNCION, ia });
await db.insertar('ajustes', [{ clave: 'app_url', valor: 'https://app/' }, { clave: 'ia_limite_diario', valor: '3' }], { conflicto: 'clave' });
await db.insertar('plataformas_lti', { id: 'plat-1', nombre: 'M', emisor: MOODLE, client_id: 'c1', deployment_id: '7',
  url_login: MOODLE + '/auth', url_jwks: MOODLE + '/certs', url_token: MOODLE + '/token' });
await db.insertar('config_regional', { codigo: 'es-MX', datos: JSON.parse(JSON.stringify(reg)) }, { conflicto: 'codigo' });
await db.insertar('catalogos', [{ clave: 'politica', datos: POLITICA }, { clave: 'errores_comunes', datos: ERRORES_COMUNES }], { conflicto: 'clave' });
await db.insertar('lecciones', { id: ejemplo.identidad.id, titulo: ejemplo.identidad.titulo, datos: ejemplo });

const ROL = 'http://purl.imsglobal.org/vocab/lis/v2/membership#';
const pedir = (ruta, pase, cuerpo, consulta) => nucleo.atender({ metodo: cuerpo ? 'POST' : 'GET', ruta, cuerpo, consulta, auth: pase && 'Bearer ' + pase });
async function entrar(sub, rol) {
  const r1 = await nucleo.atender({ metodo: 'POST', ruta: '/lti/login', cuerpo: { iss: MOODLE, login_hint: sub, client_id: 'c1' } });
  const u = new URL(r1.redirigir), ya = Math.floor(Date.now() / 1000), C = 'https://purl.imsglobal.org/spec/lti/claim/';
  const token = await firmar({ iss: MOODLE, aud: 'c1', sub, name: sub, iat: ya, exp: ya + 60, nonce: u.searchParams.get('nonce'),
    [C + 'message_type']: 'LtiResourceLinkRequest', [C + 'version']: '1.3.0', [C + 'deployment_id']: '7', [C + 'roles']: [ROL + rol],
    [C + 'context']: { id: 'curso-1', title: 'Excel' }, [C + 'resource_link']: { id: 'enlace-1', title: 'Práctica' } }, llave.privada, llave.kid);
  const r2 = await nucleo.atender({ metodo: 'POST', ruta: '/lti/launch', cuerpo: { id_token: token, state: u.searchParams.get('state') } });
  return (await pedir('/sesion', null, { codigo: r2.redirigir.split('#c=')[1] })).cuerpo.token;
}
const est = await entrar('est-1', 'Learner'), doc1 = await entrar('doc-1', 'Instructor'), doc2 = await entrar('doc-2', 'Instructor');

igual('estudiante no entra al editor', (await pedir('/editor', est)).estado, 403);
igual('estudiante no guarda lecciones', (await pedir('/editor/guardar', est, { leccion: lec })).estado, 403);
const lista = await pedir('/editor', doc1, null, { textos: '1' });
igual('docente ve la lista', lista.cuerpo.lecciones.map(l => l.id), [ejemplo.identidad.id]);
igual('la lección del sistema no es editable', lista.cuerpo.lecciones[0].editable, false);
igual('llegan los textos del editor', !!lista.cuerpo.regional.textos.editor, true);
igual('se avisa que hay asistente', lista.cuerpo.asistente, true);

const g1 = await pedir('/editor/guardar', doc1, { leccion: { ...lec, identidad: { ...lec.identidad, titulo: 'Función SI: megas' } } });
igual('guardar una lección nueva', g1.estado, 200);
igual('identificador a partir del título', /^funcion-si-megas-[a-z0-9]{1,4}$/.test(g1.cuerpo.id), true);
igual('primera versión', g1.cuerpo.version, 1);
const ver = await pedir('/editor/leccion', doc1, null, { id: g1.cuerpo.id });
igual('abrir la lección guardada', ver.cuerpo.leccion.pasos.length, 4);
igual('quien la creó puede cambiarla', ver.cuerpo.editable, true);
const g2 = await pedir('/editor/guardar', doc1, { leccion: JSON.parse(JSON.stringify(ver.cuerpo.leccion)) });
igual('cambiarla conserva el identificador', g2.cuerpo.id, g1.cuerpo.id);
igual('y sube la versión', g2.cuerpo.version, 2);
igual('otro docente no puede cambiarla', (await pedir('/editor/guardar', doc2, { leccion: JSON.parse(JSON.stringify(ver.cuerpo.leccion)) })).estado, 403);
const g3 = await pedir('/editor/guardar', doc2, { leccion: JSON.parse(JSON.stringify(ver.cuerpo.leccion)), copia: true });
igual('pero sí guardar una copia', g3.estado === 200 && g3.cuerpo.id !== g1.cuerpo.id, true);
igual('nadie sobrescribe la del sistema', (await pedir('/editor/guardar', doc1, { leccion: ejemplo })).estado, 403);
igual('lección sin pasos rechazada', (await pedir('/editor/guardar', doc1, { leccion: leccionVacia('X') })).estado, 400);
igual('datos de trabajo no se guardan', (await db.uno('lecciones', { id: g1.cuerpo.id })).datos._borrador, undefined);

// El docente usa la lección guardada en su actividad, sin perder el límite de intentos.
const col = (await db.lista('colocaciones', {}))[0];
await db.actualizar('colocaciones', { id: col.id }, { max_intentos: 3 });
igual('usar en la actividad', (await pedir('/colocacion', doc1, { leccion: g1.cuerpo.id })).estado, 200);
const col2 = await db.uno('colocaciones', { id: col.id });
igual('la actividad abre la lección nueva', col2.leccion, g1.cuerpo.id);
igual('se conserva el límite de intentos', col2.max_intentos, 3);

// ---- 5. asistente ----
respuestaIA = { texto: 'Aquí está:\n' + JSON.stringify({ ...ejemplo, identidad: { ...ejemplo.identidad, id: 'x', titulo: 'Nueva' } }), motivo: 'end_turn', modelo: 'm' };
const a1 = await pedir('/editor/asistente', doc1, { modo: 'crear', pedido: 'Quiero practicar SI con megas', funciones: ['SUM', 'IF', 'mala;'] });
igual('el asistente devuelve una lección', a1.cuerpo.leccion.identidad.titulo, 'Nueva');
igual('la indicación lleva las reglas y el ejemplo', pedidosIA[0].sistema.includes('rango_relleno') && pedidosIA[0].sistema.includes('L07-funcion-si'), true);
igual('solo funciones con nombre válido', pedidosIA[0].sistema.includes('mala;'), false);
igual('modelo por defecto', pedidosIA[0].modelo, 'claude-opus-5-5');
const a2 = await pedir('/editor/asistente', doc1, { modo: 'ajustar', pedido: 'haz la pista 2 más clara', leccion: ver.cuerpo.leccion });
igual('ajustar conserva el identificador', a2.cuerpo.leccion.identidad.id, g1.cuerpo.id);
respuestaIA = { texto: 'no puedo', motivo: 'refusal' };
igual('si el asistente declina, se avisa', (await pedir('/editor/asistente', doc1, { modo: 'crear', pedido: 'algo raro aquí' })).estado, 422);
igual('tope diario de usos', (await pedir('/editor/asistente', doc1, { modo: 'crear', pedido: 'otra lección más' })).estado, 429);
igual('estudiante no usa el asistente', (await pedir('/editor/asistente', est, { modo: 'crear', pedido: 'una lección' })).estado, 403);
const sinIA = crearNucleo({ db, traer, urlBase: FUNCION });
igual('sin clave, el asistente está apagado', (await sinIA.atender({ metodo: 'POST', ruta: '/editor/asistente', auth: 'Bearer ' + doc2, cuerpo: { modo: 'crear', pedido: 'una lección' } })).estado, 503);

console.log(fallos ? `\n${fallos} de ${total} pruebas fallaron` : `Las ${total} pruebas pasaron`);
process.exit(fallos ? 1 : 0);
