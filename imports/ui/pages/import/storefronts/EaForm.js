import m from 'mithril';
import { Meteor } from 'meteor/meteor';
import { clearProgressAfterDelay } from '../../../components/import/importHelpers.js';
import { ImportOptionsFieldset } from '../../../components/import/ImportOptionsFieldset.js';
import { AuthStatus } from '../../../components/import/AuthStatus.js';
import { SecurityNotice } from '../../../components/import/SecurityNotice.js';

export const EaForm = {
  oninit() {
    this.bearerToken = null;
  },

  clearAuth(storefront) {
    this.bearerToken = null;
    storefront.result = null;
    storefront.error = null;
    m.redraw();
  },

  async importLibrary(storefront) {
    if (!this.bearerToken) {
      storefront.error = 'Please enter your EA bearer token.';
      m.redraw();
      return;
    }

    storefront.importing = true;
    storefront.error = null;
    storefront.result = null;
    m.redraw();

    try {
      storefront.result = await Meteor.callAsync('import.ea', this.bearerToken, {
        updateExisting: storefront.options.updateExisting,
        importPlaytime: storefront.options.importPlaytime
      });
      this.bearerToken = null;
      clearProgressAfterDelay('import.clearStorefrontProgress');
    } catch (error) {
      storefront.error = error.reason || error.message || 'Import failed';
    }

    storefront.importing = false;
    m.redraw();
  },

  view(vnode) {
    const { storefront } = vnode.attrs;
    const hasBearerToken = !!this.bearerToken;

    return m('div.ea-form', [
      m('div.ea-instructions', { style: 'margin-bottom: 1rem;' }, [
        m('h4', 'How to get your access token:'),
        m('ol', { style: 'margin: 0.5rem 0; padding-left: 1.5rem;' }, [
          m('li', [
            'Log in to your EA account at ',
            m('a', {
              href: 'https://www.ea.com/login',
              target: '_blank',
              rel: 'noopener noreferrer'
            }, 'ea.com/login')
          ]),
          m('li', [
            'Then open ',
            m('a', {
              href: 'https://accounts.ea.com/connect/auth?client_id=ORIGIN_JS_SDK&response_type=token&redirect_uri=nucleus:rest&prompt=none',
              target: '_blank',
              rel: 'noopener noreferrer'
            }, 'this link'),
            ' — it will show JSON with an ',
            m('code', 'access_token'),
            ' field. Copy that value (a long string of letters and numbers)'
          ])
        ]),
        m('small', { style: 'color: var(--muted-color);' },
          'If the link shows an error, make sure you are logged in at ea.com first.'
        )
      ]),

      m('div.form-group', [
        m('label', { for: 'ea-token' }, 'Access Token'),
        m('textarea', {
          id: 'ea-token',
          rows: 3,
          placeholder: 'Paste your access_token value here...',
          value: this.bearerToken || '',
          disabled: storefront.importing,
          oninput: (event) => { this.bearerToken = event.target.value.trim() || null; }
        })
      ]),

      hasBearerToken && m(AuthStatus, {
        label: 'Access token provided',
        onClear: () => this.clearAuth(storefront)
      }),

      m(SecurityNotice, { credentialName: 'access token' }),

      m(ImportOptionsFieldset, {
        options: storefront.options,
        disabled: storefront.importing,
        showPlaytime: true
      }),

      !storefront.result && m('button', {
        disabled: !hasBearerToken || storefront.importing,
        onclick: () => this.importLibrary(storefront)
      }, storefront.importing ? 'Importing...' : 'Import from EA App')
    ]);
  }
};
