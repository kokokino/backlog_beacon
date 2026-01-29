import m from 'mithril';

export const VIEW_MODES = {
  PAGES: 'pages',
  INFINITE: 'infinite',
  BEANSTALK: 'beanstalk'
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
        }, 'Infinite'),
        m('button', {
          type: 'button',
          class: currentMode === VIEW_MODES.BEANSTALK ? 'selected' : 'outline',
          title: 'Explore your collection in 3D!',
          onclick: () => onModeChange(VIEW_MODES.BEANSTALK)
        }, '3D')
      ])
    ]);
  }
};
