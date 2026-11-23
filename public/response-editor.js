const same = (first, second) => first.size === second.size && [...first].every(slot => second.has(slot));

export async function persistResponse(api, path, slots, version) {
  try { return await api(path + '/response', { method: 'PUT', body: JSON.stringify({ slots, version }) }); }
  catch (error) {
    // A lost reply can follow a successful write. Read before retrying or reporting a conflict.
    try {
      const remote = await api(path);
      if (remote.mine && same(new Set(remote.mine.slots), new Set(slots))) return remote.mine;
      if ((remote.mine?.version || 0) !== version) error.conflict = true;
    } catch { /* Keep the original write error when verification is unavailable. */ }
    if (error.status === 409 || /다른 창에서 참여 정보/.test(error.message)) error.conflict = true;
    throw error;
  }
}

export function createResponseEditor({ slots, version, exists = true, save, normalize = values => values, onDraft = () => {}, onState = () => {}, onSaved = () => {} }) {
  const clean = values => new Set(normalize([...values]));
  let draft = clean(slots), confirmed = new Set(draft), history = [], phase = 'idle', error = null;
  let timer = null, running = null, revision = 0, uncertain = false, paused = false, touched = false;
  const state = () => ({ slots: [...draft], version, phase, error, canUndo: history.length > 0, dirty: Boolean(running) || needsSave() });
  const emit = () => onState(state());
  const cancelTimer = () => { if (timer !== null) clearTimeout(timer); timer = null; };
  const needsSave = () => uncertain || (!exists && touched) || !same(draft, confirmed);
  const plan = () => {
    cancelTimer();
    if (paused) { emit(); return; }
    if (!needsSave() && !running) { phase = 'saved'; error = null; emit(); return; }
    phase = running ? 'saving' : 'pending'; error = null; emit();
    timer = setTimeout(() => { timer = null; void flush(); }, 300);
  };
  const replace = values => { draft = clean(values); revision++; onDraft([...draft]); };
  async function flush() {
    cancelTimer();
    if (running) return running;
    if (paused || !needsSave()) return;
    // Defer the writer to make `running` visible to state listeners before the first request.
    running = Promise.resolve().then(async () => {
      phase = 'saving'; error = null; emit();
      while (!paused && needsSave()) {
        const sent = clean(draft), sentRevision = revision;
        try {
          const result = await save([...sent], version);
          confirmed = new Set(result.slots); version = result.version; uncertain = false; exists = true;
          if (revision === sentRevision) { draft = clean(result.slots); onDraft([...draft]); }
          onSaved(result);
        } catch (failure) {
          error = failure; uncertain = true; paused = Boolean(failure.conflict);
          phase = paused ? 'conflict' : 'error'; return;
        }
      }
      phase = 'saved'; error = null;
    }).finally(() => { running = null; cancelTimer(); emit(); });
    return running;
  }
  const editor = {
    get state() { return state(); },
    change(values) {
      touched = true;
      const next = clean(values);
      if (same(draft, next)) { onDraft([...draft]); if (!exists) plan(); return false; }
      history.push([...draft]); if (history.length > 100) history.shift();
      replace(next); plan(); return true;
    },
    undo() {
      while (history.length) {
        const previous = clean(history.pop());
        if (same(previous, draft)) continue;
        replace(previous); plan(); return true;
      }
      emit(); return false;
    },
    revalidate() { const next = clean(draft); if (!same(next, draft)) { replace(next); plan(); } },
    flush,
    retry() { if (!paused) { error = null; return flush(); } },
    reset(values, savedVersion, hasResponse = true) {
      if (running) throw new Error('저장이 끝난 뒤 다시 불러와 주세요.');
      cancelTimer(); version = savedVersion; exists = hasResponse; touched = false; history = []; paused = false; uncertain = false; error = null;
      confirmed = clean(values); draft = new Set(confirmed); revision++; phase = 'saved'; onDraft([...draft]); emit();
    },
  };
  emit(); return editor;
}
