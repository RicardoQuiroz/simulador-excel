// Panel lateral de la lección (instrucciones, lista de pasos, ayudas, controles de la
// demostración, grabadora) y pantallas completas de introducción, checkpoint y resumen.

import { describir } from './grabadora.js';

const esc = s => String(s === undefined || s === null ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

export function crearPanel(panel, capa, lec, reg, opciones = {}) {
  const T = reg.textos.leccion, L = lec.leccion;
  let confirmando = false, firmaCapa = '', firmaPanel = '';
  let notas = [];       // narraciones que el docente escribe entre las acciones grabadas
  let textoGuion = '';  // guion final en JSON, para copiar
  panel.hidden = false;

  const cabecera = s => `<header class="p-cab"><button class="p-plegar" data-a="plegar" title="${esc(panel.classList.contains('abierto') ? T.ocultarPasos : T.verPasos)}">${panel.classList.contains('abierto') ? '✕' : '☰'}</button><div class="p-titulo">${esc(L.identidad.titulo)}</div>
      <button class="p-sonido" data-a="sonido" title="${esc(s.mudo ? T.sonidoNo : T.sonidoSi)}" aria-pressed="${!s.mudo}">${s.mudo ? '🔇' : '🔊'}</button></header>`;

  // ---------------------------------------------------------------- panel
  function panelDemo(s) {
    const r = s.rep, micro = s.estado === 'microdemo';
    const avance = r.total ? Math.round(100 * r.i / r.total) : 0;
    const narr = `<div class="p-narracion" aria-live="polite">${esc(r.narracion || T.demoMirando)}</div>`;
    if (micro) return `<div class="p-progreso"><span>${esc(T.microTitulo)}</span></div><div class="p-cuerpo">${narr}</div>`;
    const corre = r.estado === 'reproduciendo';
    return `<div class="p-progreso"><div class="p-barra"><i style="width:${avance}%"></i></div><span>${esc(T.demoTitulo)}</span></div>
      <div class="p-cuerpo">${narr}
        <div class="p-controles">
          <button data-a="d-anterior" title="${esc(T.demoAnterior)}">⏮</button>
          <button data-a="d-alternar" class="grande" title="${esc(corre ? T.demoPausar : T.demoReproducir)}">${r.estado === 'fin' ? '↻' : corre ? (r.pidePausa ? '…' : '⏸') : '▶'}</button>
          <button data-a="d-siguiente" title="${esc(T.demoSiguiente)}">⏭</button>
        </div>
        <div class="p-velocidad">${[[0.6, T.demoLenta], [1, T.demoNormal], [1.8, T.demoRapida]].map(([v, t]) => `<button data-a="d-vel" data-v="${v}" class="${r.vel === v ? 'activo' : ''}">${esc(t)}</button>`).join('')}</div>
        <div class="p-acciones">
          <button data-a="d-repetir">${esc(T.demoRepetir)}</button>
          ${s.demo && s.demo.volverA === 'grabado' ? `<button data-a="d-salir" class="llamada">${esc(T.grabVolver)}</button>`
            : `<button data-a="d-practicar" class="principal">${esc(T.demoPracticar)}</button><button data-a="d-salir" class="secundario">${esc(T.demoSalir)}</button>`}
        </div>
      </div>`;
  }

  function componer(s) {
    const g = [];
    s.grabacion.forEach((a, k) => { if (notas[k] && notas[k].trim()) g.push({ accion: 'narrar', texto: notas[k].trim() }); g.push(a); });
    if (notas[s.grabacion.length] && notas[s.grabacion.length].trim()) g.push({ accion: 'pausa', mensaje: notas[s.grabacion.length].trim() });
    g.push({ accion: 'restaurar', a: 'inicial' });
    return g;
  }
  function panelGrabado(s) {
    const filas = s.grabacion.map((a, k) => `
        <input class="g-nota" data-k="${k}" placeholder="${esc(T.grabNota)}" value="${esc(notas[k] || '')}">
        <div class="g-accion"><span>${k + 1}</span>${esc(describir(a, reg))}</div>`).join('');
    return `<div class="p-progreso"><span>${esc(T.grabRevisar.replace('{n}', s.grabacion.length))}</span></div>
      <div class="p-cuerpo"><p class="p-ayuda">${esc(T.grabAyuda)}</p>
        <div class="g-lista">${filas}
          <input class="g-nota" data-k="${s.grabacion.length}" placeholder="${esc(T.grabNotaFinal)}" value="${esc(notas[s.grabacion.length] || '')}"></div>
        <div class="p-acciones">
          <button data-a="g-probar" class="principal">${esc(T.grabProbar)}</button>
          <button data-a="g-copiar">${esc(T.grabCopiar)}</button>
          ${textoGuion ? `<textarea class="g-json" readonly rows="6">${esc(textoGuion)}</textarea>` : ''}
          <button data-a="g-grabar" class="secundario">${esc(T.grabOtraVez)}</button>
          <button data-a="intro" class="secundario">${esc(T.demoSalir)}</button>
        </div></div>`;
  }

  function panelLeccion(s) {
    const hechos = s.res.filter(r => r.hecho).length, total = s.pasos.length;
    const lista = s.pasos.map((p, k) => {
      const r = s.res[k], clase = r.hecho ? 'hecho' : k === s.i ? 'actual' : 'pend';
      return `<li class="${clase}"><span class="p-marca">${r.hecho ? '✓' : k + 1}</span><div class="p-texto">${esc(p.instruccion)}</div></li>`;
    }).join('');
    const fb = s.feedback ? `<div class="p-feedback ${s.feedback.tipo}">${esc(s.feedback.texto)}</div>` : '';
    const pistas = s.pistas.map((t, k) => `<div class="p-pista"><b>${esc(T.pista)} ${k + 1}.</b> ${esc(t)}</div>`).join('');
    const sol = s.solucion ? `<div class="p-pista p-solucion"><b>${esc(T.muestrame)}.</b> ${esc(s.solucion)}</div>` : '';
    const quedan = s.totalPistas - s.pistas.length;
    const acciones = s.estado !== 'guiado' ? '' : `<div class="p-acciones">
        ${s.avisoPista ? `<div class="p-oferta">${esc(T.pistaDisponible)}</div>` : ''}
        ${quedan > 0 ? `<button data-a="pista" class="${s.avisoPista ? 'llamada' : ''}">${esc(s.pistas.length ? T.otraPista : T.verPista)} (${s.pistas.length + 1} ${esc(T.de)} ${s.totalPistas})</button>` : ''}
        ${s.puedeMuestrame && !s.solucion ? `<button data-a="muestrame">${esc(T.muestrame)}</button>` : ''}
        <button data-a="reiniciar-paso" class="secundario">${esc(T.reiniciarPaso)}</button>
      </div>`;
    return `<div class="p-progreso"><div class="p-barra"><i style="width:${total ? 100 * hechos / total : 0}%"></i></div>
        <span>${s.modo === 'reto' ? esc(T.retoTitulo) : `${esc(T.paso)} ${Math.min(s.i + 1, total)} ${esc(T.de)} ${total}`}</span></div>
      <div class="p-cuerpo"><ol class="p-pasos">${lista}</ol>
        <div class="p-vivo" aria-live="polite">${fb}${pistas}${sol}</div>${acciones}</div>
      <footer class="p-pie"><button data-a="reiniciar-leccion" class="secundario">${esc(T.reiniciarLeccion)}</button></footer>`;
  }

  function pintarPanel(s) {
    let html;
    if (s.estado === 'demo' || s.estado === 'microdemo') html = panelDemo(s);
    else if (s.estado === 'grabando') {
      const ult = s.grabados.slice(-6).map(a => `<div class="g-accion">${esc(describir(a, reg))}</div>`).join('');
      html = `<div class="p-progreso"><span class="g-rec">● ${esc(T.grabando)}</span></div>
        <div class="p-cuerpo"><p class="p-ayuda">${esc(T.grabandoAyuda)}</p><div class="g-lista">${ult}</div>
        <div class="p-acciones"><button data-a="g-detener" class="principal">${esc(T.grabDetener)} (${s.grabados.length})</button></div></div>`;
    } else if (s.estado === 'grabado') {
      // No se repinta mientras el docente escribe sus narraciones.
      if (firmaPanel === 'grabado' + s.grabacion.length + textoGuion.length) return;
      html = panelGrabado(s);
    } else if (s.estado === 'libre') html = `<div class="p-cuerpo"><p class="p-libre">${esc(T.practicaLibre)}</p></div>
        <footer class="p-pie"><button data-a="intro">${esc(T.terminarLibre)}</button></footer>`;
    else html = s.modo ? panelLeccion(s) : '';
    firmaPanel = s.estado === 'grabado' ? 'grabado' + s.grabacion.length + textoGuion.length : '';
    panel.innerHTML = cabecera(s) + html;
    const actual = panel.querySelector('.p-pasos .actual');
    if (actual && actual.scrollIntoView) actual.scrollIntoView({ block: 'nearest' });
  }

  // ---------------------------------------------------------------- pantallas completas
  function tarjetaIntro(s) {
    const P = L.pedagogia || {};
    return `<h1>${esc(L.identidad.titulo)}</h1>
      ${P.objetivos ? `<p class="t-sub">${esc(T.objetivos)}</p><ul>${P.objetivos.map(o => `<li>${esc(o)}</li>`).join('')}</ul>` : ''}
      ${L.identidad.duracionMin ? `<p class="t-nota">${esc(T.duracion.replace('{n}', L.identidad.duracionMin))}</p>` : ''}
      <p class="t-nota">${esc(T.avisoNota)}${s.promedio !== null ? ' ' + esc(T.promedio.replace('{n}', s.intentos.length)) + ': <b>' + s.promedio + '</b>' : ''}</p>
      <div class="t-botones">
        ${s.tieneDemo ? `<button data-a="demo" class="${s.intentos.length || s.hayProgreso ? '' : 'primario'}">▶ ${esc(T.mostrarComo)}</button>` : ''}
        ${s.hayProgreso ? `<button class="primario" data-a="reanudar">${esc(T.continuarGuardado)}</button><button data-a="empezar">${esc(T.empezarNuevo)}</button>`
          : `<button class="${s.tieneDemo && !s.intentos.length ? '' : 'primario'}" data-a="empezar">${esc(T.empezar)}</button>`}
        ${L.reto && L.modos && L.modos.reto ? `<button data-a="reto">${esc(T.reto)}</button>` : ''}
        ${!L.modos || L.modos.libre ? `<button data-a="libre">${esc(T.libre)}</button>` : ''}
      </div>
      ${opciones.docente ? `<div class="t-docente"><button data-a="g-grabar">● ${esc(T.grabIniciar)}</button>${opciones.alConfigurar ? ` <button data-a="configurar">${esc(T.cambiarLeccion)}</button>` : ''}</div>` : ''}`;
  }

  function tarjetaCheckpoint(s) {
    const k = s.checkpoint, cp = k.cp;
    if (cp.tipo === 'pregunta') {
      const q = cp.pregunta, resp = k.elegida !== null;
      return `<p class="t-sub">${esc(T.pregunta)}</p><h2>${esc(q.enunciado)}</h2>
        <div class="t-opciones">${q.opciones.map((o, i) => {
          const clase = !resp ? '' : o.correcta ? 'bien' : i === k.elegida ? 'mal' : 'apagada';
          return `<button data-a="responder" data-i="${i}" class="${clase}" ${resp ? 'disabled' : ''}>${esc(o.texto)}</button>
            ${resp && (i === k.elegida || o.correcta) && o.explicacion ? `<div class="t-explica ${o.correcta ? 'bien' : 'mal'}">${esc(o.explicacion)}</div>` : ''}`;
        }).join('')}</div>
        ${resp ? `<div class="t-botones"><button class="primario" data-a="cerrar-cp">${esc(T.continuar)}</button></div>` : ''}`;
    }
    const alt = cp.alternativaLigera || {}, m = cp.medio || {};
    const video = m.origen === 'youtube' && m.id && m.id !== 'REEMPLAZAR';
    return `<p class="t-sub">${esc(T.pausa)}</p>
      ${alt.texto ? `<p class="t-texto">${esc(alt.texto)}</p>` : ''}
      ${alt.imagen ? `<img class="t-img" src="${esc(alt.imagen)}" alt="" loading="lazy">` : ''}
      ${video ? `<div class="t-video" data-id="${esc(m.id)}"><button data-a="video">▶ ${esc(T.verVideo)}</button></div>` : ''}
      <div class="t-botones"><button class="primario" data-a="cerrar-cp">${esc(T.continuar)}</button></div>`;
  }

  function tarjetaResumen(s) {
    const dominada = s.promedio !== null && s.promedio >= s.dominio;
    const filas = s.pasos.map((p, k) => {
      const r = s.res[k];
      return `<tr><td>${k + 1}. ${esc(p.instruccion.length > 60 ? p.instruccion.slice(0, 58) + '…' : p.instruccion)}</td><td>${r.errores}</td><td>${r.muestrame ? esc(T.muestrame) : r.pista}</td><td>${r.pct}%</td></tr>`;
    }).join('');
    const C = L.cierre || {};
    return `<h1>${esc(T.resumenTitulo)}</h1>
      <div class="t-notas">
        <div class="t-nota-caja"><span>${esc(T.notaIntento)}</span><b>${s.nota}</b></div>
        <div class="t-nota-caja ${dominada ? 'bien' : ''}"><span>${esc(T.promedio.replace('{n}', s.intentos.length))}</span><b>${s.promedio}</b>
          <small>${esc(dominada ? T.dominada : T.porDominar.replace('{n}', s.dominio))}</small></div>
      </div>
      ${C.mensaje ? `<p class="t-texto">${esc(C.mensaje)}</p>` : ''}
      ${C.resumen ? `<ul>${C.resumen.map(x => `<li>${esc(x)}</li>`).join('')}</ul>` : ''}
      <table class="t-tabla"><thead><tr><th>${esc(T.paso)}</th><th>${esc(T.colErrores)}</th><th>${esc(T.colPistas)}</th><th>${esc(T.colPuntos)}</th></tr></thead><tbody>${filas}</tbody></table>
      <div class="t-botones">
        <button class="primario" data-a="empezar">${esc(T.repetir)}</button>
        ${L.reto && L.modos && L.modos.reto && s.modo !== 'reto' ? `<button data-a="reto">${esc(T.reto)}</button>` : ''}
        ${!L.modos || L.modos.libre ? `<button data-a="libre">${esc(T.libre)}</button>` : ''}
        <button data-a="intro">${esc(T.irInicio)}</button>
      </div>`;
  }

  function tarjetaConfirmar() {
    return `<h2>${esc(T.confirmarTitulo)}</h2><p class="t-texto">${esc(T.confirmarReinicio)}</p>
      <div class="t-botones"><button class="primario" data-a="reiniciar-si">${esc(T.confirmarSi)}</button><button data-a="reiniciar-no">${esc(T.confirmarNo)}</button></div>`;
  }

  function pintar() {
    const s = lec.estado();
    pintarPanel(s);
    const visible = confirmando || s.estado === 'intro' || s.estado === 'checkpoint' || s.estado === 'resumen';
    if (!visible) { capa.hidden = true; capa.innerHTML = ''; firmaCapa = ''; return; }
    const firma = confirmando + s.estado + '|' + (s.checkpoint ? s.checkpoint.cp.id + ':' + s.checkpoint.elegida : '') + '|' + s.intentos.length + '|' + s.hayProgreso;
    if (firma === firmaCapa) return; // no se repinta: así un video abierto no se interrumpe
    firmaCapa = firma;
    capa.innerHTML = '<div class="tarjeta" role="dialog" aria-modal="true">' +
      (confirmando ? tarjetaConfirmar() : s.estado === 'intro' ? tarjetaIntro(s) : s.estado === 'checkpoint' ? tarjetaCheckpoint(s) : tarjetaResumen(s)) + '</div>';
    capa.hidden = false;
    // Sin intentos disponibles: se quitan los botones que abrirían otro intento con nota.
    if (s.agotado && !confirmando && (s.estado === 'intro' || s.estado === 'resumen')) {
      for (const b of capa.querySelectorAll('[data-a="empezar"], [data-a="reanudar"], [data-a="reto"]')) b.remove();
      const caja = capa.querySelector('.t-botones');
      if (caja) caja.insertAdjacentHTML('beforebegin', '<p class="t-agotado">' + esc(T.sinIntentos.replace('{n}', s.maxIntentos)) + '</p>');
    }
    for (const img of capa.querySelectorAll('img')) img.addEventListener('error', () => img.remove());
    // El foco va al botón principal; en una pregunta no se preselecciona ninguna opción.
    const tarjeta = capa.firstElementChild, primero = capa.querySelector('button.primario');
    tarjeta.tabIndex = -1;
    (primero || tarjeta).focus();
  }

  async function copiar(texto) {
    try { await navigator.clipboard.writeText(texto); return true; } catch (_) { return false; }
  }

  function accion(e) {
    const b = e.target.closest('[data-a]');
    if (!b) return;
    const a = b.dataset.a, R = lec.repro;
    if (a !== 'plegar' && a !== 'sonido' && a !== 'pista') panel.classList.remove('abierto');
    switch (a) {
      case 'plegar': panel.classList.toggle('abierto'); firmaPanel = ''; pintar(); break;
      case 'sonido': lec.alternarSonido(); break;
      case 'pista': lec.pedirPista(); break;
      case 'muestrame': lec.muestrame(); break;
      case 'reiniciar-paso': lec.reiniciarPaso(); break;
      case 'reiniciar-leccion': confirmando = true; pintar(); break;
      case 'reiniciar-si': confirmando = false; lec.reiniciarLeccion(); break;
      case 'reiniciar-no': confirmando = false; pintar(); break;
      case 'empezar': lec.empezar('guiado'); break;
      case 'reanudar': lec.reanudar(); break;
      case 'reto': lec.empezar('reto'); break;
      case 'libre': lec.empezar('libre'); break;
      case 'intro': textoGuion = ''; lec.irAIntro(); break;
      case 'responder': lec.responder(+b.dataset.i); break;
      case 'cerrar-cp': lec.cerrarCheckpoint(); break;
      case 'demo': lec.demo(); break;
      case 'configurar': opciones.alConfigurar(); break;
      case 'd-alternar': R.alternar(); break;
      case 'd-anterior': R.anterior(); break;
      case 'd-siguiente': R.siguiente(); break;
      case 'd-repetir': R.repetir(); break;
      case 'd-vel': R.velocidad(+b.dataset.v); break;
      case 'd-practicar': lec.salirDemo('guiado'); break;
      case 'd-salir': lec.salirDemo(); break;
      case 'g-grabar': notas = []; textoGuion = ''; lec.grabar(); break;
      case 'g-detener': lec.detenerGrabacion(); break;
      case 'g-probar': lec.demo(componer(lec.estado()), 'grabado'); break;
      case 'g-copiar':
        textoGuion = JSON.stringify(componer(lec.estado()), null, 2);
        copiar(textoGuion).then(ok => { b.textContent = ok ? T.grabCopiado : T.grabCopiaManual; });
        pintar();
        { const ta = panel.querySelector('.g-json'); if (ta) ta.select(); }
        break;
      case 'video': {
        const caja = b.closest('.t-video'), f = document.createElement('iframe');
        f.src = 'https://www.youtube-nocookie.com/embed/' + encodeURIComponent(caja.dataset.id) + '?autoplay=1&rel=0';
        f.allow = 'autoplay; encrypted-media; fullscreen'; f.title = T.verVideo;
        caja.replaceChildren(f);
        break;
      }
    }
  }
  panel.addEventListener('click', accion);
  capa.addEventListener('click', accion);
  panel.addEventListener('mousedown', e => { if (e.target.closest('button')) e.preventDefault(); });
  panel.addEventListener('input', e => { if (e.target.classList.contains('g-nota')) notas[+e.target.dataset.k] = e.target.value; });
  panel.addEventListener('keydown', e => { if (e.target.closest('input, textarea')) e.stopPropagation(); });

  lec.alCambiar(pintar);
  pintar();
}
