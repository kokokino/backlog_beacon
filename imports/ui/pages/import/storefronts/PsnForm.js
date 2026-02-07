import m from 'mithril';
import { Meteor } from 'meteor/meteor';
import { clearProgressAfterDelay } from '../../../components/import/importHelpers.js';
import { ImportOptionsFieldset } from '../../../components/import/ImportOptionsFieldset.js';
import { AuthStatus } from '../../../components/import/AuthStatus.js';
import { SecurityNotice } from '../../../components/import/SecurityNotice.js';

export const PsnForm = {
  oninit() {
    this.npssoToken = null;
  },

  clearAuth(storefront) {
    this.npssoToken = null;
    storefront.result = null;
    storefront.error = null;
    m.redraw();
  },

  async importLibrary(storefront) {
    if (!this.npssoToken) {
      storefront.error = 'Please enter your NPSSO token.';
      m.redraw();
      return;
    }

    storefront.importing = true;
    storefront.error = null;
    storefront.result = null;
    m.redraw();

    try {
      storefront.result = await Meteor.callAsync('import.psn', this.npssoToken, {
        updateExisting: storefront.options.updateExisting,
        importPlaytime: storefront.options.importPlaytime
      });
      this.npssoToken = null;
      clearProgressAfterDelay('import.clearStorefrontProgress');
    } catch (error) {
      storefront.error = error.reason || error.message || 'Import failed';
    }

    storefront.importing = false;
    m.redraw();
  },

  view(vnode) {
    const { storefront } = vnode.attrs;
    const hasToken = !!this.npssoToken;

    return m('div.psn-form', [
      m('div.psn-instructions', { style: 'margin-bottom: 1rem;' }, [
        m('h4', 'How to get your NPSSO token:'),
        m('ol', { style: 'margin: 0.5rem 0; padding-left: 1.5rem;' }, [
          m('li', [
            'Log in to your PlayStation account at ',
            m('a', {
              href: 'https://store.playstation.com',
              target: '_blank',
              rel: 'noopener noreferrer'
            }, 'store.playstation.com')
          ]),
          m('li', [
            'Then open ',
            m('a', {
              href: 'https://ca.account.sony.com/api/v1/ssocookie',
              target: '_blank',
              rel: 'noopener noreferrer'
            }, 'this link'),
            ' — it will show JSON with an ',
            m('code', 'npsso'),
            ' field. Copy that value (a 64-character string)'
          ])
        ]),
        m('small', { style: 'color: var(--muted-color);' },
          'If the link shows an error, make sure you are logged in at store.playstation.com first.'
        )
      ]),

      m('div.limitation-notice', { style: 'margin-bottom: 1rem; padding: 0.75rem; background: var(--card-sectionning-background-color); border-radius: var(--border-radius);' }, [
        m('strong', 'Note: '),
        'PS3 and PS Vita games are included if you have earned at least one trophy. PS4 and PS5 games are included even if never played.'
      ]),

      m('div.form-group', [
        m('label', { for: 'psn-token' }, 'NPSSO Token'),
        m('input', {
          type: 'text',
          id: 'psn-token',
          placeholder: 'Paste your npsso token here...',
          value: this.npssoToken || '',
          disabled: storefront.importing,
          oninput: (event) => { this.npssoToken = event.target.value.trim() || null; }
        }),
        m('small', 'The token is a 64-character string from the JSON response.')
      ]),

      hasToken && m(AuthStatus, {
        label: 'NPSSO token provided',
        onClear: () => this.clearAuth(storefront)
      }),

      m(SecurityNotice, { credentialName: 'NPSSO token' }),

      m(ImportOptionsFieldset, {
        options: storefront.options,
        disabled: storefront.importing,
        showPlaytime: true
      }),

      !storefront.result && m('button', {
        disabled: !hasToken || storefront.importing,
        onclick: () => this.importLibrary(storefront)
      }, storefront.importing ? 'Importing...' : 'Import from PlayStation')
    ]);
  }
};
