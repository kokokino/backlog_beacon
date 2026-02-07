import m from 'mithril';
import { Meteor } from 'meteor/meteor';
import { clearProgressAfterDelay } from '../../../components/import/importHelpers.js';
import { ImportOptionsFieldset } from '../../../components/import/ImportOptionsFieldset.js';


export const UbisoftForm = {
  oninit() {
    this.email = '';
    this.password = '';
    this.twoFactorTicket = null;
    this.twoFactorCode = '';
    this.needs2FA = false;
  },

  clearAuth(storefront) {
    this.email = '';
    this.password = '';
    this.twoFactorTicket = null;
    this.twoFactorCode = '';
    this.needs2FA = false;
    storefront.result = null;
    storefront.error = null;
    m.redraw();
  },

  async importLibrary(storefront) {
    if (!this.email.trim() || !this.password) {
      storefront.error = 'Email and password are required.';
      m.redraw();
      return;
    }

    storefront.importing = true;
    storefront.error = null;
    storefront.result = null;
    m.redraw();

    try {
      storefront.result = await Meteor.callAsync('import.ubisoft', this.email, this.password, {
        updateExisting: storefront.options.updateExisting
      });
      this.email = '';
      this.password = '';
      clearProgressAfterDelay('import.clearStorefrontProgress');
    } catch (error) {
      if (error.error === 'auth-2fa-required') {
        this.twoFactorTicket = error.details;
        this.needs2FA = true;
        this.password = '';
      } else {
        storefront.error = error.reason || error.message || 'Import failed';
      }
    }

    storefront.importing = false;
    m.redraw();
  },

  async import2FA(storefront) {
    if (!this.twoFactorTicket || !this.twoFactorCode.trim()) {
      storefront.error = 'Please enter the verification code.';
      m.redraw();
      return;
    }

    storefront.importing = true;
    storefront.error = null;
    storefront.result = null;
    m.redraw();

    try {
      storefront.result = await Meteor.callAsync('import.ubisoft2fa', this.twoFactorTicket, this.twoFactorCode, {
        updateExisting: storefront.options.updateExisting
      });
      this.email = '';
      this.password = '';
      this.twoFactorTicket = null;
      this.twoFactorCode = '';
      this.needs2FA = false;
      clearProgressAfterDelay('import.clearStorefrontProgress');
    } catch (error) {
      storefront.error = error.reason || error.message || 'Import failed';
    }

    storefront.importing = false;
    m.redraw();
  },

  view(vnode) {
    const { storefront } = vnode.attrs;
    const hasCredentials = this.email.trim().length > 0 && this.password.length > 0;
    const hasCode = this.twoFactorCode.trim().length > 0;

    return m('div.ubisoft-form', [
      m('div.privacy-notice', { style: 'margin-bottom: 1rem;' }, [
        m('strong', 'Security Note: '),
        'Your credentials are sent directly to Ubisoft for authentication and are never stored. They are discarded immediately after use.'
      ]),

      m('div.form-group', [
        m('label', { for: 'ubisoft-email' }, 'Ubisoft Account Email'),
        m('input', {
          type: 'email',
          id: 'ubisoft-email',
          placeholder: 'your@email.com',
          value: this.email,
          disabled: storefront.importing || this.needs2FA,
          autocomplete: 'off',
          oninput: (event) => { this.email = event.target.value; }
        })
      ]),

      m('div.form-group', [
        m('label', { for: 'ubisoft-password' }, 'Password'),
        m('input', {
          type: 'password',
          id: 'ubisoft-password',
          placeholder: 'Enter your password',
          value: this.password,
          disabled: storefront.importing || this.needs2FA,
          autocomplete: 'off',
          oninput: (event) => { this.password = event.target.value; }
        })
      ]),

      this.needs2FA && m('div.ubisoft-2fa', [
        m('div.auth-status', { style: 'margin-bottom: 1rem; color: var(--ins-color);' },
          'Two-factor authentication required. Enter the code from your authenticator app or SMS.'
        ),
        m('div.form-group', [
          m('label', { for: 'ubisoft-2fa-code' }, 'Verification Code'),
          m('input', {
            type: 'text',
            id: 'ubisoft-2fa-code',
            placeholder: 'Enter 6-digit code',
            value: this.twoFactorCode,
            disabled: storefront.importing,
            autocomplete: 'off',
            oninput: (event) => { this.twoFactorCode = event.target.value; }
          })
        ])
      ]),

      m(ImportOptionsFieldset, {
        options: storefront.options,
        disabled: storefront.importing
      }),

      !storefront.result && !this.needs2FA && m('button', {
        disabled: !hasCredentials || storefront.importing,
        onclick: () => this.importLibrary(storefront)
      }, storefront.importing ? 'Authenticating...' : 'Import from Ubisoft Connect'),

      !storefront.result && this.needs2FA && m('div.ubisoft-2fa-actions', [
        m('button', {
          disabled: !hasCode || storefront.importing,
          onclick: () => this.import2FA(storefront)
        }, storefront.importing ? 'Verifying...' : 'Verify & Import'),
        ' ',
        m('button.outline.secondary', {
          disabled: storefront.importing,
          onclick: () => this.clearAuth(storefront)
        }, 'Cancel')
      ])
    ]);
  }
};
