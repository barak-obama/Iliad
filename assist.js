// Iliad reading assist: select verse lines, press "שאל את Claude", read the answer beside the text.
(() => {
  'use strict';

  // ---- Configuration -------------------------------------------------------
  // Default prompt sent to Claude, used until one is saved in the settings dialog (⚙ button).
  // The selected text and its line range are appended after it.
  const DEFAULT_PROMPT = ``;

  const MODEL = 'claude-opus-5-5';
  const SDK_URL = 'https://cdn.jsdelivr.net/npm/@anthropic-ai/sdk@0.128.0/+esm';
  const MARKED_URL = 'https://cdn.jsdelivr.net/npm/marked@12.0.2/lib/marked.esm.js';
  const PURIFY_URL = 'https://cdn.jsdelivr.net/npm/dompurify@3.1.6/dist/purify.es.mjs';
  const KEY_STORAGE = 'iliad-assist.anthropic-key';
  const PROMPT_STORAGE = 'iliad-assist.prompt';
  // Below this viewport width there is no room for a side panel, so the answer opens as a popup.
  const SIDE_PANEL_MIN_WIDTH = 1150;

  // ---- Stored settings (API key, prompt) -----------------------------------
  function load(name) {
    try { return localStorage.getItem(name); } catch { return null; }
  }
  function store(name, value) {
    try { localStorage.setItem(name, value); return true; } catch { return false; }
  }
  const readKey = () => (load(KEY_STORAGE) || '').trim();
  const readPrompt = () => load(PROMPT_STORAGE) ?? DEFAULT_PROMPT;

  // ---- Selection -> text + line range -------------------------------------
  function lineOf(node) {
    const el = node.nodeType === Node.ELEMENT_NODE ? node : node.parentElement;
    return el ? el.closest('p.line') : null;
  }

  // Lines that actually contain selected characters (a triple-click selection ends at offset 0
  // of the next line; that line must not be counted).
  function selectedLines(range) {
    const root = range.commonAncestorContainer;
    const scope = root.nodeType === Node.ELEMENT_NODE ? root : root.parentElement;
    const single = lineOf(root);
    const candidates = single ? [single] : Array.from(scope.querySelectorAll('p.line'));
    return candidates.filter(p => {
      if (!range.intersectsNode(p)) return false;
      const part = document.createRange();
      part.selectNodeContents(p);
      if (range.compareBoundaryPoints(Range.START_TO_START, part) > 0) part.setStart(range.startContainer, range.startOffset);
      if (range.compareBoundaryPoints(Range.END_TO_END, part) < 0) part.setEnd(range.endContainer, range.endOffset);
      return part.toString().trim() !== '';
    });
  }

  function describeSelection() {
    const sel = window.getSelection();
    if (!sel || sel.isCollapsed || sel.rangeCount === 0) return null;
    const range = sel.getRangeAt(0);
    const lines = selectedLines(range);
    if (lines.length === 0) return null;
    const text = sel.toString().replace(/\s*\n\s*/g, '\n').trim();
    if (!text) return null;
    const first = lines[0], last = lines[lines.length - 1];
    const book = first.closest('section.book')?.dataset.book;
    if (!book) return null;
    const ref = `${book}: lines ${first.dataset.line} - ${last.dataset.line}`;
    return { text, ref, range };
  }

  // ---- UI ------------------------------------------------------------------
  const askBtn = document.createElement('button');
  askBtn.type = 'button';
  askBtn.className = 'assist-ask';
  askBtn.textContent = 'שאל את Claude';
  askBtn.hidden = true;
  document.body.appendChild(askBtn);

  const panel = document.createElement('aside');
  panel.className = 'assist-panel';
  panel.hidden = true;
  panel.setAttribute('role', 'dialog');
  panel.setAttribute('aria-label', 'תשובת Claude');
  panel.innerHTML = `
    <div class="assist-head">
      <span class="assist-ref"></span>
      <span class="assist-head-buttons">
        <button type="button" class="assist-gear" title="הגדרות Claude" aria-label="הגדרות Claude">⚙</button>
        <button type="button" class="assist-close" aria-label="סגור">×</button>
      </span>
    </div>
    <blockquote class="assist-quote"></blockquote>
    <div class="assist-body"></div>`;
  document.body.appendChild(panel);

  const backdrop = document.createElement('div');
  backdrop.className = 'assist-backdrop';
  backdrop.hidden = true;
  document.body.appendChild(backdrop);

  // Settings dialog, opened from the ⚙ button. Values are saved in this browser.
  const settings = document.createElement('dialog');
  settings.className = 'assist-settings';
  settings.innerHTML = `
    <form method="dialog">
      <h2>הגדרות Claude</h2>
      <label for="assist-prompt">הנחיה (הטקסט המסומן וטווח השורות יצורפו אחריה)</label>
      <textarea id="assist-prompt" rows="8" dir="auto"></textarea>
      <label for="assist-key">מפתח Anthropic API</label>
      <div class="assist-key-row">
        <input id="assist-key" type="password" dir="ltr" autocomplete="off" spellcheck="false" placeholder="sk-ant-...">
        <button type="button" class="assist-key-toggle">הצג</button>
      </div>
      <p class="assist-error assist-save-error" hidden>השמירה נכשלה (האחסון בדפדפן חסום).</p>
      <div class="assist-actions">
        <button type="submit" value="save" class="assist-save">שמור</button>
        <button type="submit" value="cancel">ביטול</button>
      </div>
    </form>`;
  document.body.appendChild(settings);

  const promptInput = settings.querySelector('#assist-prompt');
  const keyInput = settings.querySelector('#assist-key');
  const keyToggle = settings.querySelector('.assist-key-toggle');
  const saveError = settings.querySelector('.assist-save-error');

  function setKeyVisible(show) {
    keyInput.type = show ? 'text' : 'password';
    keyToggle.textContent = show ? 'הסתר' : 'הצג';
  }
  keyToggle.addEventListener('click', () => setKeyVisible(keyInput.type === 'password'));

  function openSettings(focus = promptInput) {
    promptInput.value = readPrompt();
    keyInput.value = readKey();
    setKeyVisible(false);
    saveError.hidden = true;
    settings.showModal();
    focus.focus();
  }
  settings.querySelector('form').addEventListener('submit', e => {
    if (e.submitter?.value !== 'save') return;
    const ok = store(PROMPT_STORAGE, promptInput.value) && store(KEY_STORAGE, keyInput.value.trim());
    if (!ok) { e.preventDefault(); saveError.hidden = false; }
  });

  const keyBtn = document.createElement('button');
  keyBtn.type = 'button';
  keyBtn.className = 'assist-key';
  keyBtn.title = 'הגדרות Claude';
  keyBtn.setAttribute('aria-label', 'הגדרות Claude');
  keyBtn.textContent = '⚙';
  document.body.appendChild(keyBtn);
  keyBtn.addEventListener('click', () => openSettings());
  panel.querySelector('.assist-gear').addEventListener('click', () => openSettings());

  const refEl = panel.querySelector('.assist-ref');
  const quoteEl = panel.querySelector('.assist-quote');
  const bodyEl = panel.querySelector('.assist-body');

  function layout() {
    const side = window.innerWidth >= SIDE_PANEL_MIN_WIDTH;
    document.body.classList.toggle('assist-side', side && !panel.hidden);
    panel.classList.toggle('as-popup', !side);
    backdrop.hidden = side || panel.hidden;
    // The panel covers the corner button, so it uses the ⚙ in its own header instead.
    keyBtn.hidden = !panel.hidden;
  }
  window.addEventListener('resize', layout);

  let current = null; // selection captured when the button was shown
  let selTimer = 0;

  function placeButton() {
    current = describeSelection();
    if (!current) { askBtn.hidden = true; return; }
    const rects = current.range.getClientRects();
    const r = rects.length ? rects[rects.length - 1] : current.range.getBoundingClientRect();
    askBtn.hidden = false;
    const bw = askBtn.offsetWidth, bh = askBtn.offsetHeight;
    let top = r.bottom + window.scrollY + 6;
    if (r.bottom + bh + 12 > window.innerHeight) top = r.top + window.scrollY - bh - 6;
    let left = r.left + window.scrollX + r.width / 2 - bw / 2;
    left = Math.max(window.scrollX + 8, Math.min(left, window.scrollX + document.documentElement.clientWidth - bw - 8));
    askBtn.style.top = `${top}px`;
    askBtn.style.left = `${left}px`;
  }

  document.addEventListener('selectionchange', () => {
    clearTimeout(selTimer);
    selTimer = setTimeout(placeButton, 200);
  });
  // Keep the selection alive when the button is pressed.
  askBtn.addEventListener('mousedown', e => e.preventDefault());
  askBtn.addEventListener('click', () => {
    const sel = current || describeSelection();
    askBtn.hidden = true;
    if (sel) ask(sel);
  });

  function closePanel() {
    if (activeStream) { activeStream.abort(); activeStream = null; }
    panel.hidden = true;
    layout();
  }
  panel.querySelector('.assist-close').addEventListener('click', closePanel);
  backdrop.addEventListener('click', closePanel);
  document.addEventListener('keydown', e => { if (e.key === 'Escape' && !panel.hidden && !settings.open) closePanel(); });

  // ---- Rendering -----------------------------------------------------------
  let libs = null;
  function loadLibs() {
    libs ||= Promise.all([import(SDK_URL), import(MARKED_URL), import(PURIFY_URL)]).then(([sdk, marked, purify]) => ({
      Anthropic: sdk.default,
      marked: marked.marked,
      DOMPurify: purify.default,
    }));
    return libs;
  }

  function render(markdown, { marked, DOMPurify }) {
    bodyEl.innerHTML = DOMPurify.sanitize(marked.parse(markdown));
  }
  function showStatus(text, isError = false) {
    bodyEl.innerHTML = '';
    const p = document.createElement('p');
    p.className = isError ? 'assist-error' : 'assist-status';
    p.textContent = text;
    bodyEl.appendChild(p);
  }

  function showKeyMissing(text) {
    showStatus(`${text} `, true);
    const link = document.createElement('button');
    link.type = 'button';
    link.className = 'assist-link';
    link.textContent = 'פתח הגדרות';
    link.addEventListener('click', () => openSettings(keyInput));
    bodyEl.firstChild.appendChild(link);
  }

  // ---- Claude call ---------------------------------------------------------
  let activeStream = null;

  async function ask({ text, ref }) {
    if (activeStream) { activeStream.abort(); activeStream = null; }

    refEl.textContent = ref;
    quoteEl.textContent = text;
    panel.hidden = false;
    layout();
    panel.scrollTop = 0;

    const apiKey = readKey();
    if (!apiKey) { showKeyMissing('נדרש מפתח Anthropic API.'); return; }

    showStatus('חושב…');
    const message = [readPrompt().trim(), text, ref].filter(Boolean).join('\n\n');

    let lib;
    try {
      lib = await loadLibs();
    } catch (err) {
      libs = null;
      showStatus(`טעינת הספריות נכשלה: ${err.message}`, true);
      return;
    }

    const client = new lib.Anthropic({ apiKey, dangerouslyAllowBrowser: true });
    const stream = client.beta.messages.stream({
      model: MODEL,
      max_tokens: 16000,
      output_config: { effort: 'medium' },
      betas: ['server-side-fallback-2026-07-01'],
      fallbacks: 'default',
      messages: [{ role: 'user', content: message }],
    });
    activeStream = stream;

    let answer = '';
    stream.on('text', delta => {
      if (activeStream !== stream) return;
      answer += delta;
      render(answer, lib);
    });

    try {
      const final = await stream.finalMessage();
      if (activeStream !== stream) return;
      if (final.stop_reason === 'refusal') {
        showStatus('Claude סירב לענות על בקשה זו.', true);
      } else if (!answer) {
        showStatus('לא התקבלה תשובה.', true);
      } else if (final.stop_reason === 'max_tokens') {
        render(answer + '\n\n*(התשובה נקטעה)*', lib);
      }
    } catch (err) {
      if (activeStream !== stream || stream.aborted) return;
      if (err instanceof lib.Anthropic.AuthenticationError) {
        showKeyMissing('מפתח ה-API נדחה.');
      } else if (err instanceof lib.Anthropic.RateLimitError) {
        showStatus('חריגה ממגבלת הקצב. נסה שוב בעוד רגע.', true);
      } else if (err instanceof lib.Anthropic.APIError) {
        showStatus(`שגיאת API${err.status ? ` (${err.status})` : ''}: ${err.message}`, true);
      } else {
        showStatus(`שגיאה: ${err.message}`, true);
      }
    } finally {
      if (activeStream === stream) activeStream = null;
    }
  }
})();
