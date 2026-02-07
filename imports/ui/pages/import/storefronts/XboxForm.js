import m from 'mithril';
import { Meteor } from 'meteor/meteor';
import { clearProgressAfterDelay } from '../../../components/import/importHelpers.js';
import { ImportOptionsFieldset } from '../../../components/import/ImportOptionsFieldset.js';
import { AuthStatus } from '../../../components/import/AuthStatus.js';


export const XboxForm = {
  oninit() {
    this.authCode = null;
  },

  updateAuthCode(value) {
    const trimmed = value.trim();
    if (trimmed.includes('code=')) {
      try {
        const url = new URL(trimmed);
        const code = url.searchParams.get('code');
        this.authCode = code || trimmed;
      } catch (error) {
        this.authCode = trimmed || null;
      }
    } else {
      this.authCode = trimmed || null;
    }
  },

  clearAuth(storefront) {
    this.authCode = null;
    storefront.result = null;
    storefront.error = null;
    m.redraw();
  },

  async importLibrary(storefront) {
    if (!this.authCode) {
      storefront.error = 'Please enter your Microsoft authorization code.';
      m.redraw();
      return;
    }

    storefront.importing = true;
    storefront.error = null;
    storefront.result = null;
    m.redraw();

    try {
      storefront.result = await Meteor.callAsync('import.xbox', this.authCode, {
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

    return m('div.xbox-form', [
      m('div.xbox-instructions', { style: 'margin-bottom: 1rem;' }, [
        m('h4', 'How to get your authorization code:'),
        m('ol', { style: 'margin: 0.5rem 0; padding-left: 1.5rem;' }, [
          m('li', [
            'Click this link to open Microsoft login: ',
            m('a', {
              href: 'https://login.live.com/oauth20_authorize.srf?client_id=388ea51c-0b25-4029-aae2-17df49d23905&response_type=code&approval_prompt=auto&scope=Xboxlive.signin+Xboxlive.offline_access&redirect_uri=http%3A%2F%2Flocalhost%3A8080%2Fauth%2Fcallback',
              target: '_blank',
              rel: 'noopener noreferrer'
            }, 'Get Authorization Code')
          ]),
          m('li', 'Log in to your Microsoft account if prompted'),
          m('li', [
            'After login, the page will show a "can\'t reach this page" error — ',
            m('strong', 'this is expected')
          ]),
          m('li', [
            'Copy the ',
            m('strong', 'entire URL'),
            ' from the address bar and paste it below (the code will be extracted automatically)'
          ])
        ])
      ]),

      m('div.limitation-notice', { style: 'margin-bottom: 1rem; padding: 0.75rem; background: var(--card-sectionning-background-color); border-radius: var(--border-radius);' }, [
        m('strong', 'Note: '),
        'Xbox only reports games you have played or installed at least once. Purchased games that have never been launched will not appear.'
      ]),

      m('div.form-group', [
        m('label', { for: 'xbox-auth-code' }, 'Authorization Code'),
        m('input', {
          type: 'text',
          id: 'xbox-auth-code',
          placeholder: 'Paste the full URL or authorization code here...',
          value: this.authCode || '',
          disabled: storefront.importing,
          oninput: (event) => this.updateAuthCode(event.target.value)
        }),
        m('small', 'You can paste the full URL — the code will be extracted automatically.')
      ]),

      hasAuthCode && m(AuthStatus, {
        label: 'Authorization code provided',
        onClear: () => this.clearAuth(storefront)
      }),

      m('div.privacy-notice', { style: 'margin-bottom: 1rem;' }, [
        m('strong', 'Security Note: '),
        'Your authorization code is only used once to fetch your game library and is never stored. All tokens are discarded after import.'
      ]),

      m(ImportOptionsFieldset, {
        options: storefront.options,
        disabled: storefront.importing,
        showPlaytime: true
      }),

      !storefront.result && m('button', {
        disabled: !hasAuthCode || storefront.importing,
        onclick: () => this.importLibrary(storefront)
      }, storefront.importing ? 'Importing...' : 'Import from Xbox')
    ]);
  }
};
