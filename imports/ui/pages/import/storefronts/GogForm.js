import m from 'mithril';
import { Meteor } from 'meteor/meteor';
import { clearProgressAfterDelay } from '../../../components/import/importHelpers.js';
import { ImportOptionsFieldset } from '../../../components/import/ImportOptionsFieldset.js';
import { SecurityNotice } from '../../../components/import/SecurityNotice.js';

export const GogForm = {
  oninit() {
    this.username = '';
    this.method = 'public';
    this.sessionCookie = null;
    this.loginWindow = null;
    this.loginCheckInterval = null;
  },

  onremove() {
    if (this.loginCheckInterval) {
      clearInterval(this.loginCheckInterval);
    }
    if (this.loginWindow && !this.loginWindow.closed) {
      this.loginWindow.close();
    }
  },

  setMethod(method, storefront) {
    this.method = method;
    storefront.preview = null;
    storefront.result = null;
    storefront.error = null;
  },

  openLoginPopup(storefront) {
    const width = 500;
    const height = 700;
    const left = window.screenX + (window.outerWidth - width) / 2;
    const top = window.screenY + (window.outerHeight - height) / 2;

    this.loginWindow = window.open(
      'https://www.gog.com/account',
      'gog-login',
      `width=${width},height=${height},left=${left},top=${top},menubar=no,toolbar=no,location=yes,status=no`
    );

    if (!this.loginWindow) {
      storefront.error = 'Could not open login popup. Please allow popups for this site.';
      m.redraw();
      return;
    }

    storefront.error = null;
    m.redraw();

    this.loginCheckInterval = setInterval(() => {
      try {
        if (this.loginWindow.closed) {
          clearInterval(this.loginCheckInterval);
          this.loginCheckInterval = null;
          storefront.error = 'Popup closed. If you logged in successfully, please enter your session cookie manually or try the Public Profile method instead.';
          m.redraw();
        }
      } catch (error) {
        // Cross-origin access error - expected behavior
      }
    }, 1000);
  },

  clearSession(storefront) {
    this.sessionCookie = null;
    storefront.preview = null;
    storefront.result = null;
    storefront.error = null;
    m.redraw();
  },

  async previewPublic(storefront) {
    if (!this.username.trim()) {
      return;
    }

    storefront.previewing = true;
    storefront.error = null;
    storefront.preview = null;
    storefront.result = null;
    m.redraw();

    try {
      storefront.preview = await Meteor.callAsync('import.previewStorefront', 'gog', this.username);
    } catch (error) {
      storefront.error = error.reason || error.message || 'Failed to preview library';
    }

    storefront.previewing = false;
    m.redraw();
  },

  async previewAuth(storefront) {
    if (!this.sessionCookie) {
      storefront.error = 'Please enter your GOG session cookie first.';
      m.redraw();
      return;
    }

    storefront.previewing = true;
    storefront.error = null;
    storefront.preview = null;
    storefront.result = null;
    m.redraw();

    try {
      storefront.preview = await Meteor.callAsync('import.previewGogAuth', this.sessionCookie);
    } catch (error) {
      storefront.error = error.reason || error.message || 'Failed to preview library';
    }

    storefront.previewing = false;
    m.redraw();
  },

  async importPublic(storefront) {
    if (!this.username.trim()) {
      return;
    }

    storefront.importing = true;
    storefront.error = null;
    storefront.result = null;
    m.redraw();

    try {
      storefront.result = await Meteor.callAsync('import.storefront', 'gog', this.username, storefront.options);
      this.username = '';
      storefront.preview = null;
      clearProgressAfterDelay('import.clearStorefrontProgress');
    } catch (error) {
      storefront.error = error.reason || error.message || 'Import failed';
    }

    storefront.importing = false;
    m.redraw();
  },

  async importAuth(storefront) {
    if (!this.sessionCookie) {
      storefront.error = 'Please enter your GOG session cookie first.';
      m.redraw();
      return;
    }

    storefront.importing = true;
    storefront.error = null;
    storefront.result = null;
    m.redraw();

    try {
      storefront.result = await Meteor.callAsync('import.gogAuth', this.sessionCookie, {
        updateExisting: storefront.options.updateExisting
      });
      this.sessionCookie = null;
      storefront.preview = null;
      clearProgressAfterDelay('import.clearStorefrontProgress');
    } catch (error) {
      storefront.error = error.reason || error.message || 'Import failed';
    }

    storefront.importing = false;
    m.redraw();
  },

  view(vnode) {
    const { storefront } = vnode.attrs;
    const hasUsername = this.username.trim().length > 0;
    const hasSession = !!this.sessionCookie;
    const isPublicMethod = this.method === 'public';
    const canPreview = isPublicMethod ? hasUsername : hasSession;
    const canImport = storefront.preview && storefront.preview.total > 0;

    return m('div.gog-form', [
      m('fieldset.gog-method-selector', [
        m('legend', 'Import Method'),

        m('label.method-option', { style: 'display: block; margin-bottom: 1rem; cursor: pointer;' }, [
          m('input', {
            type: 'radio',
            name: 'gog-method',
            value: 'public',
            checked: this.method === 'public',
            disabled: storefront.importing || storefront.previewing,
            onchange: () => this.setMethod('public', storefront)
          }),
          m('strong', ' Public Profile'),
          m('p', { style: 'margin: 0.25rem 0 0 1.5rem; font-size: 0.9em; color: var(--muted-color);' }, [
            'Enter your GOG username. Requires your profile to be set to public.',
            m('br'),
            m('small', 'Includes playtime data.')
          ])
        ]),

        m('label.method-option', { style: 'display: block; cursor: pointer;' }, [
          m('input', {
            type: 'radio',
            name: 'gog-method',
            value: 'login',
            checked: this.method === 'login',
            disabled: storefront.importing || storefront.previewing,
            onchange: () => this.setMethod('login', storefront)
          }),
          m('strong', ' Session Cookie'),
          m('p', { style: 'margin: 0.25rem 0 0 1.5rem; font-size: 0.9em; color: var(--muted-color);' }, [
            'Paste your GOG session cookie. Works with any account, including private profiles.',
            m('br'),
            m('small', 'Does not include playtime data.')
          ])
        ])
      ]),

      isPublicMethod && m('div.gog-public-form', [
        m('div.form-group', [
          m('label', { for: 'gog-username' }, 'GOG Profile URL or Username'),
          m('input', {
            type: 'text',
            id: 'gog-username',
            placeholder: 'e.g., https://www.gog.com/u/username or just username',
            value: this.username,
            disabled: storefront.importing || storefront.previewing,
            oninput: (event) => { this.username = event.target.value; }
          }),
          m('small', 'Paste your GOG profile URL, or just your username.')
        ]),

        m('div.privacy-notice', { style: 'margin-bottom: 1rem;' }, [
          m('strong', 'Note: '),
          'Your profile must be public. ',
          m('a', {
            href: 'https://www.gog.com/account/settings/privacy',
            target: '_blank',
            rel: 'noopener noreferrer'
          }, 'Check privacy settings')
        ])
      ]),

      !isPublicMethod && m('div.gog-login-form', [
        m('div.form-group', [
          m('label', { for: 'gog-session' }, 'GOG Session Cookie'),
          m('textarea', {
            id: 'gog-session',
            rows: 3,
            placeholder: 'Paste your gog-al cookie value here...',
            value: this.sessionCookie || '',
            disabled: storefront.importing || storefront.previewing,
            oninput: (event) => {
              this.sessionCookie = event.target.value.trim() || null;
            }
          }),
          m('small', [
            'To get your session cookie: ',
            m('ol', { style: 'margin: 0.5rem 0; padding-left: 1.5rem;' }, [
              m('li', 'Login to GOG.com in your browser'),
              m('li', 'Open Developer Tools (F12) and go to Application > Cookies > www.gog.com'),
              m('li', 'Find the cookie named "gog-al" and copy the entire Value (it\'s a long string)')
            ]),
            m('p', { style: 'margin-top: 0.5rem; font-style: italic;' },
              'Tip: The value is very long. Make sure to copy the entire thing, not just the visible portion.')
          ])
        ]),

        hasSession && m('div.logged-in-notice', { style: 'margin-bottom: 1rem;' }, [
          m('span', { style: 'color: var(--ins-color);' }, 'Session cookie provided'),
          ' ',
          m('button.outline.secondary', {
            style: 'padding: 0.25rem 0.5rem; font-size: 0.85em;',
            onclick: () => this.clearSession(storefront)
          }, 'Clear')
        ]),

        m('div.privacy-notice', { style: 'margin-bottom: 1rem;' }, [
          m('strong', 'Security Note: '),
          'Your session cookie is only used once to fetch your library and is never stored. It will be cleared after import.'
        ])
      ]),

      m(ImportOptionsFieldset, {
        options: storefront.options,
        disabled: storefront.importing || storefront.previewing,
        showPlaytime: isPublicMethod,
        showLastPlayed: isPublicMethod
      }),

      !storefront.preview && !storefront.result && m('button', {
        disabled: !canPreview || storefront.previewing || storefront.importing,
        onclick: () => isPublicMethod ? this.previewPublic(storefront) : this.previewAuth(storefront)
      }, storefront.previewing ? 'Loading...' : 'Preview Library'),

      storefront.preview && !storefront.importing && !storefront.result && m('div.import-actions', { style: 'margin-top: 1rem;' }, [
        m('button', {
          disabled: storefront.importing || !canImport,
          onclick: () => isPublicMethod ? this.importPublic(storefront) : this.importAuth(storefront)
        }, storefront.importing ? 'Importing...' : `Import ${storefront.preview.total} Games`)
      ])
    ]);
  }
};
