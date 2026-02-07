import m from 'mithril';
import { Meteor } from 'meteor/meteor';
import { readFile, clearProgressAfterDelay } from '../../components/import/importHelpers.js';
import { ImportProgress } from '../../components/import/ImportProgress.js';
import { ImportResults } from '../../components/import/ImportResults.js';
import { ImportOptionsFieldset } from '../../components/import/ImportOptionsFieldset.js';

export const DarkadiaTab = {
  oninit() {
    this.file = null;
    this.preview = null;
    this.importing = false;
    this.result = null;
    this.error = null;
    this.options = {
      updateExisting: true
    };
  },

  handleFileSelect(event) {
    const file = event.target.files[0];
    if (file) {
      this.file = file;
      this.preview = null;
      this.result = null;
      this.error = null;
      this.previewFile();
    }
  },

  async previewFile() {
    if (!this.file) {
      return;
    }

    try {
      const content = await readFile(this.file);
      this.preview = await Meteor.callAsync('import.previewDarkadia', content);
      m.redraw();
    } catch (error) {
      this.error = error.reason || error.message || 'Failed to preview file';
      m.redraw();
    }
  },

  async importFile() {
    if (!this.file) {
      return;
    }

    this.importing = true;
    this.error = null;
    this.result = null;
    m.redraw();

    try {
      const content = await readFile(this.file);
      this.result = await Meteor.callAsync('import.darkadia', content, this.options);
      this.file = null;
      this.preview = null;
      clearProgressAfterDelay('import.clearProgress');
    } catch (error) {
      this.error = error.reason || error.message || 'Import failed';
    }

    this.importing = false;
    m.redraw();
  },

  view(vnode) {
    const { progress } = vnode.attrs;

    return m('div.darkadia-import', [
      m('header', [
        m('h2', 'Import from Darkadia'),
        m('p', 'Import your game collection from a Darkadia CSV export file.')
      ]),

      m('div.form-group', [
        m('label', { for: 'darkadia-file' }, 'Select CSV File'),
        m('input', {
          type: 'file',
          id: 'darkadia-file',
          accept: '.csv',
          disabled: this.importing,
          onchange: (event) => this.handleFileSelect(event)
        })
      ]),

      m(ImportOptionsFieldset, {
        options: this.options,
        disabled: this.importing,
        updateExistingLabel: ' Update existing games instead of skipping. Overwrites edits (notes, rating, status, etc.)'
      }),

      m(ImportProgress, { progress, importing: this.importing, showCheckmark: true }),

      this.preview && !this.importing && m('div.import-preview', [
        m('h3', `Preview (${this.preview.total} games found)`),
        m('p', `Showing first ${this.preview.games.length} games:`),
        m('table', { role: 'grid' }, [
          m('thead', [
            m('tr', [
              m('th', 'Name'),
              m('th', 'Platforms'),
              m('th', 'Status'),
              m('th', 'Favorite')
            ])
          ]),
          m('tbody', [
            this.preview.games.map((game, index) =>
              m('tr', { key: index }, [
                m('td', game.name),
                m('td', game.platforms.join(', ') || '-'),
                m('td', game.status),
                m('td', game.favorite ? '★' : '-')
              ])
            )
          ])
        ])
      ]),

      this.error && m('div.error-message', { role: 'alert' }, [
        m('strong', 'Error: '),
        this.error
      ]),

      m(ImportResults, { result: this.result }),

      m('button', {
        disabled: !this.file || this.importing,
        onclick: () => this.importFile()
      }, this.importing ? 'Importing...' : 'Import')
    ]);
  }
};
