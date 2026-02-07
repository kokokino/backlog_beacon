import m from 'mithril';
import { Meteor } from 'meteor/meteor';
import { clearProgressAfterDelay } from '../../../components/import/importHelpers.js';
import { ImportOptionsFieldset } from '../../../components/import/ImportOptionsFieldset.js';
import { AuthStatus } from '../../../components/import/AuthStatus.js';
import { SecurityNotice } from '../../../components/import/SecurityNotice.js';

export const OculusForm = {
  oninit() {
    this.accessToken = null;
    this.platform = 'quest';
  },

  clearAuth(storefront) {
    this.accessToken = null;
    storefront.result = null;
    storefront.error = null;
    m.redraw();
  },

  async importLibrary(storefront) {
    if (!this.accessToken) {
      storefront.error = 'Please enter your Oculus access token.';
      m.redraw();
      return;
    }

    storefront.importing = true;
    storefront.error = null;
    storefront.result = null;
    m.redraw();

    try {
      storefront.result = await Meteor.callAsync('import.oculus', this.accessToken, this.platform, {
        updateExisting: storefront.options.updateExisting
      });
      this.accessToken = null;
      clearProgressAfterDelay('import.clearStorefrontProgress');
    } catch (error) {
      storefront.error = error.reason || error.message || 'Import failed';
    }

    storefront.importing = false;
    m.redraw();
  },

  view(vnode) {
    const { storefront } = vnode.attrs;
    const hasAccessToken = !!this.accessToken;

    return m('div.oculus-form', [
      m('div.form-group', [
        m('label', { for: 'oculus-platform' }, 'Platform'),
        m('select', {
          id: 'oculus-platform',
          value: this.platform,
          disabled: storefront.importing,
          onchange: (event) => { this.platform = event.target.value; }
        }, [
          m('option', { value: 'quest' }, 'Meta Quest (Quest, Quest 2, Quest 3, Quest Pro)'),
          m('option', { value: 'rift' }, 'Oculus Rift / Rift S (PC VR)'),
          m('option', { value: 'go' }, 'Oculus Go')
        ])
      ]),

      m('div.oculus-instructions', { style: 'margin-bottom: 1rem;' }, [
        m('h4', 'How to get your access token:'),
        m('p', { style: 'margin-bottom: 0.5rem; font-weight: bold;' }, 'Option 1: From the Oculus website'),
        m('ol', { style: 'margin: 0.5rem 0; padding-left: 1.5rem;' }, [
          m('li', [
            'Go to ',
            m('a', {
              href: 'https://secure.oculus.com/my/quest/',
              target: '_blank',
              rel: 'noopener noreferrer'
            }, 'secure.oculus.com/my/quest'),
            ' and log in'
          ]),
          m('li', 'Open Developer Tools (F12 on Windows, Cmd+Option+I on Mac)'),
          m('li', 'Go to the Application tab (Chrome) or Storage tab (Firefox)'),
          m('li', [
            'Expand Cookies and click on ',
            m('code', 'https://secure.oculus.com')
          ]),
          m('li', [
            'Find the cookie named ',
            m('code', 'oc_ac_at'),
            ' and copy the entire Value (starts with "OC")'
          ])
        ]),
        m('p', { style: 'margin: 1rem 0 0.5rem 0; font-weight: bold;' }, 'Option 2: From the Oculus desktop app'),
        m('ol', { style: 'margin: 0.5rem 0; padding-left: 1.5rem;' }, [
          m('li', 'Open the Oculus desktop app'),
          m('li', [
            'Press ',
            m('kbd', 'Ctrl+Shift+I'),
            ' to open Developer Tools'
          ]),
          m('li', [
            'Go to the Network tab and press ',
            m('kbd', 'Ctrl+R'),
            ' to refresh'
          ]),
          m('li', [
            'Filter for "',
            m('code', 'graph'),
            '", click the first result, open the Payload tab'
          ]),
          m('li', 'Scroll to find the access_token (starts with "FRL") and copy it')
        ])
      ]),

      m('div.form-group', [
        m('label', { for: 'oculus-token' }, 'Access Token'),
        m('textarea', {
          id: 'oculus-token',
          rows: 3,
          placeholder: 'Paste your access token here (starts with OC or FRL)...',
          value: this.accessToken || '',
          disabled: storefront.importing,
          oninput: (event) => { this.accessToken = event.target.value.trim() || null; }
        })
      ]),

      hasAccessToken && m(AuthStatus, {
        label: 'Access token provided',
        onClear: () => this.clearAuth(storefront)
      }),

      m(SecurityNotice, { credentialName: 'access token' }),

      m(ImportOptionsFieldset, {
        options: storefront.options,
        disabled: storefront.importing
      }),

      !storefront.result && m('button', {
        disabled: !hasAccessToken || storefront.importing,
        onclick: () => this.importLibrary(storefront)
      }, storefront.importing ? 'Importing...' : 'Import from Oculus')
    ]);
  }
};
