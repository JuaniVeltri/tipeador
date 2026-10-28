# Tipeador

Extensión de Chrome que escribe un texto letra por letra en el campo donde estás parado, con el ritmo de una persona.

## Cómo se usa

1. Hacé click en el campo donde querés escribir.
2. Abrí la extensión (con el ícono o con Alt+Shift+T).
3. Pegá el texto. El popup se cierra y empieza a escribir.

Esc frena. Si hacés click fuera del campo, se pone en pausa hasta que vuelvas. Si escribís el texto a mano en el popup en vez de pegarlo, arrancá con ⌘/Ctrl + Enter.

## Cómo instalarla

1. Bajá el repo (`git clone` o "Download ZIP").
2. Entrá a `chrome://extensions` y prendé el "Modo de desarrollador".
3. Tocá "Cargar descomprimida" y elegí la carpeta `extension`.

## Cómo funciona

Por cada letra manda los eventos de teclado y usa la inserción de texto del propio navegador, así que la mayoría de las páginas lo toman como tipeo normal. Anda en inputs, textareas, editores de texto enriquecido (también dentro de iframes del mismo sitio) y sitios hechos con React. En los chats, los saltos de línea van como Shift+Enter para no mandar el mensaje antes de tiempo.

Solo pide acceso a la pestaña donde la abrís (`activeTab`). No guarda el texto ni lo manda a ningún lado; lo único que recuerda es la velocidad.

## Límites

- No anda en las páginas internas de Chrome (`chrome://`) ni en la Chrome Web Store.
- No puede escribir en campos que están dentro de un recuadro de otro sitio (un iframe de otro dominio).
- En un campo de una sola línea, los saltos de línea se escriben como espacios.

## Tests

```sh
npm install
npx playwright-core install chromium   # si no tenés el Chromium de Playwright
npm test
```

Los tests prueban el tipeo en distintos tipos de campos y cargan la extensión en Chromium para probar el popup.

## Licencia

MIT
