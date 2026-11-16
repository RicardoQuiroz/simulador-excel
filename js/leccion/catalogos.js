// Catálogos editables de las lecciones. En la fase 5 cada uno será una tabla de la base de datos:
// POLITICA -> politicas_calificacion, MENSAJES -> tipos_validador,
// ERRORES_COMUNES -> errores_comunes, SONIDOS -> sonidos.

export const POLITICA = {
  erroresSinCosto: 2,      // errores por paso que no descuentan
  descuentoPorError: 5,    // % por cada error adicional
  descuentoPista: [10, 20, 35], // % según la pista más alta que se vio
  muestrame: 40,           // % fijo si se usó "Muéstrame"
  minimo: 40,              // % mínimo de un paso completado
  pistaTrasErrores: [2, 3, 4], // errores que habilitan la pista 1, 2 y 3
  inactividadSeg: 60,      // segundos sin actividad antes de ofrecer una pista
  dominio: 80              // promedio para considerar dominada la lección
};

// Mensaje cuando una regla no se cumple. {funcion} y {celda} se sustituyen.
export const MENSAJES = {
  defecto: 'Todavía no es correcto. Inténtalo de nuevo.',
  es_formula: {
    valorFijo: 'Escribiste un valor fijo. Aquí se necesita una fórmula: empieza con el signo =',
    vacia: 'La celda {celda} todavía está vacía.'
  },
  usa_funcion: { defecto: 'La fórmula debe usar la función {funcion}.' },
  no_usa_funcion: { defecto: 'En este paso no se usa la función {funcion}.' },
  referencia: {
    noUsa: 'La fórmula debe usar la celda {a}.',
    defecto: 'Revisa los signos $ de la referencia a {a}. Puedes cambiarlos con F4.'
  },
  usa_rango: { defecto: 'La fórmula debe abarcar el rango {rango}.' },
  usa_nombre: { defecto: 'La fórmula debe usar el nombre {nombre}.' },
  formula_equivalente: {
    valorFijo: 'Escribiste un valor fijo. Aquí se necesita una fórmula: empieza con el signo =',
    vacia: 'La celda {celda} todavía está vacía.',
    distintaAhora: 'El resultado todavía no es el esperado. Revisa la fórmula.',
    distintaOtros: 'Con estos datos coincide, pero si los datos cambian la fórmula fallaría. Revisa la condición y las celdas que usa.'
  },
  rango_relleno: {
    vacia: 'Todavía faltan celdas por rellenar.',
    valorFijo: 'Hay celdas con valores escritos a mano. Copia la fórmula para que Excel haga el trabajo.',
    distintaAhora: 'Alguna de las celdas copiadas no da el resultado esperado.',
    distintaOtros: 'Alguna de las celdas copiadas fallaría si los datos cambian.'
  },
  valor_celda: {
    vacia: 'La celda {celda} todavía está vacía.',
    distinto: 'El valor de {celda} no es el esperado.'
  },
  formato: { defecto: 'El formato todavía no es el que se pide.' }
};

// Equivocaciones típicas. El "detector" de cada una está en validadores.js.
export const ERRORES_COMUNES = {
  'valor-en-vez-de-formula': 'El número puede ser correcto, pero si cambian los datos no se actualizará. Usa una fórmula.',
  'olvido-signo-igual': 'Sin el signo igual al principio, Excel lo toma como un texto cualquiera.',
  'separador-incorrecto': 'En esta configuración los argumentos se separan con punto y coma (;), no con coma.',
  'texto-sin-comillas': 'Los textos dentro de una fórmula van entre comillas dobles: "así".',
  'rango-incompleto': 'Revisa el rango: te falta incluir alguna celda.',
  'argumentos-si-invertidos': 'Están al revés: primero va lo que se muestra cuando la condición se cumple.',
  'parentesis-sin-cerrar': 'Cada paréntesis que abres debe cerrarse.',
  'comillas-sin-cerrar': 'Falta cerrar unas comillas.'
};
// Se revisan siempre, aunque el paso no los mencione.
export const ERRORES_UNIVERSALES = ['olvido-signo-igual', 'separador-incorrecto', 'comillas-sin-cerrar', 'parentesis-sin-cerrar'];

// Sustituye los catálogos por los que llegan de la base de datos. Se modifican los mismos
// objetos, así todo el programa ve los valores nuevos.
export function aplicarCatalogos(c) {
  if (!c) return;
  const poner = (obj, datos) => { if (datos && typeof datos === 'object') { for (const k of Object.keys(obj)) delete obj[k]; Object.assign(obj, datos); } };
  poner(POLITICA, c.politica); poner(MENSAJES, c.mensajes); poner(ERRORES_COMUNES, c.errores_comunes); poner(SONIDOS, c.sonidos);
  if (Array.isArray(c.errores_universales)) { ERRORES_UNIVERSALES.length = 0; ERRORES_UNIVERSALES.push(...c.errores_universales); }
}

// Sonidos generados por código. Cada nota: [frecuencia Hz, duración s, retraso s, forma de onda].
export const SONIDOS = {
  correcto: [[660, 0.09, 0], [880, 0.16, 0.09]],
  incorrecto: [[196, 0.2, 0, 'triangle']],
  bloqueado: [[120, 0.08, 0]],
  pista: [[1320, 0.08, 0], [1760, 0.14, 0.08]],
  checkpoint: [[523, 0.35, 0], [659, 0.35, 0], [784, 0.35, 0]],
  fin: [[523, 0.12, 0], [659, 0.12, 0.12], [784, 0.3, 0.24]]
};
