// Colour themes. Each one is a block of CSS variables in styles.css keyed by [data-theme].

import { cssVar, h } from './dom.ts';

const THEMES = {
  pitwall: 'Pit Wall',
  midnight: 'Midnight',
  paddock: 'Paddock (light)',
  papaya: 'Papaya',
  green: 'Racing Green',
  contrast: 'High Contrast',
} as const;

type Theme = keyof typeof THEMES;

const KEY = 'theme';

function current(): Theme {
  const saved = localStorage.getItem(KEY);
  return saved && saved in THEMES ? (saved as Theme) : 'pitwall';
}

export function applyTheme(theme: Theme = current()): void {
  document.documentElement.dataset.theme = theme;
  // Browser chrome (status bar, address bar) follows the page colour.
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', cssVar('--page'));
  document.querySelector('meta[name="color-scheme"]')?.setAttribute('content', cssVar('color-scheme'));
}

/** Canvases cache their colours, so a change fires `themechange` and the page remounts. */
export function themePicker(): HTMLSelectElement {
  const select = h(
    'select',
    { class: 'theme-picker', attrs: { title: 'Theme', 'aria-label': 'Theme' } },
    ...Object.entries(THEMES).map(([id, name]) => h('option', { text: name, attrs: { value: id } })),
  );
  select.value = current();
  select.addEventListener('change', () => {
    localStorage.setItem(KEY, select.value);
    applyTheme(select.value as Theme);
    window.dispatchEvent(new Event('themechange'));
  });
  return select;
}
