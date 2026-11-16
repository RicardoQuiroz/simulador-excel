// Pruebas del núcleo. Ejecutar con:  node pruebas/motor.test.mjs
import reg from '../js/regional/es-MX.js';
import { crearLibro, hojaActiva, obtener, resultado } from '../js/nucleo/libro.js';
import { crearMotor } from '../js/formulas/motor.js';
import { crearDespachador } from '../js/nucleo/despachador.js';
import { Err } from '../js/formulas/funciones.js';
import { parseDir, alternarRef } from '../js/formulas/analizador.js';
import { mostrar, textoEdicion } from '../js/nucleo/formato.js';

let libro, motor, desp, fallos = 0, total = 0;
function nuevo() { libro = crearLibro(); motor = crearMotor(libro, reg); desp = crearDespachador(libro, motor, reg); }
const pon = (celda, texto) => desp.ejecutar({ accion: 'escribir', celda, texto });
const cel = d => { const p = parseDir(d); return obtener(hojaActiva(libro), p.c, p.f); };
const val = d => { const r = resultado(cel(d)); return r instanceof Err ? r.c : r; };
const ver = d => mostrar(resultado(cel(d)), cel(d) && cel(d).fmt, reg);
const formula = d => textoEdicion(cel(d), motor, reg);
function igual(nombre, real, esperado) {
  total++;
  const ok = typeof esperado === 'number' && typeof real === 'number' ? Math.abs(real - esperado) < 1e-9 : real === esperado;
  if (!ok) { fallos++; console.log('FALLA  ' + nombre + '\n   esperado: ' + JSON.stringify(esperado) + '\n   obtenido: ' + JSON.stringify(real)); }
}
const calc = (f, esperado) => { pon('Z1', f); igual(f, val('Z1'), esperado); };

// ---- datos base ----
nuevo();
[['A1', 'Producto'], ['B1', 'Precio'], ['C1', 'Cantidad'], ['D1', 'Zona'],
 ['A2', 'Arroz'], ['B2', '12.5'], ['C2', '10'], ['D2', 'Norte'],
 ['A3', 'Azúcar'], ['B3', '8'], ['C3', '4'], ['D3', 'Sur'],
 ['A4', 'Fideo'], ['B4', '6.25'], ['C4', '20'], ['D4', 'Norte'],
 ['A5', 'Aceite'], ['B5', '15'], ['C5', '0'], ['D5', 'Sur']].forEach(([c, t]) => pon(c, t));

// ---- aritmética y precedencia ----
calc('=1+2*3', 7);
calc('=(1+2)*3', 9);
calc('=-2^2', 4);
calc('=2^3^2', 64);
calc('=10%', 0.1);
calc('=0.1+0.2', 0.3);
calc('=0.1+0.2=0.3', true);
calc('="a"&"b"&1', 'ab1');
calc('=5/0', '#DIV/0!');
calc('="x"+1', '#VALUE!');
calc('=1<2', true);
calc('="ana"="ANA"', true);
calc('=B2*C2', 125);

// ---- funciones básicas ----
calc('=SUMA(B2:B5)', 41.75);
calc('=SUMA(B2:B5;10;"5")', 56.75);
calc('=SUMA(A2:A5)', 0);
calc('=PROMEDIO(C2:C5)', 8.5);
calc('=MAX(B2:B5)', 15);
calc('=MIN(B2:B5)', 6.25);
calc('=CONTAR(A1:D5)', 8);
calc('=CONTARA(A1:D5)', 20);
calc('=CONTAR.BLANCO(A1:E5)', 5);
calc('=REDONDEAR(2.345;2)', 2.35);
calc('=REDONDEAR(1234.5;-2)', 1200);
calc('=ENTERO(-2.5)', -3);
calc('=ABS(-4)', 4);

// ---- lógicas ----
calc('=SI(C2>5;"Mucho";"Poco")', 'Mucho');
calc('=SI(C5>5;"Mucho";"Poco")', 'Poco');
calc('=SI(C5>5;"Mucho")', false);
calc('=SI(B2>10;SI(C2>5;"A";"B");"C")', 'A');
calc('=SI(VERDADERO;1;1/0)', 1);
calc('=Y(B2>10;C2>5)', true);
calc('=O(B3>10;C3>5)', false);
calc('=NO(B3>10)', true);
calc('=SI.ERROR(B2/C5;"sin datos")', 'sin datos');
calc('=SI.ERROR(B2/C2;"sin datos")', 1.25);

// ---- condicionales ----
calc('=CONTAR.SI(D2:D5;"Norte")', 2);
calc('=CONTAR.SI(B2:B5;">8")', 2);
calc('=CONTAR.SI(A2:A5;"A*")', 3);
calc('=SUMAR.SI(D2:D5;"Sur";C2:C5)', 4);
calc('=SUMAR.SI(C2:C5;">=10")', 30);
calc('=PROMEDIO.SI(D2:D5;"Norte";B2:B5)', 9.375);
calc('=SUMAR.SI.CONJUNTO(C2:C5;D2:D5;"Norte";B2:B5;">10")', 10);
calc('=CONTAR.SI.CONJUNTO(D2:D5;"Sur";C2:C5;">0")', 1);

// ---- búsqueda ----
calc('=BUSCARV("Fideo";A2:D5;2;FALSO)', 6.25);
calc('=BUSCARV("fideo";A2:D5;4;FALSO)', 'Norte');
calc('=BUSCARV("Sal";A2:D5;2;FALSO)', '#N/A');
calc('=BUSCARV("Arroz";A2:D5;9;FALSO)', '#REF!');
calc('=SI.ERROR(BUSCARV("Sal";A2:D5;2;FALSO);"No existe")', 'No existe');
calc('=BUSCARH("Cantidad";A1:D5;3;FALSO)', 4);
calc('=INDICE(A2:D5;3;1)', 'Fideo');
calc('=COINCIDIR("Azúcar";A2:A5;0)', 2);

// ---- texto y fecha ----
calc('=CONCATENAR(A2;" - ";D2)', 'Arroz - Norte');
calc('=IZQUIERDA(A2;2)', 'Ar');
calc('=DERECHA(A2;3)', 'roz');
calc('=EXTRAE(A2;2;3)', 'rro');
calc('=LARGO(A3)', 6);
calc('=MAYUSC(A2)', 'ARROZ');
calc('=ESPACIOS("  a   b ")', 'a b');
pon('F1', '15/03/2026');
igual('fecha se muestra', ver('F1'), '15/03/2026');
calc('=AÑO(F1)', 2026);
calc('=MES(F1)', 3);
calc('=DIA(F1)', 15);
calc('=F1+1', 46097);

// ---- errores y casos del idioma ----
calc('=SUM(B2:B5)', '#NAME?');
calc('=NOEXISTE(1)', '#NAME?');
igual('error localizado', ver('Z1'), '#¿NOMBRE?');
pon('Y1', '=Y2'); pon('Y2', '=Y1');
igual('circular', val('Y1'), '#CIRC!');
pon('Y1', ''); pon('Y2', '');
igual('paréntesis sin cerrar', pon('Z1', '=SUMA(B2:B5').codigo, 'parentesis');
igual('comillas sin cerrar', pon('Z1', '=SI(C2>5;"Mucho;1)').codigo, 'comillas');
igual('argumentos de más', pon('Z1', '=SI(1;2;3;4)').codigo, 'argumentos');
igual('coma en vez de punto y coma', pon('Z1', '=SI(C2>5,1,2)').ok, false);
igual('fórmula rechazada no cambia la celda', formula('Z1'), '=NOEXISTE(1)');

// ---- ida y vuelta del texto ----
pon('Z1', '=si( c2>5 ; "Mucho" ; suma($B$2:B5) )');
igual('normaliza al mostrar', formula('Z1'), '=SI(C2>5;"Mucho";SUMA($B$2:B5))');
igual('canónico', motor.aCanon(cel('Z1').ast), 'IF(C2>5,"Mucho",SUM($B$2:B5))');

// ---- entrada de datos ----
pon('G1', '$1,234.50'); igual('moneda valor', val('G1'), 1234.5); igual('moneda vista', ver('G1'), '$1,234.50');
pon('G2', '15%'); igual('porcentaje valor', val('G2'), 0.15); igual('porcentaje vista', ver('G2'), '15%');
pon('G3', 'verdadero'); igual('lógico', val('G3'), true);
pon('G4', "'007"); igual('texto forzado', val('G4'), '007');
pon('G5', '-3.5'); igual('negativo', val('G5'), -3.5);

// ---- relleno, copiar y pegar ----
pon('E2', '=B2*C2');
desp.ejecutar({ accion: 'rellenar', origen: 'E2', destino: 'E2:E5' });
igual('relleno fórmula', formula('E4'), '=B4*C4');
igual('relleno resultado', val('E4'), 125);
pon('H1', '1'); pon('H2', '2');
desp.ejecutar({ accion: 'rellenar', origen: 'H1:H2', destino: 'H1:H6' });
igual('serie numérica', val('H6'), 6);
pon('I1', 'lunes');
desp.ejecutar({ accion: 'rellenar', origen: 'I1', destino: 'I1:I8' });
igual('serie de días', val('I8'), 'lunes');
igual('serie de días 2', val('I3'), 'miércoles');
pon('J1', '=$B$2*C2');
desp.ejecutar({ accion: 'copiar', rango: 'J1' });
desp.ejecutar({ accion: 'pegar', destino: 'K3' });
igual('pegar desplaza relativas', formula('K3'), '=$B$2*D4');
desp.ejecutar({ accion: 'copiar', rango: 'E2' });
desp.ejecutar({ accion: 'pegar', destino: 'L2', soloValores: true });
igual('pegar valores', formula('L2'), '125');

// ---- formato y deshacer ----
desp.ejecutar({ accion: 'formato', rango: 'B2:B5', fmt: { num: 'moneda', dec: 2 } });
igual('formato moneda', ver('B4'), '$6.25');
desp.ejecutar({ accion: 'deshacer' });
igual('deshacer formato', ver('B4'), '6.25');
desp.ejecutar({ accion: 'rehacer' });
igual('rehacer formato', ver('B4'), '$6.25');
pon('B2', '100');
igual('recalcula dependientes', val('E2'), 1000);
desp.ejecutar({ accion: 'deshacer' });
igual('deshacer valor', val('E2'), 125);

// ---- hojas y nombres ----
desp.ejecutar({ accion: 'nombre.definir', nombre: 'Precios', rango: 'B2:B5', hoja: 0 });
calc('=SUMA(Precios)', 41.75);
desp.ejecutar({ accion: 'hoja.agregar' });
pon('A1', '=Hoja1!B2*2');
igual('referencia a otra hoja', val('A1'), 25);
desp.ejecutar({ accion: 'hoja.renombrar', indice: 0, nombre: 'Ventas 2026' });
igual('renombrar hoja actualiza fórmulas', formula('A1'), "='Ventas 2026'!B2*2");
igual('y sigue calculando', val('A1'), 25);

// ---- F4 ----
igual('F4 paso 1', alternarRef('=B2*2', 3).texto, '=$B$2*2');
igual('F4 paso 2', alternarRef('=$B$2*2', 5).texto, '=B$2*2');
igual('F4 paso 3', alternarRef('=B$2*2', 4).texto, '=$B2*2');
igual('F4 paso 4', alternarRef('=$B2*2', 4).texto, '=B2*2');

console.log(fallos ? `\n${fallos} de ${total} pruebas fallaron` : `Las ${total} pruebas pasaron`);
process.exit(fallos ? 1 : 0);
