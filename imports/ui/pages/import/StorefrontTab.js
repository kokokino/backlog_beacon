import m from 'mithril';
import { formatDate } from '../../components/import/importHelpers.js';
import { ImportProgress } from '../../components/import/ImportProgress.js';
import { ImportResults } from '../../components/import/ImportResults.js';
import { SteamForm } from './storefronts/SteamForm.js';
import { GogForm } from './storefronts/GogForm.js';
import { EpicForm } from './storefronts/EpicForm.js';
import { AmazonForm } from './storefronts/AmazonForm.js';
import { OculusForm } from './storefronts/OculusForm.js';
import { EaForm } from './storefronts/EaForm.js';
import { UbisoftForm } from './storefronts/UbisoftForm.js';
import { XboxForm } from './storefronts/XboxForm.js';
import { PsnForm } from './storefronts/PsnForm.js';

const STOREFRONT_FORMS = {
  steam: SteamForm,
  gog: GogForm,
  epic: EpicForm,
  amazon: AmazonForm,
  oculus: OculusForm,
  ea: EaForm,
  ubisoft: UbisoftForm,
  xbox: XboxForm,
  psn: PsnForm
};

export const StorefrontTab = {
  oninit() {
    this.storefrontType = null;
    this.importing = false;
    this.previewing = false;
    this.preview = null;
    this.result = null;
    this.error = null;
    this.options = {
      updateExisting: true,
      importPlaytime: true,
      importLastPlayed: true
    };
  },

  selectStorefront(type) {
    this.storefrontType = type;
    this.preview = null;
    this.result = null;
    this.error = null;
  },

  view(vnode) {
    const { progress } = vnode.attrs;
    const FormComponent = this.storefrontType ? STOREFRONT_FORMS[this.storefrontType] : null;

    return m('div.storefront-import', [
      m('header', [
        m('h2', 'Import from Storefront'),
        m('p', 'Import your game library directly from digital storefronts like Steam.')
      ]),

      m('div.form-group', [
        m('label', { for: 'storefront-select' }, 'Select Storefront'),
        m('select', {
          id: 'storefront-select',
          value: this.storefrontType || '',
          disabled: this.importing || this.previewing,
          onchange: (event) => this.selectStorefront(event.target.value || null)
        }, [
          m('option', { value: '' }, '-- Select a storefront --'),
          m('option', { value: 'steam' }, 'Steam'),
          m('option', { value: 'gog' }, 'GOG'),
          m('option', { value: 'epic' }, 'Epic Games Store'),
          m('option', { value: 'amazon' }, 'Amazon Games'),
          m('option', { value: 'oculus' }, 'Oculus / Meta Quest'),
          m('option', { value: 'ea' }, 'EA App'),
          m('option', { value: 'ubisoft' }, 'Ubisoft Connect'),
          m('option', { value: 'xbox' }, 'Xbox / Microsoft Store'),
          m('option', { value: 'psn' }, 'PlayStation')
        ])
      ]),

      FormComponent && m(FormComponent, { storefront: this }),

      m(ImportProgress, { progress, importing: this.importing }),

      this.error && m('div.error-message', { role: 'alert' }, [
        m('strong', 'Error: '),
        this.error
      ]),

      this.preview && !this.importing && m('div.import-preview', [
        m('h3', `Preview (${this.preview.total} games found)`),
        m('p', `Showing first ${this.preview.games.length} games (sorted by playtime):`),
        m('table', { role: 'grid' }, [
          m('thead', [
            m('tr', [
              m('th', 'Name'),
              m('th', 'Hours Played'),
              m('th', 'Last Played')
            ])
          ]),
          m('tbody', [
            this.preview.games.map((game, index) =>
              m('tr', { key: index }, [
                m('td', game.name),
                m('td', game.hoursPlayed !== null ? `${game.hoursPlayed}h` : '-'),
                m('td', formatDate(game.lastPlayed))
              ])
            )
          ])
        ])
      ]),

      m(ImportResults, { result: this.result })
    ]);
  }
};
