import m from 'mithril';

export const AuthStatus = {
  view(vnode) {
    const { label, onClear } = vnode.attrs;

    return m('div.auth-status', { style: 'margin-bottom: 1rem;' }, [
      m('span', { style: 'color: var(--ins-color);' }, label),
      ' ',
      m('button.outline.secondary', {
        style: 'padding: 0.25rem 0.5rem; font-size: 0.85em;',
        onclick: onClear
      }, 'Clear')
    ]);
  }
};
