// Definición de la cinta de opciones. Los rótulos salen de la configuración regional.
// Botón: [id, tipo, icono, forma]
//   tipo:  F = funcional   D = decorativo   P = previsto para una fase posterior
//   forma: g = grande, m = icono con texto, p = solo icono, o un control especial

const F = 'F', D = 'D', P = 'P';

export const CINTA = [
  { id: 'archivo', tipo: P, grupos: [] },
  { id: 'inicio', grupos: [
    { id: 'portapapeles', b: [['pegar', F, 'pegar', 'g'], ['cortar', F, 'cortar', 'm'], ['copiar', F, 'copiar', 'm'], ['copiar-formato', D, 'brocha', 'm']] },
    { id: 'fuente', filas: 2, b: [
      ['fuente', D, null, 'fuente'], ['tamano', F, null, 'tamano'], ['salto'],
      ['negrita', F, null, 'letra'], ['cursiva', F, null, 'letra'], ['subrayado', F, null, 'letra'],
      ['bordes', F, 'bordes', 'p'], ['relleno', F, 'relleno', 'p'], ['color-fuente', F, 'colorFuente', 'p']] },
    { id: 'alineacion', filas: 2, b: [
      ['alin-sup', F, 'alinSup', 'p'], ['alin-medio', F, 'alinMedio', 'p'], ['alin-inf', F, 'alinInf', 'p'], ['ajustar', F, 'ajustar', 'm'], ['salto'],
      ['alin-izq', F, 'alinIzq', 'p'], ['alin-centro', F, 'alinCentro', 'p'], ['alin-der', F, 'alinDer', 'p'], ['combinar', D, 'combinar', 'm']] },
    { id: 'numero', filas: 2, b: [
      ['formato-numero', F, null, 'formatoNumero'], ['salto'],
      ['moneda', F, 'moneda', 'p'], ['porcentaje', F, 'porcentaje', 'p'], ['millares', F, 'millares', 'p'],
      ['mas-decimales', F, 'masDec', 'p'], ['menos-decimales', F, 'menosDec', 'p']] },
    { id: 'estilos', b: [['condicional', P, 'condicional', 'g'], ['tabla', D, 'tabla', 'g'], ['estilos-celda', D, 'estilos', 'g']] },
    { id: 'celdas', b: [['insertar', P, 'insertar', 'g'], ['eliminar', P, 'eliminar', 'g'], ['formato', P, 'formato', 'g']] },
    { id: 'edicion', b: [
      ['autosuma', F, 'autosuma', 'm'], ['autosuma-mas', F, 'flecha', 'p'], ['salto'],
      ['rellenar', F, 'rellenar', 'm'], ['borrar', F, 'borrar', 'm'], ['salto'],
      ['ordenar-filtrar', P, 'filtro', 'm'], ['buscar', D, 'buscar', 'm']], filas: 3 }
  ] },
  { id: 'insertar', grupos: [
    { id: 'tablas', b: [['tabla-dinamica', D, 'dinamica', 'g'], ['tabla', D, 'tabla', 'g']] },
    { id: 'ilustraciones', b: [['imagenes', D, 'imagen', 'g']] },
    { id: 'graficos', b: [['graficos', D, 'grafico', 'g']] },
    { id: 'texto', b: [['cuadro-texto', D, 'cuadroTexto', 'g']] }
  ] },
  { id: 'disposicion', grupos: [
    { id: 'pagina', b: [['margenes', D, 'pagina', 'g'], ['orientacion', D, 'pagina', 'g'], ['tamano', D, 'pagina', 'g'], ['area', D, 'cuadricula', 'g']] }
  ] },
  { id: 'formulas', grupos: [
    { id: 'biblioteca', b: [
      ['insertar-funcion', F, 'fx', 'g'], ['autosuma', F, 'autosuma', 'g'], ['recientes', P, 'libro', 'g'],
      ['financieras', D, 'moneda', 'g'], ['logicas', F, 'logica', 'g'], ['texto', F, 'texto', 'g'],
      ['fecha', F, 'reloj', 'g'], ['busqueda', F, 'lupaTabla', 'g'], ['matematicas', F, 'mate', 'g']] },
    { id: 'nombres', b: [['nombres', P, 'etiqueta', 'g'], ['asignar-nombre', F, 'etiqueta', 'm']] },
    { id: 'auditoria', b: [['rastrear', D, 'rastrear', 'm'], ['mostrar-formulas', F, 'verFormulas', 'm'], ['salto'], ['comprobar', D, 'aviso', 'm']], filas: 2 }
  ] },
  { id: 'datos', grupos: [
    { id: 'obtener', b: [['obtener', D, 'datos', 'g']] },
    { id: 'ordenar', b: [['ordenar-az', P, 'ordenar', 'p'], ['ordenar-za', P, 'ordenarZA', 'p'], ['ordenar', P, 'ordenar', 'g'], ['filtro', P, 'filtro', 'g']] },
    { id: 'herramientas', b: [['texto-columnas', D, 'columnas', 'g'], ['duplicados', D, 'duplicados', 'g'], ['validacion', P, 'validacion', 'g']] }
  ] },
  { id: 'revisar', grupos: [
    { id: 'revision', b: [['ortografia', D, 'ortografia', 'g']] },
    { id: 'comentarios', b: [['comentario', D, 'comentario', 'g']] },
    { id: 'proteger', b: [['proteger', D, 'candado', 'g']] }
  ] },
  { id: 'vista', grupos: [
    { id: 'vistas', b: [['normal', D, 'cuadricula', 'g']] },
    { id: 'mostrar', b: [['cuadricula', F, 'cuadricula', 'm'], ['encabezados', F, 'tabla', 'm'], ['salto'], ['barra-formulas', F, 'fx', 'm']], filas: 2 },
    { id: 'ventana', b: [['inmovilizar', D, 'inmovilizar', 'g']] }
  ] }
];

export const TAMANOS = [8, 9, 10, 11, 12, 14, 16, 18, 20, 22, 24, 26, 28, 36, 48, 72];
export const FORMATOS_NUMERO = ['general', 'numero', 'moneda', 'fecha', 'fechaLarga', 'hora', 'porcentaje', 'texto'];
export const PALETA = [
  '#000000', '#ffffff', '#e7e6e6', '#44546a', '#4472c4', '#ed7d31', '#a5a5a5', '#ffc000', '#5b9bd5', '#70ad47',
  '#7f7f7f', '#f2f2f2', '#d0cece', '#d6dce4', '#d9e1f2', '#fce4d6', '#ededed', '#fff2cc', '#ddebf7', '#e2efda',
  '#c00000', '#ff0000', '#ffc000', '#ffff00', '#92d050', '#00b050', '#00b0f0', '#0070c0', '#002060', '#7030a0'
];
