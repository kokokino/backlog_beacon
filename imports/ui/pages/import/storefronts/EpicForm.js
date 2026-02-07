import m from 'mithril';
import { Meteor } from 'meteor/meteor';
import { clearProgressAfterDelay } from '../../../components/import/importHelpers.js';
import { ImportOptionsFieldset } from '../../../components/import/ImportOptionsFieldset.js';
import { AuthStatus } from '../../../components/import/AuthStatus.js';
import { SecurityNotice } from '../../../components/import/SecurityNotice.js';

export const EpicForm = {
  oninit() {
    this.authCode = null;
  },

  clearAuth(storefront) {
    this.authCode = null;
    storefront.result = null;
    storefront.error = null;
    m.redraw();
  },

  async importLibrary(storefront) {
    if (!this.authCode) {
      storefront.error = 'Please enter your Epic Games authorization code.';
      m.redraw();
      return;
    }

    storefront.importing = true;
    storefront.error = null;
    storefront.result = null;
    m.redraw();

    try {
      storefront.result = await Meteor.callAsync('import.epic', this.authCode, {
        updateExisting: storefront.options.updateExisting,
        importPlaytime: storefront.options.importPlaytime
      });
      this.authCode = null;
      clearProgressAfterDelay('import.clearStorefrontProgress');
    } catch (error) {
      storefront.error = error.reason || error.message || 'Import failed';
    }

    storefront.importing = false;
    m.redraw();
  },

  view(vnode) {
    const { storefront } = vnode.attrs;
    const hasAuthCode = !!this.authCode;

    return m('div.epic-form', [
      m('div.epic-instructions', { style: 'margin-bottom: 1rem;' }, [
        m('h4', 'How to get your authorization code:'),
        m('ol', { style: 'margin: 0.5rem 0; padding-left: 1.5rem;' }, [
          m('li', [
            'Click this link to open Epic Games login: ',
            m('a', {
              href: 'https://www.epicgames.com/id/login?redirectUrl=https%3A%2F%2Fwww.epicgames.com%2Fid%2Fapi%2Fredirect%3FclientId%3D34a02cf8f4414e29b15921876da36f9a%26responseType%3Dcode',
              target: '_blank',
              rel: 'noopener noreferrer'
            }, 'Get Authorization Code')
          ]),
          m('li', 'Log in to your Epic Games account if prompted'),
          m('li', 'You will see a page with JSON containing your authorization code'),
          m('li', 'Copy the value next to "authorizationCode" (without quotes)')
        ])
      ]),

      m('div.form-group', [
        m('label', { for: 'epic-auth-code' }, 'Authorization Code'),
        m('input', {
          type: 'text',
          id: 'epic-auth-code',
          placeholder: 'Paste your authorization code here...',
          value: this.authCode || '',
          disabled: storefront.importing,
          oninput: (event) => { this.authCode = event.target.value.trim() || null; }
        }),
        m('small', 'The code looks like a long string of letters and numbers.')
      ]),

      hasAuthCode && m(AuthStatus, {
        label: 'Authorization code provided',
        onClear: () => this.clearAuth(storefront)
      }),

      m(SecurityNotice, { credentialName: 'authorization code' }),

      m(ImportOptionsFieldset, {
        options: storefront.options,
        disabled: storefront.importing,
        showPlaytime: true
      }),

      !storefront.result && m('button', {
        disabled: !hasAuthCode || storefront.importing,
        onclick: () => this.importLibrary(storefront)
      }, storefront.importing ? 'Importing...' : 'Import from Epic')
    ]);
  }
};
