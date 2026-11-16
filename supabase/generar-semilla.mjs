// Genera supabase/semilla.sql con los datos iniciales de la base: configuración regional,
// catálogos y lecciones. Toma los valores de los archivos del proyecto, así no hay que
// escribirlos dos veces.   Uso:  node supabase/generar-semilla.mjs
import { readFileSync, writeFileSync, readdirSync } from 'node:fs';
import reg from '../js/regional/es-MX.js';
import { POLITICA, MENSAJES, ERRORES_COMUNES, ERRORES_UNIVERSALES, SONIDOS } from '../js/leccion/catalogos.js';

const aqui = new URL('.', import.meta.url);
const json = v => '$sim$' + JSON.stringify(v) + '$sim$::jsonb';
const txt = v => "'" + String(v).replace(/'/g, "''") + "'";
const sql = [
  '-- Datos iniciales del simulador. Archivo generado: no editarlo a mano.',
  '-- Se ejecuta en el "SQL Editor" de Supabase después de esquema.sql. Se puede ejecutar varias veces.',
  ''
];

sql.push(`insert into config_regional (codigo, datos) values (${txt(reg.codigo)}, ${json(reg)})\n  on conflict (codigo) do update set datos = excluded.datos;\n`);

const catalogos = { politica: POLITICA, mensajes: MENSAJES, errores_comunes: ERRORES_COMUNES, errores_universales: ERRORES_UNIVERSALES, sonidos: SONIDOS };
for (const [clave, datos] of Object.entries(catalogos))
  sql.push(`insert into catalogos (clave, datos) values (${txt(clave)}, ${json(datos)})\n  on conflict (clave) do update set datos = excluded.datos;\n`);

const materias = new Map(), temas = new Map(), lecciones = [];
for (const archivo of readdirSync(new URL('../lecciones/', aqui)).filter(a => a.endsWith('.json'))) {
  const l = JSON.parse(readFileSync(new URL('../lecciones/' + archivo, aqui), 'utf8'));
  const id = t => t.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  const m = id(l.identidad.materia || 'general'), t = m + '.' + id(l.identidad.tema || 'general');
  materias.set(m, l.identidad.materia || 'General');
  temas.set(t, { materia: m, nombre: l.identidad.tema || 'General' });
  lecciones.push({ l, tema: t });
}
for (const [id, nombre] of materias) sql.push(`insert into materias (id, nombre) values (${txt(id)}, ${txt(nombre)}) on conflict (id) do update set nombre = excluded.nombre;`);
for (const [id, t] of temas) sql.push(`insert into temas (id, materia, nombre) values (${txt(id)}, ${txt(t.materia)}, ${txt(t.nombre)}) on conflict (id) do update set nombre = excluded.nombre;`);
sql.push('');
for (const { l, tema } of lecciones)
  sql.push(`insert into lecciones (id, titulo, tema, datos) values (${txt(l.identidad.id)}, ${txt(l.identidad.titulo)}, ${txt(tema)}, ${json(l)})\n  on conflict (id) do update set titulo = excluded.titulo, tema = excluded.tema, datos = excluded.datos, actualizada = now();\n`);

writeFileSync(new URL('semilla.sql', aqui), sql.join('\n'));
console.log('semilla.sql generado:', lecciones.length, 'lección(es),', Object.keys(catalogos).length, 'catálogos');
