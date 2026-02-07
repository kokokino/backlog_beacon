import m from 'mithril';
import { Meteor } from 'meteor/meteor';
import { clearProgressAfterDelay } from '../../../components/import/importHelpers.js';
import { ImportOptionsFieldset } from '../../../components/import/ImportOptionsFieldset.js';


export const RetroAchievementsForm = {
  oninit() {
    this.username = '';
    this.apiKey = '';
  },

  async importLibrary(storefront) {
    if (!this.username.trim() || !this.apiKey.trim()) {
      storefront.error = 'Username and API key are required.';
      m.redraw();
      return;
    }

    storefront.importing = true;
    storefront.error = null;
    storefront.result = null;
    m.redraw();

    try {
      storefront.result = await Meteor.callAsync('import.retroachievements', this.username, this.apiKey, {
        updateExisting: storefront.options.updateExisting
      });
      this.username = '';
      this.apiKey = '';
      clearProgressAfterDelay('import.clearStorefrontProgress');
    } catch (error) {
      storefront.error = error.reason || error.message || 'Import failed';
    }

    storefront.importing = false;
    m.redraw();
  },

  view(vnode) {
    const { storefront } = vnode.attrs;
    const hasCredentials = this.username.trim().length > 0 && this.apiKey.trim().length > 0;

    return m('div.retroachievements-form', [
      m('div.privacy-notice', { style: 'margin-bottom: 1rem;' }, [
        m('strong', 'Security Note: '),
        'Your API key is sent directly to RetroAchievements for authentication and is never stored. It is discarded immediately after use.'
      ]),

      m('div.form-group', [
        m('label', { for: 'ra-username' }, 'RetroAchievements Username'),
        m('input', {
          type: 'text',
          id: 'ra-username',
          placeholder: 'Your RA username',
          value: this.username,
          disabled: storefront.importing,
          autocomplete: 'off',
          oninput: (event) => { this.username = event.target.value; }
        })
      ]),

      m('div.form-group', [
        m('label', { for: 'ra-apikey' }, 'Web API Key'),
        m('input', {
          type: 'text',
          id: 'ra-apikey',
          placeholder: 'Your Web API key',
          value: this.apiKey,
          disabled: storefront.importing,
          autocomplete: 'off',
          oninput: (event) => { this.apiKey = event.target.value; }
        }),
        m('small', { style: 'color: var(--muted-color);' },
          'Get your API key from your RetroAchievements profile settings (Settings \u2192 Keys).'
        )
      ]),

      m(ImportOptionsFieldset, {
        options: storefront.options,
        disabled: storefront.importing
      }),

      !storefront.result && m('button', {
        disabled: !hasCredentials || storefront.importing,
        onclick: () => this.importLibrary(storefront)
      }, storefront.importing ? 'Importing...' : 'Import from RetroAchievements')
    ]);
  }
};
