/* Share lesson content without personal study history. */
(function () {
  'use strict';
  let active;
  const el = (tag, text, cls) => { const node = document.createElement(tag); if (text != null) node.textContent = text; if (cls) node.className = cls; return node; };
  function open(roomId = window.GlosaRoom?.id) {
    if (active) { active.focus(); return; }
    const previousFocus = document.activeElement;
    const dialog = el('dialog', null, 'lesson-export-dialog'); active = dialog;
    dialog.setAttribute('aria-labelledby', 'lesson-export-title');
    const head = el('div', null, 'lesson-export-head');
    const title = el('h2', 'Exportar lecciones'); title.id = 'lesson-export-title';
    const close = el('button', '×'); close.type = 'button'; close.setAttribute('aria-label', 'Cerrar exportación');
    head.append(title, close); dialog.append(head);
    dialog.append(el('p', 'Compartí el material sin conversaciones, respuestas ni estadísticas personales.'));
    const status = el('p', 'Cargando lecciones…'); status.setAttribute('role', 'status'); dialog.append(status);
    const content = el('div'); dialog.append(content);
    const error = el('p', null, 'lesson-export-error'); error.setAttribute('role', 'alert'); error.hidden = true; dialog.append(error);
    const actions = el('div', null, 'lesson-export-actions');
    const download = el('button', 'Descargar HTML'); const print = el('button', 'Abrir para PDF');
    [download, print].forEach(button => { button.type = 'button'; button.disabled = true; });
    actions.append(download, print); dialog.append(actions, el('p', 'Se abre una copia para guardar como PDF con el navegador.', 'lesson-export-hint'));
    document.body.append(dialog); dialog.showModal();
    const controller = new AbortController();
    close.onclick = () => dialog.close();
    dialog.addEventListener('close', () => { controller.abort(); active = null; dialog.remove(); if (previousFocus?.isConnected) previousFocus.focus({ preventScroll: true }); }, { once: true });
    let manifest, busy = false;
    const lessonInputs = [], noteInputs = [];
    const headers = { 'X-Glosa-Room': String(roomId ?? '') };
    function selected() { return lessonInputs.filter(item => item.input.checked); }
    function update() {
      const chosen = selected(); status.textContent = `${chosen.length} de ${lessonInputs.length} lecciones seleccionadas`;
      for (const item of noteInputs) {
        const reachable = item.note.referencedBy?.some(ref => chosen.some(lesson => lesson.courseId === ref.courseId && lesson.lessonId === ref.lessonId));
        item.label.hidden = !reachable; item.input.disabled = !reachable;
      }
      download.disabled = print.disabled = busy || chosen.length === 0;
    }
    function checkbox(text, checked, parent) {
      const label = el('label', null, 'lesson-export-choice'), input = el('input'); input.type = 'checkbox'; input.checked = checked;
      label.append(input, el('span', text)); parent.append(label); return { input, label };
    }
    let solutions;
    async function exportFile(asPrint) {
      let target;
      error.hidden = true;
      if (asPrint) {
        target = window.open('about:blank', '_blank');
        if (!target) { error.textContent = 'El navegador bloqueó la pestaña. Permití ventanas emergentes o descargá el HTML.'; error.hidden = false; return; }
        target.opener = null;
        target.document.title = 'Preparando exportación'; target.document.body.textContent = 'Preparando las lecciones para imprimir…';
      }
      busy = true; update();
      try {
        const selection = manifest.courses.map(course => ({ courseId: course.id, lessonIds: selected().filter(item => item.courseId === course.id).map(item => item.lessonId) })).filter(course => course.lessonIds.length);
        const body = { selection, noteIds: noteInputs.filter(item => !item.input.disabled && item.input.checked).map(item => item.note.id), includeSolutions: solutions.checked };
        if (asPrint) { target.location.href = '/api/lesson-export-document?room=' + encodeURIComponent(roomId) + '&options=' + encodeURIComponent(JSON.stringify(body)); return; }
        const response = await fetch('/api/lesson-export', { method: 'POST', headers: { ...headers, 'Content-Type': 'application/json' }, signal: controller.signal, body: JSON.stringify({ selection, noteIds: noteInputs.filter(item => !item.input.disabled && item.input.checked).map(item => item.note.id), includeSolutions: solutions.checked }) });
        if (!response.ok) throw new Error('No se pudo generar la exportación. Intentá nuevamente.');
        const html = await response.text();
        const url = URL.createObjectURL(new Blob([html], { type: 'text/html;charset=utf-8' }));
        if (asPrint) { if (!target.closed) target.location.href = url; }
        else { const link = el('a'); link.href = url; link.download = 'export-lecciones.html'; document.body.append(link); link.click(); link.remove(); }
        setTimeout(() => URL.revokeObjectURL(url), 300000);
      } catch (err) {
        if (target && !target.closed) target.close();
        if (err.name !== 'AbortError') { error.textContent = err.message || 'No se pudo exportar.'; error.hidden = false; }
      } finally { busy = false; update(); }
    }
    download.onclick = () => exportFile(false); print.onclick = () => exportFile(true);
    fetch('/api/lesson-export-manifest', { headers, signal: controller.signal }).then(async response => {
      if (!response.ok) throw new Error('No se pudieron cargar las lecciones. Cerrá y volvé a intentar.');
      manifest = await response.json();
      dialog.insertBefore(el('p', manifest.title, 'lesson-export-room'), status);
      const toolbar = el('div', null, 'lesson-export-toolbar');
      for (const [text, checked] of [['Marcar todas', true], ['Ninguna', false]]) { const button = el('button', text); button.type = 'button'; button.onclick = () => { lessonInputs.forEach(item => { item.input.checked = checked; }); update(); }; toolbar.append(button); }
      content.append(toolbar);
      for (const course of manifest.courses || []) {
        if (!course.lessons?.length) continue;
        const group = el('fieldset'); group.append(el('legend', course.title));
        for (const lesson of course.lessons) {
          const detail = [lesson.unit, lesson.minutes ? `${lesson.minutes} min` : ''].filter(Boolean).join(' · ');
          const { input } = checkbox(lesson.title + (detail ? ` — ${detail}` : ''), true, group);
          lessonInputs.push({ input, courseId: course.id, lessonId: lesson.id }); input.onchange = update;
        }
        content.append(group);
      }
      if (!lessonInputs.length) content.append(el('p', 'Este pliego todavía no tiene lecciones para exportar.'));
      const options = el('div', null, 'lesson-export-options');
      solutions = checkbox('Incluir soluciones', false, options).input;
      const notes = el('details'); notes.append(el('summary', 'Notas de conceptos'));
      notes.append(el('p', 'Las notas propias se incluyen solo si las elegís explícitamente. Se muestran las enlazadas a las lecciones seleccionadas.', 'lesson-export-hint'));
      for (const note of manifest.notes || []) {
        const item = checkbox(note.title + (!note.shared ? ' · Nota propia' : ''), note.shared === true, notes);
        noteInputs.push({ ...item, note });
      }
      options.append(notes); content.append(options); update();
    }).catch(err => { if (err.name !== 'AbortError') { status.textContent = ''; error.textContent = err.message; error.hidden = false; } });
  }
  window.LessonExport = { open };
})();
