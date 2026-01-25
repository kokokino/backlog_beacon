import m from 'mithril';

export const VIEW_MODES = {
  PAGES: 'pages',
  INFINITE: 'infinite'
  // Future: BOOKSHELF, BEANSTALK
};

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
        }, 'Infinite')
      ])
    ]);
  }
};
