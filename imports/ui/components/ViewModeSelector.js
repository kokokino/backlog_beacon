import m from 'mithril';

export const VIEW_MODES = {
  PAGES: 'pages',
  INFINITE: 'infinite',
  BOOKSHELF: 'bookshelf',
  BEANSTALK: 'beanstalk'
};

const STORAGE_KEY = 'collectionViewMode';

export function loadViewMode() {
  const stored = localStorage.getItem(STORAGE_KEY);
  if (stored && Object.values(VIEW_MODES).includes(stored)) {
    return stored;
  }
  return VIEW_MODES.PAGES;
}

export function saveViewMode(mode) {
  localStorage.setItem(STORAGE_KEY, mode);
}

export const ViewModeSelector = {
  view(vnode) {
    const { currentMode, onModeChange } = vnode.attrs;

    return m('div.view-mode-selector', [
      m('span.view-mode-label', 'View:'),
      m('div.view-mode-buttons', [
        m('button', {
          type: 'button',
          class: currentMode === VIEW_MODES.PAGES ? 'selected' : 'outline',
          onclick: () => onModeChange(VIEW_MODES.PAGES)
        }, 'Pages'),
        m('button', {
          type: 'button',
          class: currentMode === VIEW_MODES.INFINITE ? 'selected' : 'outline',
          onclick: () => onModeChange(VIEW_MODES.INFINITE)
        }, 'Infinite'),
        m('button', {
          type: 'button',
          class: currentMode === VIEW_MODES.BOOKSHELF ? 'selected' : 'outline',
          title: 'Display games on wooden shelves',
          onclick: () => onModeChange(VIEW_MODES.BOOKSHELF)
        }, 'Bookshelf'),
        m('button', {
          type: 'button',
          class: currentMode === VIEW_MODES.BEANSTALK ? 'selected' : 'outline',
          title: 'Explore your collection in 3D!',
          onclick: () => onModeChange(VIEW_MODES.BEANSTALK)
        }, 'Beanstalk')
      ])
    ]);
  }
};
