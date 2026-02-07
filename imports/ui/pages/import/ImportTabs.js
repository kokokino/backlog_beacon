import m from 'mithril';

const TAB_LABELS = {
  darkadia: 'Darkadia CSV',
  backlog_beacon: 'Backlog Beacon CSV',
  simple: 'Simple Import',
  storefront: 'Storefront',
  export: 'Export'
};

export const TABS = {
  DARKADIA: 'darkadia',
  BACKLOG_BEACON: 'backlog_beacon',
  SIMPLE: 'simple',
  STOREFRONT: 'storefront',
  EXPORT: 'export'
};

export const ImportTabs = {
  view(vnode) {
    const { activeTab, onTabChange } = vnode.attrs;

    return m('nav.import-tabs', [
      m('ul', [
        Object.entries(TABS).map(([, value]) =>
          m('li', { key: value }, [
            m('a', {
              href: '#',
              class: activeTab === value ? 'active' : '',
              onclick: (event) => {
                event.preventDefault();
                onTabChange(value);
              }
            }, TAB_LABELS[value])
          ])
        )
      ])
    ]);
  }
};
