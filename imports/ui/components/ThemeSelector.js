import m from 'mithril';

export const THEMES = {
  AUTO: 'auto',
  LIGHT: 'light',
  DARK: 'dark'
};

const STORAGE_KEY = 'theme';

export function loadTheme() {
  const stored = localStorage.getItem(STORAGE_KEY);
  if (stored && Object.values(THEMES).includes(stored)) {
    return stored;
  }
  return THEMES.AUTO;
}

export function saveTheme(theme) {
  localStorage.setItem(STORAGE_KEY, theme);
}

export function applyTheme(theme) {
  if (theme === THEMES.AUTO) {
    document.documentElement.removeAttribute('data-theme');
  } else {
    document.documentElement.setAttribute('data-theme', theme);
  }
}

export function initializeTheme() {
  const theme = loadTheme();
  applyTheme(theme);
}

export const ThemeSelector = {
  oninit() {
    this.currentTheme = loadTheme();
  },

  setTheme(theme) {
    this.currentTheme = theme;
    saveTheme(theme);
    applyTheme(theme);
  },

  view() {
    return m('select.theme-selector', {
      value: this.currentTheme,
      title: 'Color theme',
      onchange: (e) => this.setTheme(e.target.value)
    }, [
      m('option', { value: THEMES.AUTO }, 'Auto'),
      m('option', { value: THEMES.LIGHT }, 'Light'),
      m('option', { value: THEMES.DARK }, 'Dark')
    ]);
  }
};
