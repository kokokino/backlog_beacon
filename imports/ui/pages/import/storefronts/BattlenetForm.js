import m from 'mithril';
import { Meteor } from 'meteor/meteor';
import { clearProgressAfterDelay } from '../../../components/import/importHelpers.js';
import { ImportOptionsFieldset } from '../../../components/import/ImportOptionsFieldset.js';
import { AuthStatus } from '../../../components/import/AuthStatus.js';
import { SecurityNotice } from '../../../components/import/SecurityNotice.js';

export const BattlenetForm = {
  oninit() {
    this.gamesJson = null;
    this.classicGamesJson = null;
  },

  clearAuth(storefront) {
    this.gamesJson = null;
    this.classicGamesJson = null;
    storefront.result = null;
    storefront.error = null;
    m.redraw();
  },

  async importLibrary(storefront) {
    if (!this.gamesJson) {
      storefront.error = 'Please paste your game library JSON data.';
      m.redraw();
      return;
    }

    storefront.importing = true;
    storefront.error = null;
    storefront.result = null;
    m.redraw();

    try {
      storefront.result = await Meteor.callAsync('import.battlenet', this.gamesJson, this.classicGamesJson || null, {
        updateExisting: storefront.options.updateExisting
      });
      this.gamesJson = null;
      this.classicGamesJson = null;
      clearProgressAfterDelay('import.clearStorefrontProgress');
    } catch (error) {
      storefront.error = error.reason || error.message || 'Import failed';
    }

    storefront.importing = false;
    m.redraw();
  },

  view(vnode) {
    const { storefront } = vnode.attrs;
    const hasData = !!this.gamesJson;

    return m('div.battlenet-form', [
      m('div.battlenet-instructions', { style: 'margin-bottom: 1rem;' }, [
        m('h4', 'How to get your game library data:'),
        m('ol', { style: 'margin: 0.5rem 0; padding-left: 1.5rem;' }, [
          m('li', [
            'Log in to your Battle.net account at ',
            m('a', {
              href: 'https://account.battle.net',
              target: '_blank',
              rel: 'noopener noreferrer'
            }, 'account.battle.net')
          ]),
          m('li', [
            'Open ',
            m('a', {
              href: 'https://account.battle.net/api/games-and-subs',
              target: '_blank',
              rel: 'noopener noreferrer'
            }, 'this link'),
            ' — it will show JSON data with your games. Select all and copy it.'
          ]),
          m('li', 'Paste the JSON into the text box below.'),
          m('li', [
            '(Optional) For classic games, also open ',
            m('a', {
              href: 'https://account.battle.net/api/classic-games',
              target: '_blank',
              rel: 'noopener noreferrer'
            }, 'this link'),
            ' and paste that JSON into the second text box.'
          ])
        ]),
        m('small', { style: 'color: var(--muted-color);' },
          'If the links show an error or login page, make sure you are logged in at account.battle.net first.'
        )
      ]),

      m('div.form-group', [
        m('label', { for: 'battlenet-games' }, 'Games & Subscriptions JSON'),
        m('textarea', {
          id: 'battlenet-games',
          rows: 4,
          placeholder: 'Paste JSON from /api/games-and-subs here...',
          value: this.gamesJson || '',
          disabled: storefront.importing,
          oninput: (event) => { this.gamesJson = event.target.value.trim() || null; }
        })
      ]),

      m('div.form-group', [
        m('label', { for: 'battlenet-classic' }, [
          'Classic Games JSON ',
          m('small', { style: 'color: var(--muted-color);' }, '(optional)')
        ]),
        m('textarea', {
          id: 'battlenet-classic',
          rows: 3,
          placeholder: 'Paste JSON from /api/classic-games here...',
          value: this.classicGamesJson || '',
          disabled: storefront.importing,
          oninput: (event) => { this.classicGamesJson = event.target.value.trim() || null; }
        })
      ]),

      hasData && m(AuthStatus, {
        label: 'Game library data provided',
        onClear: () => this.clearAuth(storefront)
      }),

      m(SecurityNotice, { credentialName: 'game library data' }),

      m(ImportOptionsFieldset, {
        options: storefront.options,
        disabled: storefront.importing,
        showPlaytime: false
      }),

      !storefront.result && m('button', {
        disabled: !hasData || storefront.importing,
        onclick: () => this.importLibrary(storefront)
      }, storefront.importing ? 'Importing...' : 'Import from Battle.net')
    ]);
  }
};
