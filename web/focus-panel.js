/* Study clock UI. The clock owns timing and persistence; this view never grades work. */
(function () {
  'use strict';
  const fmt = n => { n = Math.max(0, Math.floor(Number(n) || 0)); return `${Math.floor(n / 60).toString().padStart(2, '0')}:${(n % 60).toString().padStart(2, '0')}`; };
  const duration = n => `${Math.round((Number(n) || 0) / 60)} min`;
  function mount(clock) {
    if (document.getElementById('focus-dialog')) return;
    let prefs = {}; try { prefs = JSON.parse(localStorage.getItem('glosa.focus.prefs') || '{}'); } catch (_) {}
    prefs.sound ??= true;
    let closing = false, previousReady = false, audioContext, noticeKey = '', dismissedKey = '';
    function enableSound(){
      if(!prefs.sound)return;
      try{audioContext ||= new (window.AudioContext || window.webkitAudioContext)();audioContext.resume().catch(()=>{});}catch{}
    }
    const button = document.createElement('button');
    button.id = 'focus-clock-button'; button.type = 'button'; button.setAttribute('aria-haspopup', 'dialog'); button.setAttribute('aria-controls', 'focus-dialog');
    document.getElementById('global-command-button').before(button);
    const dialog = document.createElement('dialog'); dialog.id = 'focus-dialog'; dialog.setAttribute('aria-label', 'Sesión de estudio');
    dialog.innerHTML = `<div class="focus-head"><span class="eyebrow">UN TIEMPO PARA ENTENDER</span><button type="button" data-action="close" aria-label="Cerrar sesión de estudio">×</button></div>
      <h2>Tu sesión de estudio</h2><p class="focus-context"></p>
      <div class="focus-dial"><svg viewBox="0 0 160 160" aria-hidden="true"><circle class="focus-track" cx="80" cy="80" r="71"/><circle class="focus-ring" cx="80" cy="80" r="71"/></svg><div><span class="focus-phase">A tu ritmo</span><strong class="focus-time">25:00</strong><span class="focus-caption">Un bloque, una cosa a la vez.</span></div></div>
      <p class="focus-error" role="alert" hidden></p><div class="focus-gap" hidden><p>El reloj encontró un intervalo que necesita revisión. ¿Querés contarlo como estudio?</p><button data-action="keep">Sí, contar ese tiempo</button><button data-action="discard">No, descartarlo</button></div>
      <form class="focus-setup"><fieldset><legend>Elegí tu ritmo</legend><div class="focus-presets"><label><input type="radio" name="rhythm" value="25" checked><span>25 / 5<small>Foco y descanso</small></span></label><label><input type="radio" name="rhythm" value="50"><span>50 / 10<small>Bloque largo</small></span></label><label><input type="radio" name="rhythm" value="custom"><span>A medida<small>Tu duración</small></span></label><label><input type="radio" name="rhythm" value="free"><span>Libre<small>Sin cuenta atrás</small></span></label></div></fieldset>
      <div class="focus-custom" hidden><label>Foco · minutos<input name="focusMinutes" type="number" min="1" max="240" value="25"></label><label>Descanso · minutos<input name="breakMinutes" type="number" min="1" max="60" value="5"></label></div><label class="focus-goal">¿En qué querés avanzar? <span>Opcional</span><input name="goal" maxlength="240" placeholder="Una idea, un tema, un ejercicio…"></label><button class="focus-primary" type="submit">Empezar a estudiar</button></form>
      <div class="focus-session" hidden><p class="focus-session-goal"></p><div class="focus-actions"><button class="focus-primary" data-action="pause">Pausar</button><button class="focus-primary" data-action="resume">Continuar</button><button data-action="break">Tomar un descanso</button><button data-action="focus">Seguir estudiando</button><button data-action="finish">Finalizar sesión</button></div></div>
      <section class="focus-rating" hidden><h3>¿Cómo te resultó?</h3><p>Esta valoración es opcional. El reloj está pausado.</p><div class="focus-actions"><button data-rating="hard">Costó</button><button data-rating="okay">Bien</button><button data-rating="easy">Fácil</button></div><button data-action="finish-unrated">Finalizar sin valorar</button><button data-action="cancel-finish">Volver a la sesión</button></section>
      <details class="focus-options"><summary>Preferencias</summary><label><input type="checkbox" name="hideCount"> Ocultar la cuenta mientras estudio</label><label><input type="checkbox" name="sound"> Sonido suave al terminar un bloque</label></details>
      <section class="focus-stats"><div class="focus-stats-head"><h3>Tu estudio</h3><button data-action="refresh">Actualizar</button></div><p class="focus-scope">En este pliego · últimos 7 días</p><div class="focus-stats-content">Todavía no se cargaron los datos.</div><p class="focus-stats-note">El tiempo acompaña tu estudio; no demuestra comprensión. Foco es tiempo registrado por el reloj; uso visible es Glosa en primer plano.</p></section>`;
    document.body.append(dialog);
    const notice=document.createElement('section');notice.id='focus-notice';notice.hidden=true;
    notice.setAttribute('aria-label','Aviso del temporizador');
    notice.innerHTML='<p role="status" aria-live="polite" aria-atomic="true"></p><div class="focus-notice-actions"></div>';
    (document.querySelector('.topbar')||button).after(notice);
    const notificationOption=document.createElement('label');
    notificationOption.innerHTML='<input type="checkbox" name="notifications"> Avisos de escritorio al terminar (requieren permiso del navegador)';
    dialog.querySelector('.focus-options').append(notificationOption);
    const notificationInput=notificationOption.querySelector('input');
    notificationInput.checked=!!prefs.notifications&&window.Notification?.permission==='granted';
    notificationInput.disabled=!('Notification' in window);
    notificationInput.addEventListener('change',async()=>{
      try{prefs.notifications=notificationInput.checked&&(await Notification.requestPermission())==='granted';}
      catch{prefs.notifications=false;}
      notificationInput.checked=prefs.notifications;
      try{localStorage.setItem('glosa.focus.prefs',JSON.stringify(prefs));}catch{}
    });
    function announce(session,ready,remaining){
      const warning=session?.status==='running'&&session.mode==='pomodoro'&&session.plannedSeconds>=300&&remaining<=60;
      const key=session&&(ready||warning)?`${session.id}:${session.phase}:${session.cycles}:${ready?'ready':'minute'}`:'';
      const text=ready?(session.phase==='focus'?'Terminó el bloque de foco. ¿Querés descansar, seguir estudiando o finalizar?':'Terminó el descanso. ¿Querés empezar otro bloque o finalizar la sesión?'):
        session?.phase==='break'?'Falta un minuto de descanso. Podés ir preparándote para volver.':'Falta un minuto de foco. Buscá un punto donde dejar tu tarea para descansar.';
      if(key!==noticeKey){
        noticeKey=key;
        notice.querySelector('p').textContent=key?text:'';
        const actions=notice.querySelector('div');actions.replaceChildren();
        const add=(label,fn)=>{const b=document.createElement('button');b.type='button';b.textContent=label;b.addEventListener('click',fn);actions.append(b);};
        if(ready){
          if(session.phase==='focus')add('Tomar un descanso',()=>run(()=>clock.transition('break')));
          add(session.phase==='break'?'Empezar otro bloque':'Seguir estudiando',()=>run(()=>clock.transition('focus')));
          add('Finalizar sesión',()=>{closing=true;button.click();});
        }
        if(key)add('Ahora no',()=>{dismissedKey=key;notice.hidden=true;});
      }
      notice.hidden=!key||key===dismissedKey||dialog.open;
      if(ready&&!previousReady){
        chime();
        if(document.hidden&&prefs.notifications&&window.Notification?.permission==='granted'){
          try{const notification=new Notification('Glosa · '+(session.phase==='focus'?'Foco completo':'Descanso completo'),{body:text,tag:'glosa-focus'});notification.onclick=()=>{window.focus();button.click();notification.close();};}catch{}
        }
      }
    }
    const $ = s => dialog.querySelector(s);
    const show = (s, yes) => { $(s).hidden = !yes; };
    $('[name=hideCount]').checked = !!prefs.hideCount; $('[name=sound]').checked = !!prefs.sound;
    async function run(fn) { try { show('.focus-error', false); await fn(); render(); } catch (e) { $('.focus-error').textContent = e.message || 'No pudimos guardar el cambio. Intentá nuevamente.'; show('.focus-error', true); } }
    function chime() { if (!prefs.sound || !audioContext) return; try { const oscillator = audioContext.createOscillator(), gain = audioContext.createGain(); oscillator.connect(gain); gain.connect(audioContext.destination); oscillator.frequency.value = 528; gain.gain.setValueAtTime(.06, audioContext.currentTime); gain.gain.exponentialRampToValueAtTime(.001, audioContext.currentTime + .6); oscillator.start(); oscillator.stop(audioContext.currentTime + .6); } catch (_) {} }
    function render() {
      const s = clock.snapshot(), session = s.session, ready = session?.status === 'ready', running = session?.status === 'running';
      if(!session)closing=false;
      const phase = !session ? 'A tu ritmo' : ready ? 'Bloque completo' : session.status === 'paused' ? 'En pausa' : session.phase === 'break' ? 'Descanso' : 'Foco';
      const time = fmt(session?.mode === 'free' && session?.phase === 'focus' ? s.elapsedSeconds : s.remainingSeconds);
      if(s.error){if($('.focus-error').textContent!==s.error)$('.focus-error').textContent=s.error;show('.focus-error',true);}else show('.focus-error',false);
      button.textContent = `◷ ${session ? phase : 'Estudiar'}${session && !prefs.hideCount ? ` ${time}` : ''}`;
      button.setAttribute('aria-label', session ? `Sesión de estudio: ${phase}${!prefs.hideCount ? `, ${time}` : ''}` : 'Abrir temporizador de estudio');
      $('.focus-phase').textContent = phase; $('.focus-time').textContent = prefs.hideCount && session && !ready ? '—' : session ? time : '25:00';
      $('.focus-caption').textContent = s.pendingCount ? 'Guardado local · pendiente de sincronizar' : ready ? 'Elegí cómo seguir.' : session?.mode === 'free' ? 'Cronómetro libre' : session ? 'Tu trabajo queda a tu ritmo.' : 'Un bloque, una cosa a la vez.';
      $('.focus-ring').style.strokeDashoffset = String(446.1 * (1 - (session?.plannedSeconds > 0 ? Math.min(1, s.elapsedSeconds / session.plannedSeconds) : 0)));
      $('.focus-context').textContent = clock.context().title || 'Tu espacio de estudio';
      $('.focus-session-goal').textContent = session?.goal || '';
      show('.focus-setup', !session); show('.focus-session', !!session && !closing); show('.focus-rating', closing); show('.focus-gap', !!s.uncertain);
      show('[data-action=pause]', running); show('[data-action=resume]', session?.status === 'paused' && !s.uncertain); show('[data-action=break]', ready && session?.phase === 'focus' && session?.mode !== 'free'); show('[data-action=focus]', ready); show('[data-action=finish]', !!session && !s.uncertain);
      announce(session,ready,s.remainingSeconds);
      previousReady = ready;
      $('.focus-caption').textContent=ready?(session.phase==='focus'?'¿Querés descansar, seguir o finalizar?':'¿Querés empezar otro bloque o finalizar?'):$('.focus-caption').textContent;
    }
    function node(tag, text, className) { const el = document.createElement(tag); el.textContent = text; if (className) el.className = className; return el; }
    async function stats() {
      const target = $('.focus-stats-content'); target.textContent = 'Cargando tu estudio…';
      try { await clock.flush(); const response = await fetch('/api/study-summary'); if (!response.ok) throw new Error(); const data = await response.json(); target.replaceChildren();
        const today = data.today || {}, total = data.total || {};
        target.append(node('h4', 'Hoy'), node('p', `${duration(today.focusSeconds)} de foco · ${duration(today.breakSeconds)} de descanso · ${duration(today.visibleSeconds)} de uso visible · ${today.sessionsFinished || 0} sesiones finalizadas`, 'focus-totals'));
        const days = data.days || [], chart = node('div', '', 'focus-week'); chart.setAttribute('role', 'img'); chart.setAttribute('aria-label', `Foco de los últimos siete días: ${days.map(d => `${d.date}: ${duration(d.focusSeconds)}`).join('; ')}`); const max = Math.max(60, ...days.map(d => d.focusSeconds || 0));
        days.forEach(d => { const col = node('div', '', 'focus-day'), bar = node('span', '', 'focus-bar'); bar.style.height = `${Math.max(3, (d.focusSeconds || 0) / max * 72)}px`; bar.title = `${d.date}: ${duration(d.focusSeconds)}`; col.append(node('small', duration(d.focusSeconds)), bar, node('small', String(d.date || '').slice(5))); chart.append(col); }); target.append(chart, node('p', `Semana: ${duration(total.focusSeconds)} de foco · ${duration(total.breakSeconds)} de descanso · ${duration(total.visibleSeconds)} de uso visible · ${total.sessionsFinished || 0} sesiones finalizadas`, 'focus-totals'));
        for (const [title, rows, label] of [['Por materia', data.courses || [], 'title'], ['Por actividad', data.activities || [], 'view']]) { if (!rows.length) continue; target.append(node('h4', title)); const list = node('ul', '', 'focus-breakdown'); const names = {study:'Estudiar',notes:'Apuntes',notebook:'Cuaderno',plan:'Plan'}; rows.forEach(row => { const li = node('li', ''); li.append(node('span', names[row[label]] || row[label] || 'Sin materia'), node('strong', duration(row.focusSeconds))); list.append(li); }); target.append(list); }
        if(total.uncertainSeconds)target.append(node('p',`${duration(total.uncertainSeconds)} requieren interpretar la estimación: incluyen tiempo histórico aproximado o tramos revisados.`, 'focus-stats-note'));
        if (!total.focusSeconds) target.append(node('p', 'Tu primera sesión es un buen comienzo. Los datos aparecerán acá.'));
      } catch (_) { target.textContent = 'No pudimos cargar las estadísticas. Podés seguir estudiando y volver a intentar.'; }
    }
    button.addEventListener('click', () => { enableSound(); if (!dialog.open) dialog.showModal(); const goal = $('[name=goal]'); if (!goal.value) goal.value = clock.context().title || ''; render(); stats(); });
    dialog.addEventListener('close',render);
    $('.focus-setup').addEventListener('submit', e => { enableSound(); e.preventDefault(); if (!$('.focus-setup').reportValidity()) return; const rhythm = $('[name=rhythm]:checked').value; run(() => clock.start({mode: rhythm === 'free' ? 'free' : 'pomodoro', focusSeconds: (rhythm === '50' ? 50 : rhythm === 'custom' ? Number($('[name=focusMinutes]').value) : 25) * 60, breakSeconds: (rhythm === '50' ? 10 : rhythm === 'custom' ? Number($('[name=breakMinutes]').value) : 5) * 60, goal: $('[name=goal]').value.trim()})); });
    dialog.addEventListener('change', e => { if (e.target.name === 'rhythm') show('.focus-custom', e.target.value === 'custom'); if (['hideCount','sound'].includes(e.target.name)) { prefs[e.target.name] = e.target.checked; try { localStorage.setItem('glosa.focus.prefs', JSON.stringify(prefs)); } catch (_) {} if (prefs.sound) { try { audioContext ||= new (window.AudioContext || window.webkitAudioContext)(); audioContext.resume(); } catch (_) {} } render(); } });
    dialog.addEventListener('click', e => { const el = e.target.closest('button'); if (!el) return; const action = el.dataset.action; if (el.dataset.rating) return run(async () => { await clock.finish({rating:el.dataset.rating}); closing = false; await stats(); });
      if (action === 'close') dialog.close(); else if (action === 'refresh') stats(); else if (action === 'pause') run(() => clock.pause()); else if (action === 'resume') run(() => clock.resume()); else if (action === 'break' || action === 'focus') {enableSound();run(() => clock.transition(action));} else if (action === 'finish') run(async () => { if (clock.snapshot().session?.status === 'running') await clock.pause(); closing = true; }); else if (action === 'cancel-finish') { closing = false; render(); } else if (action === 'finish-unrated') run(async () => { await clock.finish({}); closing = false; await stats(); }); else if (action === 'keep' || action === 'discard') run(() => clock.resolveGap({count:action === 'keep'}));
    });
    clock.subscribe(render); render();
    return {open: () => button.click(), refresh:render};
  }
  window.FocusPanel = {mount};
})();
