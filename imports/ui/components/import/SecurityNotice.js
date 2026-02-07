import m from 'mithril';

export const SecurityNotice = {
  view(vnode) {
    const { credentialName } = vnode.attrs;

    return m('div.privacy-notice', { style: 'margin-bottom: 1rem;' }, [
      m('strong', 'Security Note: '),
      `Your ${credentialName} is only used once to fetch your game library and is never stored. It will be cleared after import.`
    ]);
  }
};
