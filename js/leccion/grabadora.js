// Grabadora de demostraciones: el docente hace la tarea y aquí se anota como guion.
// Recibe los "gestos" que emite la vista (clics, texto tecleado, teclas, botones).

export function crearGrabadora(vista) {
  let guion = [], activa = false;
  const oyentes = new Set();
  vista.alGesto(g => {
    if (!activa) return;
    const u = guion[guion.length - 1];
    if (g.accion === 'escribir' && u && u.accion === 'escribir') {
      if (g.reemplazar) { u.texto = g.texto; u.reemplazar = true; }  // hubo borrados: se guarda el texto final
      else u.texto += g.texto;
    } else guion.push({ ...g });
    for (const o of oyentes) o();
  });
  return {
    iniciar() { guion = []; activa = true; },
    detener() { activa = false; return guion; },
    activa: () => activa,
    guion: () => guion,
    alCambiar: fn => { oyentes.add(fn); return () => oyentes.delete(fn); }
  };
}

// Descripción de una acción en lenguaje llano, para que el docente revise lo grabado.
export function describir(a, reg) {
  const T = reg.textos.leccion.acciones, sin = t => String(t || '').replace(/^[a-zñ]+:/, '');
  switch (a.accion) {
    case 'clic': return T.clic.replace('{x}', sin(a.en));
    case 'dobleClic': return T.dobleClic.replace('{x}', sin(a.en));
    case 'arrastrar': return a.desde === 'ui:controlador-relleno' ? T.rellenar.replace('{x}', sin(a.hasta)) : T.arrastrar.replace('{x}', sin(a.desde)).replace('{y}', sin(a.hasta));
    case 'seleccionar': return T.seleccionar.replace('{x}', a.rango);
    case 'escribir': return T.escribir.replace('{x}', a.texto);
    case 'tecla': return T.tecla.replace('{x}', (a.ctrl ? 'Ctrl + ' : '') + (a.mayus ? 'Mayús + ' : '') + ((T.teclas && T.teclas[a.tecla]) || a.tecla));
    case 'comando': return T.comando.replace('{x}', reg.textos.cinta[a.id] || a.id);
    case 'elegir': return T.elegir.replace('{x}', a.opcion);
    case 'narrar': return a.texto;
    default: return a.accion;
  }
}
