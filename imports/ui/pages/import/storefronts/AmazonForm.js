import m from 'mithril';
import { Meteor } from 'meteor/meteor';
import { clearProgressAfterDelay } from '../../../components/import/importHelpers.js';
import { ImportOptionsFieldset } from '../../../components/import/ImportOptionsFieldset.js';
import { AuthStatus } from '../../../components/import/AuthStatus.js';
import { SecurityNotice } from '../../../components/import/SecurityNotice.js';

export const AmazonForm = {
  oninit() {
    this.authCode = null;
    this.codeVerifier = null;
    this.deviceSerial = null;
    this.loginWindow = null;
  },

  onremove() {
    if (this.loginWindow && !this.loginWindow.closed) {
      this.loginWindow.close();
    }
  },

  openLogin() {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-._~';
    let verifier = '';
    for (let index = 0; index < 45; index++) {
      verifier += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    this.codeVerifier = verifier;

    const encoder = new TextEncoder();
    const data = encoder.encode(verifier);

    crypto.subtle.digest('SHA-256', data).then(hashBuffer => {
      const hashArray = new Uint8Array(hashBuffer);
      let base64 = btoa(String.fromCharCode.apply(null, hashArray));
      const challenge = base64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

      const uuid = crypto.randomUUID().replace(/-/g, '').toUpperCase();
      this.deviceSerial = uuid;

      const clientIdRaw = uuid + '#A2UMVHOX7UP4V7';
      let clientId = '';
      for (let i = 0; i < clientIdRaw.length; i++) {
        clientId += clientIdRaw.charCodeAt(i).toString(16).padStart(2, '0');
      }

      const params = [
        'openid.ns=' + encodeURIComponent('http://specs.openid.net/auth/2.0'),
        'openid.claimed_id=' + encodeURIComponent('http://specs.openid.net/auth/2.0/identifier_select'),
        'openid.identity=' + encodeURIComponent('http://specs.openid.net/auth/2.0/identifier_select'),
        'openid.mode=checkid_setup',
        'openid.oa2.scope=device_auth_access',
        'openid.ns.oa2=' + encodeURIComponent('http://www.amazon.com/ap/ext/oauth/2'),
        'openid.oa2.response_type=code',
        'openid.oa2.code_challenge_method=S256',
        'openid.oa2.client_id=' + encodeURIComponent('device:' + clientId),
        'language=en_US',
        'marketPlaceId=ATVPDKIKX0DER',
        'openid.return_to=' + encodeURIComponent('https://www.amazon.com'),
        'openid.pape.max_auth_age=0',
        'openid.assoc_handle=amzn_sonic_games_launcher',
        'pageId=amzn_sonic_games_launcher',
        'openid.oa2.code_challenge=' + encodeURIComponent(challenge)
      ];

      const oauthUrl = 'https://www.amazon.com/ap/signin?' + params.join('&');

      const width = 500;
      const height = 700;
      const left = window.screenX + (window.outerWidth - width) / 2;
      const top = window.screenY + (window.outerHeight - height) / 2;

      this.loginWindow = window.open(
        oauthUrl,
        'amazon-login',
        `width=${width},height=${height},left=${left},top=${top},menubar=no,toolbar=no,location=yes,status=no`
      );

      if (!this.loginWindow) {
        vnode.attrs.storefront.error = 'Could not open login popup. Please allow popups for this site.';
        m.redraw();
      }
    });
  },

  clearAuth(storefront) {
    this.authCode = null;
    this.codeVerifier = null;
    this.deviceSerial = null;
    if (this.loginWindow && !this.loginWindow.closed) {
      this.loginWindow.close();
    }
    this.loginWindow = null;
    storefront.result = null;
    storefront.error = null;
    m.redraw();
  },

  async importLibrary(storefront) {
    if (!this.authCode || !this.codeVerifier || !this.deviceSerial) {
      storefront.error = 'Please log in to Amazon first to get the authorization code.';
      m.redraw();
      return;
    }

    storefront.importing = true;
    storefront.error = null;
    storefront.result = null;
    m.redraw();

    try {
      storefront.result = await Meteor.callAsync('import.amazon', this.authCode, this.codeVerifier, this.deviceSerial, {
        updateExisting: storefront.options.updateExisting
      });
      this.authCode = null;
      this.codeVerifier = null;
      this.deviceSerial = null;
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
    const hasCodeVerifier = !!this.codeVerifier;

    return m('div.amazon-form', [
      !hasCodeVerifier && m('div.amazon-instructions', { style: 'margin-bottom: 1rem;' }, [
        m('h4', 'Import from Amazon Games'),
        m('p', { style: 'margin-bottom: 0.5rem;' },
          'Click the button below to open the Amazon login window.'
        )
      ]),

      !hasAuthCode && m('button', {
        disabled: storefront.importing,
        onclick: () => this.openLogin(),
        style: 'margin-bottom: 1rem;'
      }, 'Open Amazon Login'),

      hasCodeVerifier && !hasAuthCode && m('div.amazon-instructions', { style: 'margin-bottom: 1rem;' }, [
        m('h4', 'Capture the Authorization Code'),
        m('p', { style: 'margin-bottom: 0.5rem; color: var(--muted-color); font-size: 0.9em;' },
          'In the popup window that just opened, follow these steps:'
        ),
        m('ol', { style: 'margin: 0.5rem 0; padding-left: 1.5rem; font-size: 0.95em;' }, [
          m('li', [
            'In the ',
            m('strong', 'popup window'),
            ', open Developer Tools: ',
            m('kbd', { style: 'font-size: 0.85em;' }, 'F12'),
            ' (Windows) or ',
            m('kbd', { style: 'font-size: 0.85em;' }, 'Cmd+Option+I'),
            ' (Mac)'
          ]),
          m('li', [
            'Go to the ',
            m('strong', 'Network'),
            ' tab and check ',
            m('strong', '"Preserve log"')
          ]),
          m('li', 'Log in to your Amazon account'),
          m('li', [
            'After redirect, in the Network tab look for a request to ',
            m('code', 'amazon.com'),
            ' containing ',
            m('code', 'openid.oa2.authorization_code')
          ]),
          m('li', 'Copy that code value and paste it below')
        ])
      ]),

      hasCodeVerifier && !hasAuthCode && m('div.form-group', { style: 'margin-bottom: 1rem;' }, [
        m('label', { for: 'amazon-auth-code' }, 'Authorization Code'),
        m('input', {
          type: 'text',
          id: 'amazon-auth-code',
          placeholder: 'Paste openid.oa2.authorization_code value here...',
          value: this.authCode || '',
          disabled: storefront.importing,
          oninput: (event) => { this.authCode = event.target.value.trim() || null; }
        })
      ]),

      hasAuthCode && m(AuthStatus, {
        label: 'Authorization code provided',
        onClear: () => this.clearAuth(storefront)
      }),

      m(SecurityNotice, { credentialName: 'authorization code' }),

      m(ImportOptionsFieldset, {
        options: storefront.options,
        disabled: storefront.importing
      }),

      !storefront.result && m('button', {
        disabled: !hasAuthCode || storefront.importing,
        onclick: () => this.importLibrary(storefront)
      }, storefront.importing ? 'Importing...' : 'Import from Amazon')
    ]);
  }
};
