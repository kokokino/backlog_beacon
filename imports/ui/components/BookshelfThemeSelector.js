import m from 'mithril';

export const BOOKSHELF_THEMES = {
  BROWN: 'brown',
  GRAY: 'gray'
};

const STORAGE_KEY = 'bookshelfTheme';

export function loadBookshelfTheme() {
  const stored = localStorage.getItem(STORAGE_KEY);
  if (stored === BOOKSHELF_THEMES.GRAY) {
    return BOOKSHELF_THEMES.GRAY;
  }
  return BOOKSHELF_THEMES.BROWN;
}

export function saveBookshelfTheme(theme) {
  localStorage.setItem(STORAGE_KEY, theme);
}

export const BookshelfThemeSelector = {
  view(vnode) {
    const { currentTheme, onThemeChange } = vnode.attrs;

    return m('div.bookshelf-theme-selector', [
      m('span.theme-label', 'Wood:'),
      m('button.theme-btn.theme-brown', {
        type: 'button',
        class: currentTheme === BOOKSHELF_THEMES.BROWN ? 'selected' : '',
        title: 'Brown wood',
        onclick: () => onThemeChange(BOOKSHELF_THEMES.BROWN)
      }),
      m('button.theme-btn.theme-gray', {
        type: 'button',
        class: currentTheme === BOOKSHELF_THEMES.GRAY ? 'selected' : '',
        title: 'Gray wood',
        onclick: () => onThemeChange(BOOKSHELF_THEMES.GRAY)
      })
    ]);
  }
};
