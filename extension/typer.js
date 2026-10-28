// Runs inside the web page through chrome.scripting.executeScript, so it has
// to be self-contained: nothing outside this function exists over there.
//
// It types `text` into the field that has focus, one character at a time,
// with key events and the browser's own text insertion, so the page sees it
// like normal typing. Returns at once ({ ok, reason }) and keeps typing in
// the background. Esc stops it; if the field loses focus it waits.
function startTyping(text, opts) {
  const KEY = '__tipeador';
  const TEXT_INPUTS = ['text', 'search', 'email', 'url', 'tel', 'password', 'number'];

  opts = opts || {};
  const delay = Math.max(0, Number(opts.delay) || 0);
  const human = !!opts.human;

  if (window[KEY]) window[KEY].stop();

  // The focused element, looking inside shadow roots and same-origin frames
  // (rich editors like TinyMCE live in an iframe).
  function deepActive() {
    let el = document.activeElement;
    while (el) {
      if (el.shadowRoot && el.shadowRoot.activeElement) {
        el = el.shadowRoot.activeElement;
      } else if (el.tagName === 'IFRAME' || el.tagName === 'FRAME') {
        let inner = null;
        try {
          inner = el.contentDocument && el.contentDocument.activeElement;
        } catch (e) {
          // cross-origin frame: we can't look inside
        }
        if (!inner) return el;
        el = inner;
      } else {
        return el;
      }
    }
    return el;
  }

  function isEditable(el) {
    if (!el) return false;
    if (el.isContentEditable) return true;
    if (el.disabled || el.readOnly) return false;
    if (el.tagName === 'TEXTAREA') return true;
    return el.tagName === 'INPUT' && TEXT_INPUTS.includes((el.type || 'text').toLowerCase());
  }

  const el = deepActive();
  if (!isEditable(el)) {
    const inFrame = !!el && (el.tagName === 'IFRAME' || el.tagName === 'FRAME');
    return { ok: false, reason: inFrame ? 'frame' : 'no-field' };
  }

  const doc = el.ownerDocument;
  const win = doc.defaultView;
  const isTextControl = el.tagName === 'INPUT' || el.tagName === 'TEXTAREA';
  const singleLine = el.tagName === 'INPUT';
  const chars = Array.from(String(text).replace(/\r\n?/g, '\n'));
  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  let stopped = false;

  const run = { stop: () => { stopped = true; } };
  window[KEY] = run;

  // ---- progress label, in a shadow root so the page's CSS can't touch it ----
  const host = document.createElement('div');
  host.style.cssText = 'all:initial;position:fixed;right:16px;bottom:16px;z-index:2147483647;pointer-events:none;';
  const label = document.createElement('div');
  label.style.cssText = 'font:13px/1.4 system-ui,-apple-system,sans-serif;background:#1f2328;color:#fff;' +
    'padding:8px 12px;border-radius:8px;box-shadow:0 4px 16px rgba(0,0,0,.3);';
  host.attachShadow({ mode: 'closed' }).appendChild(label);
  const show = (msg) => { label.textContent = msg; };
  document.documentElement.appendChild(host);

  function onKey(e) {
    if (e.key === 'Escape' && e.isTrusted) {
      e.preventDefault();
      e.stopImmediatePropagation();
      run.stop();
    }
  }
  const windows = [...new Set([window, win])];
  windows.forEach((w) => w.addEventListener('keydown', onKey, true));

  // ---- typing ----
  function codeFor(k) {
    if (k.length === 1 && /[a-z]/i.test(k)) return 'Key' + k.toUpperCase();
    if (/^[0-9]$/.test(k)) return 'Digit' + k;
    if (k === ' ') return 'Space';
    return k.length > 1 ? k : '';
  }

  function key(type, k, extra) {
    // Legacy numbers some old sites still read: keydown/keyup carry the key
    // (uppercase letter), keypress carries the character.
    let code = 0;
    if (k === 'Enter') code = 13;
    else if (k.length <= 2) code = (type === 'keypress' ? k : k.toUpperCase()).codePointAt(0);
    const ev = new KeyboardEvent(type, Object.assign({
      key: k, code: codeFor(k), keyCode: code, which: code, charCode: type === 'keypress' ? code : 0,
      bubbles: true, cancelable: true, composed: true,
    }, extra));
    return el.dispatchEvent(ev);
  }

  function fallbackInsert(ch) {
    if (isTextControl) {
      const proto = el.tagName === 'INPUT' ? HTMLInputElement.prototype : HTMLTextAreaElement.prototype;
      const setValue = Object.getOwnPropertyDescriptor(proto, 'value').set;
      let start = null;
      let end = null;
      try { start = el.selectionStart; end = el.selectionEnd; } catch (e) { /* email/number inputs */ }
      const value = el.value;
      if (start == null) start = end = value.length;
      setValue.call(el, value.slice(0, start) + ch + value.slice(end));
      try { el.setSelectionRange(start + ch.length, start + ch.length); } catch (e) { /* idem */ }
    } else {
      const sel = win.getSelection();
      if (!sel || !sel.rangeCount) return;
      const range = sel.getRangeAt(0);
      range.deleteContents();
      const node = ch === '\n' ? doc.createElement('br') : doc.createTextNode(ch);
      range.insertNode(node);
      range.setStartAfter(node);
      range.collapse(true);
      sel.removeAllRanges();
      sel.addRange(range);
    }
    el.dispatchEvent(new InputEvent('input', {
      bubbles: true, composed: true,
      inputType: ch === '\n' ? 'insertLineBreak' : 'insertText', data: ch === '\n' ? null : ch,
    }));
  }

  function typeChar(ch) {
    if (ch === '\n' && singleLine) ch = ' ';
    const newline = ch === '\n';
    const k = newline ? 'Enter' : ch;
    // Shift+Enter: a new line in chat boxes, where plain Enter sends.
    const mods = newline ? { shiftKey: true } : {};
    // If the page cancels the key, a real keyboard wouldn't type it either.
    if (!key('keydown', k, mods)) {
      key('keyup', k, mods);
      return;
    }
    if (!newline && !key('keypress', k, mods)) {
      key('keyup', k, mods);
      return;
    }
    let done = false;
    try {
      done = newline && !isTextControl
        ? doc.execCommand('insertLineBreak')
        : doc.execCommand('insertText', false, ch);
    } catch (e) { /* fall back below */ }
    if (!done) fallbackInsert(ch);
    key('keyup', k, mods);
  }

  // Time before the next key: uneven like a person, slower around spaces and
  // punctuation, with a longer "thinking" pause now and then between words.
  function gap(ch) {
    if (!human) return delay;
    let ms = delay * (0.55 + Math.random() * 0.9);
    if (ch === ' ') {
      ms += delay * 0.4 * Math.random();
      if (Math.random() < 0.04) ms += 400 + Math.random() * 1200;
    } else if (/[.,;:!?)\n]/.test(ch)) {
      ms += delay * (1 + Math.random() * 2);
    }
    return ms;
  }

  const focused = () => document.hasFocus() && deepActive() === el;

  async function waitForFocus() {
    if (focused()) return true;
    // Give the extension popup a moment to close and hand focus back.
    for (let i = 0; i < 10 && !stopped && !focused(); i++) await sleep(50);
    if (!focused()) show('En pausa: hacé click en el campo para seguir · Esc para cancelar');
    while (!stopped && el.isConnected && !focused()) await sleep(150);
    return !stopped && el.isConnected;
  }

  async function loop() {
    let typed = 0;
    show('Tipeando… · Esc para frenar');
    for (const ch of chars) {
      if (stopped || !(await waitForFocus())) break;
      typeChar(ch);
      typed++;
      show(`Tipeando ${typed}/${chars.length} · Esc para frenar`);
      await sleep(gap(ch));
    }
    return typed;
  }

  loop()
    .then((typed) => show(typed === chars.length ? 'Listo' : `Frenado en ${typed}/${chars.length}`))
    .catch(() => show('Se cortó por un error de la página'))
    .finally(() => {
      windows.forEach((w) => w.removeEventListener('keydown', onKey, true));
      if (window[KEY] === run) delete window[KEY];
      setTimeout(() => host.remove(), 1500);
    });

  return { ok: true, total: chars.length };
}
