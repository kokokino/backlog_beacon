import m from 'mithril';

export const ImportOptionsFieldset = {
  view(vnode) {
    const {
      options,
      disabled = false,
      showPlaytime = false,
      showLastPlayed = false,
      updateExistingLabel = ' Update existing games (merge platforms and storefronts)'
    } = vnode.attrs;

    return m('fieldset', [
      m('legend', 'Import Options'),
      m('label', [
        m('input', {
          type: 'checkbox',
          checked: options.updateExisting,
          disabled,
          onchange: (event) => {
            options.updateExisting = event.target.checked;
          }
        }),
        updateExistingLabel
      ]),
      showPlaytime && m('label', [
        m('input', {
          type: 'checkbox',
          checked: options.importPlaytime,
          disabled,
          onchange: (event) => {
            options.importPlaytime = event.target.checked;
          }
        }),
        ' Import playtime hours'
      ]),
      showLastPlayed && m('label', [
        m('input', {
          type: 'checkbox',
          checked: options.importLastPlayed,
          disabled,
          onchange: (event) => {
            options.importLastPlayed = event.target.checked;
          }
        }),
        ' Import last played date'
      ])
    ]);
  }
};
