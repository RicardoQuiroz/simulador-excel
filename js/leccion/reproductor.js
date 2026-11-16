// Reproductor de "Mostrar cómo": ejecuta un guion de acciones con un puntero virtual.
// No usa video: mueve un puntero dibujado y actúa sobre la hoja real mediante vista.simular.

const CANCELADO = Symbol('cancelado');
const copia = x => JSON.parse(JSON.stringify(x));
const NOMBRE_TECLA = { Enter: 'Enter ↵', Tab: 'Tab ⇥', Escape: 'Esc', Delete: 'Supr', Backspace: '⌫', ArrowUp: '↑', ArrowDown: '↓', ArrowLeft: '←', ArrowRight: '→' };

export function crearReproductor({ marco, vista, desp, sonidos }) {
  const oyentes = new Set();
  let guion = [], i = 0, estado = 'detenido', vel = 1, ficha = 0, instantaneo = false;
  let inicial = null, narracion = '', pidePausa = false, alTerminar = null;

  const puntero = document.createElement('div');
  puntero.className = 'puntero'; puntero.hidden = true;
  puntero.innerHTML = '<svg viewBox="0 0 24 24" width="26" height="26"><path d="M5 2v17l4.5-4 3 6.5 2.6-1.2-3-6.3H18z" fill="#fff" stroke="#111" stroke-width="1.4" stroke-linejoin="round"/></svg><span class="onda"></span><span class="tecla" hidden></span>';
  marco.appendChild(puntero);
  const etiqueta = puntero.querySelector('.tecla');

  // Mientras corre la demostración, el teclado y el ratón del estudiante no tocan la hoja
  // (el ratón se bloquea con CSS). La barra espaciadora pausa y reanuda.
  document.addEventListener('keydown', e => {
    if (!marco.classList.contains('demo') || (e.target.closest && e.target.closest('#panel'))) return;
    e.preventDefault(); e.stopPropagation();
    if (e.key === ' ' && api) api.alternar();
  }, true);
  let api = null;

  const avisar = () => { for (const o of oyentes) o(); };
  function esperar(ms, mia) {
    if (instantaneo) return Promise.resolve();
    return new Promise((ok, mal) => setTimeout(() => (mia === ficha ? ok() : mal(CANCELADO)), ms / vel));
  }

  async function moverA(destino, mia) {
    const q = vista.simular.rectDe(destino);
    if (!q) return;
    const base = marco.getBoundingClientRect();
    puntero.style.transitionDuration = instantaneo ? '0ms' : Math.round(480 / vel) + 'ms';
    puntero.style.transform = `translate(${Math.round(q.left + q.width / 2 - base.left)}px, ${Math.round(q.top + q.height / 2 - base.top)}px)`;
    await esperar(520, mia);
  }
  function pulso() {
    if (instantaneo) return;
    puntero.classList.remove('clic');
    void puntero.offsetWidth; // reinicia la animación
    puntero.classList.add('clic');
  }
  async function mostrarTecla(a, mia) {
    if (instantaneo) return;
    etiqueta.textContent = (a.ctrl ? 'Ctrl + ' : '') + (a.mayus ? 'Mayús + ' : '') + (NOMBRE_TECLA[a.tecla] || a.tecla);
    etiqueta.hidden = false;
    try { await esperar(650, mia); } finally { etiqueta.hidden = true; }
  }

  async function ejecutar(a, mia) {
    const S = vista.simular;
    switch (a.accion) {
      case 'narrar':
        narracion = a.texto; avisar();
        await esperar(Math.max(1400, a.texto.length * 55), mia);
        break;
      case 'mover': await moverA(a.a, mia); break;
      case 'clic': case 'clicDerecho':
        await moverA(a.en, mia); pulso();
        if (a.accion === 'clic') S.clic(a.en);
        await esperar(380, mia);
        break;
      case 'dobleClic':
        await moverA(a.en, mia); pulso(); S.dobleClic(a.en);
        await esperar(380, mia);
        break;
      case 'arrastrar':
        await moverA(a.desde, mia);
        puntero.classList.add('abajo');
        try { await esperar(200, mia); await moverA(a.hasta, mia); } finally { puntero.classList.remove('abajo'); }
        S.arrastrar(a.desde, a.hasta);
        await esperar(420, mia);
        break;
      case 'seleccionar':
        await moverA('rango:' + a.rango, mia);
        desp.ejecutar({ accion: 'seleccionar', rango: a.rango });
        await esperar(320, mia);
        break;
      case 'escribir':
        if (a.reemplazar) { S.fijarTexto(a.texto); await esperar(300, mia); break; }
        for (const ch of a.texto) { S.teclear(ch); await esperar(a.velocidad || 75, mia); }
        await esperar(250, mia);
        break;
      case 'tecla':
        await mostrarTecla(a, mia);
        S.tecla(a.tecla, a);
        await esperar(300, mia);
        break;
      case 'comando':
        await moverA('cmd:' + a.id, mia); pulso(); S.clic('cmd:' + a.id);
        await esperar(420, mia);
        break;
      case 'elegir':
        await moverA(a.en || 'opcion:' + a.opcion, mia); pulso();
        S.elegir(a.opcion, a.en);
        await esperar(380, mia);
        break;
      case 'resaltar':
        vista.resaltar(a.objetivo);
        try { await esperar(a.ms || 1500, mia); } finally { vista.resaltar(null); }
        break;
      case 'esperar': await esperar(a.ms || 500, mia); break;
      case 'pausa': narracion = a.mensaje || ''; avisar(); break;
      case 'sonido': if (!instantaneo) sonidos.tocar(a.id); break;
      case 'restaurar': vista.cancelarEdicion(); desp.cargar(copia(inicial)); break;
    }
  }

  async function correr() {
    const mia = ++ficha;
    estado = 'reproduciendo'; pidePausa = false; puntero.hidden = false;
    avisar();
    try {
      while (i < guion.length) {
        const a = guion[i];
        await ejecutar(a, mia);
        i++;
        if (a.accion === 'pausa' || pidePausa) { pidePausa = false; if (i < guion.length) { estado = 'pausado'; avisar(); return; } }
      }
      estado = 'fin'; puntero.hidden = true;
      avisar();
      if (alTerminar) alTerminar();
    } catch (e) { if (e !== CANCELADO) throw e; }
  }

  // Vuelve al estado inicial y rehace sin animación las acciones anteriores a "n".
  async function saltarA(n) {
    ficha++;
    vista.cancelarEdicion(); vista.resaltar(null);
    desp.cargar(copia(inicial));
    instantaneo = true; narracion = '';
    try { for (let k = 0; k < n; k++) await ejecutar(guion[k], ficha); } finally { instantaneo = false; }
    i = n; estado = 'pausado'; puntero.hidden = false;
    avisar();
  }
  const bloques = () => guion.map((a, k) => a.accion === 'narrar' ? k : -1).filter(k => k >= 0);

  return api = {
    alCambiar: fn => { oyentes.add(fn); return () => oyentes.delete(fn); },
    // El libro debe estar ya cargado en el estado desde el que parte el guion.
    iniciar(acciones, opc = {}) {
      guion = acciones; i = 0; narracion = ''; alTerminar = opc.alTerminar || null;
      inicial = desp.foto();
      marco.classList.add('demo');
      return correr();
    },
    detener() {
      ficha++; estado = 'detenido'; puntero.hidden = true; etiqueta.hidden = true;
      marco.classList.remove('demo');
      vista.cancelarEdicion(); vista.resaltar(null);
    },
    pausar() { if (estado === 'reproduciendo') { pidePausa = true; avisar(); } },
    continuar() { if (estado === 'pausado') correr(); },
    alternar() { if (estado === 'reproduciendo') this.pausar(); else if (estado === 'pausado') correr(); else if (estado === 'fin') this.repetir(); },
    async repetir() { await saltarA(0); correr(); },
    async anterior() { const b = bloques().filter(k => k < i - 1); await saltarA(b.length ? b[b.length - 1] : 0); },
    async siguiente() { const b = bloques().find(k => k > i); if (b !== undefined) await saltarA(b); },
    velocidad(v) { vel = v; avisar(); },
    estado: () => ({ estado, i, total: guion.length, narracion, vel, pidePausa })
  };
}
