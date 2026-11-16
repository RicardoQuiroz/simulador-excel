// Pruebas de validadores y detectores. Ejecutar con:  node pruebas/validadores.test.mjs
import { readFileSync } from 'node:fs';
import reg from '../js/regional/es-MX.js';
import { crearLibro } from '../js/nucleo/libro.js';
import { crearMotor } from '../js/formulas/motor.js';
import { crearDespachador } from '../js/nucleo/despachador.js';
import { validar, DETECTORES } from '../js/leccion/validadores.js';

const lec = JSON.parse(readFileSync(new URL('../lecciones/ejemplo-funcion-si.json', import.meta.url)));
let libro, motor, desp, fallos = 0, total = 0, rech = null;
function nuevo() {
  libro = crearLibro(); motor = crearMotor(libro, reg); desp = crearDespachador(libro, motor, reg);
  desp.cargar(JSON.parse(JSON.stringify(lec.libroInicial)));
  rech = null;
}
const ctx = () => ({ libro, motor, reg, hojaNombre: 'Consumo', comandos: new Set(), rech });
const pon = (celda, texto) => {
  const r = desp.ejecutar({ accion: 'escribir', celda, texto });
  rech = r.ok ? null : { texto, codigo: r.codigo };
  return r;
};
function igual(nombre, real, esperado) {
  total++;
  if (real !== esperado) { fallos++; console.log('FALLA  ' + nombre + '  esperado=' + JSON.stringify(esperado) + ' obtenido=' + JSON.stringify(real)); }
}
const paso = id => lec.pasos.find(p => p.id === id);
const cumple = p => p.validar.reglas.every(r => validar(r, ctx()).ok);
const motivo = (p, tipo) => validar(p.validar.reglas.find(r => r.tipo === tipo), ctx()).motivo;
const detecta = (id, p) => DETECTORES[id](ctx(), p);

// ---- paso 1: total con SUMA ----
nuevo();
igual('p1 vacío no cumple', cumple(paso('p1')), false);
pon('C8', '14700');
igual('p1 valor fijo no cumple', cumple(paso('p1')), false);
igual('p1 detecta valor fijo', detecta('valor-en-vez-de-formula', paso('p1')), true);
pon('C8', '=SUMA(C2:C5)');
igual('p1 rango corto no cumple', cumple(paso('p1')), false);
igual('p1 detecta rango incompleto', detecta('rango-incompleto', paso('p1')), true);
pon('C8', '=SUMA(C2:C6)');
igual('p1 SUMA cumple', cumple(paso('p1')), true);
pon('C8', '=C2+C3+C4+C5+C6');
igual('p1 suma manual también cumple', cumple(paso('p1')), true);

// ---- paso 3: función SI ----
igual('p3 vacío no cumple', cumple(paso('p3')), false);
pon('D2', '=SI(C2>B2;"Excedido";"Dentro del plan")');
igual('p3 solución de referencia', cumple(paso('p3')), true);
pon('D2', '=si(B2<C2;"excedido";"dentro del plan")');
igual('p3 condición equivalente y minúsculas', cumple(paso('p3')), true);
pon('D2', '=SI(C2<=B2;"Dentro del plan";"Excedido")');
igual('p3 condición negada con ramas cambiadas', cumple(paso('p3')), true);
pon('D2', '=SI(C2>=B2;"Excedido";"Dentro del plan")');
igual('p3 >= en vez de > no cumple', cumple(paso('p3')), false);
igual('p3 motivo: falla con otros datos', motivo(paso('p3'), 'formula_equivalente'), 'distintaOtros');
pon('D2', '=SI(C2>B2;"Dentro del plan";"Excedido")');
igual('p3 ramas invertidas no cumple', cumple(paso('p3')), false);
igual('p3 detecta ramas invertidas', detecta('argumentos-si-invertidos', paso('p3')), true);
pon('D2', 'Dentro del plan');
igual('p3 texto a mano no cumple', cumple(paso('p3')), false);
igual('p3 error propio: texto sin fórmula', validar(paso('p3').erroresComunes.find(e => e.si).si, ctx()).ok, true);
pon('D2', 'SI(C2>B2;"Excedido";"Dentro del plan")');
igual('p3 detecta olvido del =', detecta('olvido-signo-igual', paso('p3')), true);
pon('D2', '=SI(C2>B2,"Excedido","Dentro del plan")');
igual('p3 coma: fórmula rechazada', !!rech, true);
igual('p3 detecta separador incorrecto', detecta('separador-incorrecto', paso('p3')), true);
pon('D2', '=SI(C2>B2;Excedido;Dentro del plan)');
igual('p3 detecta texto sin comillas', detecta('texto-sin-comillas', paso('p3')), true);
pon('D2', '=SI(C2>B2;"Excedido";"Dentro del plan"');
igual('p3 detecta paréntesis sin cerrar', detecta('parentesis-sin-cerrar', paso('p3')), true);
pon('D2', '=Y(C2>B2)');
igual('p3 sin SI no cumple', cumple(paso('p3')), false);
igual('p3 motivo usa_funcion', motivo(paso('p3'), 'usa_funcion'), 'defecto');

// ---- paso 4: relleno ----
pon('D2', '=SI(C2>B2;"Excedido";"Dentro del plan")');
igual('p4 sin rellenar no cumple', cumple(paso('p4')), false);
igual('p4 motivo vacía', motivo(paso('p4'), 'rango_relleno'), 'vacia');
desp.ejecutar({ accion: 'rellenar', origen: 'D2', destino: 'D2:D4' });
igual('p4 relleno parcial no cumple', cumple(paso('p4')), false);
desp.ejecutar({ accion: 'rellenar', origen: 'D2', destino: 'D2:D6' });
igual('p4 relleno completo cumple', cumple(paso('p4')), true);
pon('D5', 'Excedido');
igual('p4 una celda a mano no cumple', cumple(paso('p4')), false);
igual('p4 motivo valor fijo', motivo(paso('p4'), 'rango_relleno'), 'valorFijo');

// ---- paso 5 y reto ----
desp.ejecutar({ accion: 'rellenar', origen: 'D2', destino: 'D2:D6' });
pon('C2', '2500');
igual('p5 cumple al cambiar el dato', cumple(paso('p5')), true);
pon('E2', '=SI(C2<B2/2;"Llamar";"")');
desp.ejecutar({ accion: 'rellenar', origen: 'E2', destino: 'E2:E6' });
igual('reto cumple', lec.reto.validar.reglas.every(r => validar(r, ctx()).ok), true);
pon('E3', '=SI(C3<B3;"Llamar";"")');
igual('reto con una fila mal no cumple', lec.reto.validar.reglas.every(r => validar(r, ctx()).ok), false);

// ---- otros tipos ----
desp.ejecutar({ accion: 'formato', rango: 'A1:D1', fmt: { negrita: true } });
igual('formato', validar({ tipo: 'formato', rango: 'A1:D1', fmt: { negrita: true } }, ctx()).ok, true);
igual('formato falta', validar({ tipo: 'formato', rango: 'A1:D2', fmt: { negrita: true } }, ctx()).ok, false);
desp.ejecutar({ accion: 'seleccionar', rango: 'D2' });
igual('selección', validar({ tipo: 'seleccion', rango: 'D2' }, ctx()).ok, true);
pon('F2', '=C2*$B$1');
igual('referencia absoluta', validar({ tipo: 'referencia', celda: 'F2', a: 'B1', modo: 'absoluta' }, ctx()).ok, true);
igual('referencia relativa no', validar({ tipo: 'referencia', celda: 'F2', a: 'B1', modo: 'relativa' }, ctx()).ok, false);
igual('usa rango', validar({ tipo: 'usa_rango', celda: 'C8', rango: 'C2:C6' }, ctx()).ok, false);
desp.ejecutar({ accion: 'nombre.definir', nombre: 'Planes', rango: 'B2:B6' });
igual('nombre definido', validar({ tipo: 'nombre_definido', nombre: 'planes', rango: 'B2:B6' }, ctx()).ok, true);
igual('el libro real no se altera al validar', libro.hojas[0].celdas.get('B2').v, 2000);

console.log(fallos ? `\n${fallos} de ${total} pruebas fallaron` : `Las ${total} pruebas pasaron`);
process.exit(fallos ? 1 : 0);
