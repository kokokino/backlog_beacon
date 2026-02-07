import m from 'mithril';
import { Meteor } from 'meteor/meteor';
import { clearProgressAfterDelay } from '../../../components/import/importHelpers.js';
import { ImportOptionsFieldset } from '../../../components/import/ImportOptionsFieldset.js';

export const SteamForm = {
  oninit() {
    this.username = '';
  },

  async preview(storefront) {
    if (!this.username.trim()) {
      return;
    }

    storefront.previewing = true;
    storefront.error = null;
    storefront.preview = null;
    storefront.result = null;
    m.redraw();

    try {
      storefront.preview = await Meteor.callAsync('import.previewStorefront', 'steam', this.username);
    } catch (error) {
      storefront.error = error.reason || error.message || 'Failed to preview library';
    }

    storefront.previewing = false;
    m.redraw();
  },

  async importLibrary(storefront) {
    if (!this.username.trim()) {
      return;
    }

    storefront.importing = true;
    storefront.error = null;
    storefront.result = null;
    m.redraw();

    try {
      storefront.result = await Meteor.callAsync('import.storefront', 'steam', this.username, storefront.options);
      this.username = '';
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

    return m('div.steam-form', [
      m('div.form-group', [
        m('label', { for: 'steam-username' }, 'Steam Profile URL'),
        m('input', {
          type: 'text',
          id: 'steam-username',
          placeholder: 'e.g., https://steamcommunity.com/profiles/71212121212121212',
          value: this.username,
          disabled: storefront.importing || storefront.previewing,
          oninput: (event) => { this.username = event.target.value; }
        }),
        m('small', 'Paste your Steam profile URL, or custom URL name.')
      ]),

      m('div.privacy-notice', [
        m('strong', 'Note: '),
        'Your Steam profile must be set to public for this to work. ',
        m('a', {
          href: 'https://help.steampowered.com/en/faqs/view/588C-C67D-0251-C276',
          target: '_blank',
          rel: 'noopener noreferrer'
        }, 'How to make your profile public')
      ]),

      m(ImportOptionsFieldset, {
        options: storefront.options,
        disabled: storefront.importing || storefront.previewing,
        showPlaytime: true,
        showLastPlayed: true
      }),

      !storefront.preview && !storefront.result && m('button', {
        disabled: !hasUsername || storefront.previewing || storefront.importing,
        onclick: () => this.preview(storefront)
      }, storefront.previewing ? 'Loading...' : 'Preview Library'),

      storefront.preview && !storefront.importing && !storefront.result && m('div.import-actions', { style: 'margin-top: 1rem;' }, [
        m('button', {
          disabled: storefront.importing || storefront.preview.total === 0,
          onclick: () => this.importLibrary(storefront)
        }, storefront.importing ? 'Importing...' : `Import ${storefront.preview.total} Games`)
      ])
    ]);
  }
};
