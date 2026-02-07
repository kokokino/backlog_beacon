import m from 'mithril';
import { Meteor } from 'meteor/meteor';
import { getStorefronts } from '../../../lib/constants/storefronts.js';
import { clearProgressAfterDelay } from '../../components/import/importHelpers.js';
import { ImportProgress } from '../../components/import/ImportProgress.js';
import { ImportResults } from '../../components/import/ImportResults.js';
import { ImportOptionsFieldset } from '../../components/import/ImportOptionsFieldset.js';

export const SimpleTab = {
  oninit() {
    this.games = [{ name: '', storefront: '', platform: '' }];
    this.importing = false;
    this.result = null;
    this.error = null;
    this.bulkText = '';
    this.inputMode = 'form';
    this.options = {
      updateExisting: true
    };
    this.storefronts = [];
    this.loadStorefronts();
  },

  async loadStorefronts() {
    try {
      this.storefronts = getStorefronts();
      m.redraw();
    } catch (error) {
      console.error('Failed to load storefronts:', error);
    }
  },

  addGame() {
    this.games.push({ name: '', storefront: '', platform: '' });
  },

  removeGame(index) {
    if (this.games.length > 1) {
      this.games.splice(index, 1);
    }
  },

  updateGame(index, field, value) {
    this.games[index][field] = value;
  },

  parseBulkText() {
    const lines = this.bulkText.split('\n').filter(line => line.trim());
    const games = [];

    for (const line of lines) {
      const parts = line.split('\t').length > 1 ? line.split('\t') : line.split(',');
      const name = (parts[0] || '').trim();
      const storefront = (parts[1] || '').trim();
      const platform = (parts[2] || '').trim();

      if (name) {
        games.push({ name, storefront, platform });
      }
    }

    if (games.length > 0) {
      this.games = games;
      this.inputMode = 'form';
    }
  },

  getValidGames() {
    return this.games.filter(game => game.name.trim() !== '');
  },

  async importGames() {
    const games = this.getValidGames();

    if (games.length === 0) {
      this.error = 'Please enter at least one game name';
      return;
    }

    this.importing = true;
    this.error = null;
    this.result = null;
    m.redraw();

    try {
      this.result = await Meteor.callAsync('import.simple', games, this.options);
      this.games = [{ name: '', storefront: '', platform: '' }];
      this.bulkText = '';
      clearProgressAfterDelay('import.clearProgress', 'simple');
    } catch (error) {
      this.error = error.reason || error.message || 'Import failed';
    }

    this.importing = false;
    m.redraw();
  },

  renderForm() {
    return m('div.simple-form', [
      m('table', { role: 'grid' }, [
        m('thead', [
          m('tr', [
            m('th', 'Game Name *'),
            m('th', 'Storefront'),
            m('th', 'Platform'),
            m('th', '')
          ])
        ]),
        m('tbody', [
          this.games.map((game, index) =>
            m('tr', { key: index }, [
              m('td', [
                m('input', {
                  type: 'text',
                  placeholder: 'Enter game name',
                  value: game.name,
                  oninput: (event) => this.updateGame(index, 'name', event.target.value)
                })
              ]),
              m('td', [
                m('select', {
                  value: game.storefront,
                  onchange: (event) => this.updateGame(index, 'storefront', event.target.value)
                }, [
                  m('option', { value: '' }, '-- Select --'),
                  this.storefronts.map(storefront =>
                    m('option', { key: storefront.id, value: storefront.name }, storefront.name)
                  )
                ])
              ]),
              m('td', [
                m('input', {
                  type: 'text',
                  placeholder: 'e.g., PC, PS5',
                  value: game.platform,
                  oninput: (event) => this.updateGame(index, 'platform', event.target.value)
                })
              ]),
              m('td', [
                m('button', {
                  class: 'outline secondary',
                  disabled: this.games.length <= 1,
                  onclick: () => this.removeGame(index),
                  title: 'Remove row'
                }, '×')
              ])
            ])
          )
        ])
      ]),

      m('button', {
        class: 'outline',
        onclick: () => this.addGame()
      }, '+ Add Another Game')
    ]);
  },

  renderBulk() {
    return m('div.simple-bulk', [
      m('p', 'Paste a list of games, one per line. Use tabs or commas to separate columns:'),
      m('p', m('code', 'Game Name, Storefront, Platform')),

      m('textarea', {
        rows: 10,
        placeholder: 'The Legend of Zelda, Nintendo eShop, Switch\nHalf-Life 2, Steam, PC\nFinal Fantasy VII',
        value: this.bulkText,
        oninput: (event) => {
          this.bulkText = event.target.value;
        }
      }),

      m('button', {
        class: 'outline',
        disabled: !this.bulkText.trim(),
        onclick: () => this.parseBulkText()
      }, 'Parse and Review')
    ]);
  },

  view(vnode) {
    const { progress } = vnode.attrs;
    const validGames = this.getValidGames();

    return m('div.simple-import', [
      m('header', [
        m('h2', 'Simple Import'),
        m('p', 'Quickly add games by entering their names. Optionally specify storefront and platform.')
      ]),

      m('div.input-mode-toggle', [
        m('button', {
          class: this.inputMode === 'form' ? 'secondary' : 'outline',
          onclick: () => {
            this.inputMode = 'form';
          }
        }, 'Form Input'),
        m('button', {
          class: this.inputMode === 'bulk' ? 'secondary' : 'outline',
          onclick: () => {
            this.inputMode = 'bulk';
          }
        }, 'Bulk Paste')
      ]),

      m(ImportOptionsFieldset, {
        options: this.options,
        disabled: this.importing,
        updateExistingLabel: ' Update existing games (merge platforms and storefronts)'
      }),

      this.inputMode === 'form' ? this.renderForm() : this.renderBulk(),

      m(ImportProgress, { progress, importing: this.importing }),

      this.error && m('div.error-message', { role: 'alert' }, [
        m('strong', 'Error: '),
        this.error
      ]),

      m(ImportResults, { result: this.result }),

      m('button', {
        disabled: validGames.length === 0 || this.importing,
        onclick: () => this.importGames()
      }, this.importing ? 'Importing...' : `Import ${validGames.length} Game${validGames.length !== 1 ? 's' : ''}`)
    ]);
  }
};
