// Iliad reading assist: select verse lines, press "שאל את Claude", read the answer beside the text.
(() => {
  'use strict';

  // ---- Configuration -------------------------------------------------------
  // The prompt sent to Claude. The selected text and its line range are appended after it.
  const PROMPT = ``;

  const MODEL = 'claude-opus-5-5';
  const SDK_URL = 'https://cdn.jsdelivr.net/npm/@anthropic-ai/sdk@0.128.0/+esm';
  const MARKED_URL = 'https://cdn.jsdelivr.net/npm/marked@12.0.2/lib/marked.esm.js';
  const PURIFY_URL = 'https://cdn.jsdelivr.net/npm/dompurify@3.1.6/dist/purify.es.mjs';
  const KEY_STORAGE = 'iliad-assist.anthropic-key';
  // Below this viewport width there is no room for a side panel, so the answer opens as a popup.
  const SIDE_PANEL_MIN_WIDTH = 1150;

  // ---- API key -------------------------------------------------------------
  function readKey() {
    try { return localStorage.getItem(KEY_STORAGE) || ''; } catch { return ''; }
  }
  function askForKey() {
    const key = (window.prompt('מפתח Anthropic API (נשמר בדפדפן זה בלבד):', readKey()) || '').trim();
    if (key) { try { localStorage.setItem(KEY_STORAGE, key); } catch {} }
    return key;
  }

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
      <button type="button" class="assist-close" aria-label="סגור">×</button>
    </div>
    <blockquote class="assist-quote"></blockquote>
    <div class="assist-body"></div>`;
  document.body.appendChild(panel);

  const backdrop = document.createElement('div');
  backdrop.className = 'assist-backdrop';
  backdrop.hidden = true;
  document.body.appendChild(backdrop);

  const keyBtn = document.createElement('button');
  keyBtn.type = 'button';
  keyBtn.className = 'assist-key';
  keyBtn.title = 'הגדרת מפתח API';
  keyBtn.textContent = '⚙';
  document.body.appendChild(keyBtn);
  keyBtn.addEventListener('click', askForKey);

  const refEl = panel.querySelector('.assist-ref');
  const quoteEl = panel.querySelector('.assist-quote');
  const bodyEl = panel.querySelector('.assist-body');

  function layout() {
    const side = window.innerWidth >= SIDE_PANEL_MIN_WIDTH;
    document.body.classList.toggle('assist-side', side && !panel.hidden);
    panel.classList.toggle('as-popup', !side);
    backdrop.hidden = side || panel.hidden;
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
  document.addEventListener('keydown', e => { if (e.key === 'Escape' && !panel.hidden) closePanel(); });

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

  // ---- Claude call ---------------------------------------------------------
  let activeStream = null;

  async function ask({ text, ref }) {
    if (activeStream) { activeStream.abort(); activeStream = null; }

    refEl.textContent = ref;
    quoteEl.textContent = text;
    panel.hidden = false;
    layout();
    panel.scrollTop = 0;

    const apiKey = readKey() || askForKey();
    if (!apiKey) { showStatus('נדרש מפתח Anthropic API (כפתור ⚙).', true); return; }

    showStatus('חושב…');
    const message = [PROMPT.trim(), text, ref].filter(Boolean).join('\n\n');

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
        try { localStorage.removeItem(KEY_STORAGE); } catch {}
        showStatus('מפתח ה-API נדחה. הגדר מפתח חדש (כפתור ⚙).', true);
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
