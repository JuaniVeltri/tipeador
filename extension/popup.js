/* global startTyping */ // from typer.js
// Paste the text and it starts typing in the page on its own.
// Ctrl/⌘ + Enter does the same for text written by hand.
const text = document.getElementById('text');
const speed = document.getElementById('speed');
const msg = document.getElementById('msg');

const REASONS = {
  'no-field': 'Primero hacé click en el campo de la página donde querés escribir y después abrí la extensión.',
  frame: 'Ese campo está dentro de un recuadro de otro sitio y Chrome no me deja escribir ahí.',
};
const BLOCKED = 'No puedo escribir en esta página: Chrome no deja que las extensiones toquen sus páginas internas ni la Chrome Web Store.';

chrome.storage.local.get({ delay: '240' }).then((saved) => {
  if ([...speed.options].some((o) => o.value === saved.delay)) speed.value = saved.delay;
});
speed.addEventListener('change', () => chrome.storage.local.set({ delay: speed.value }));

async function typeIt() {
  msg.textContent = '';
  if (!text.value) return;
  let result;
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    const [injection] = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: startTyping,
      args: [text.value, { delay: Number(speed.value), human: true }],
    });
    result = injection && injection.result;
  } catch (err) {
    msg.textContent = BLOCKED;
    return;
  }
  if (result && result.ok) {
    window.close(); // hands focus back to the page, where the typing starts
  } else {
    msg.textContent = REASONS[result && result.reason] || REASONS['no-field'];
  }
}

// Wait a tick so the pasted text is already in the box.
text.addEventListener('paste', () => setTimeout(typeIt, 0));
text.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
    e.preventDefault();
    typeIt();
  }
});
