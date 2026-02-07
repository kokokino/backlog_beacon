import m from 'mithril';
import { Meteor } from 'meteor/meteor';
import { clearProgressAfterDelay } from '../../../components/import/importHelpers.js';
import { ImportOptionsFieldset } from '../../../components/import/ImportOptionsFieldset.js';


export const LegacyGamesForm = {
  oninit() {
    this.email = '';
    this.password = '';
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
      storefront.result = await Meteor.callAsync('import.legacygames', this.email, this.password, {
        updateExisting: storefront.options.updateExisting
      });
      this.email = '';
      this.password = '';
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

    return m('div.legacygames-form', [
      m('div.privacy-notice', { style: 'margin-bottom: 1rem;' }, [
        m('strong', 'Security Note: '),
        'Your credentials are sent directly to Legacy Games for authentication and are never stored. They are discarded immediately after use.'
      ]),

      m('div.form-group', [
        m('label', { for: 'legacygames-email' }, 'Legacy Games Account Email'),
        m('input', {
          type: 'email',
          id: 'legacygames-email',
          placeholder: 'your@email.com',
          value: this.email,
          disabled: storefront.importing,
          autocomplete: 'off',
          oninput: (event) => { this.email = event.target.value; }
        })
      ]),

      m('div.form-group', [
        m('label', { for: 'legacygames-password' }, 'Password'),
        m('input', {
          type: 'password',
          id: 'legacygames-password',
          placeholder: 'Enter your password',
          value: this.password,
          disabled: storefront.importing,
          autocomplete: 'off',
          oninput: (event) => { this.password = event.target.value; }
        })
      ]),

      m(ImportOptionsFieldset, {
        options: storefront.options,
        disabled: storefront.importing
      }),

      !storefront.result && m('button', {
        disabled: !hasCredentials || storefront.importing,
        onclick: () => this.importLibrary(storefront)
      }, storefront.importing ? 'Importing...' : 'Import from Legacy Games')
    ]);
  }
};
