import m from 'mithril';
import { Meteor } from 'meteor/meteor';
import { Tracker } from 'meteor/tracker';
import { RequireAuth } from '../components/RequireAuth.js';
import { ImportProgress } from '../../lib/collections/importProgress.js';
import { ImportTabs, TABS } from './import/ImportTabs.js';
import { DarkadiaTab } from './import/DarkadiaTab.js';
import { BacklogBeaconTab } from './import/BacklogBeaconTab.js';
import { SimpleTab } from './import/SimpleTab.js';
import { StorefrontTab } from './import/StorefrontTab.js';
import { ExportTab } from './import/ExportTab.js';

const TAB_COMPONENTS = {
  [TABS.DARKADIA]: { component: DarkadiaTab, progressType: 'darkadia' },
  [TABS.BACKLOG_BEACON]: { component: BacklogBeaconTab, progressType: 'backlog' },
  [TABS.SIMPLE]: { component: SimpleTab, progressType: 'simple' },
  [TABS.STOREFRONT]: { component: StorefrontTab, progressType: 'storefront' },
  [TABS.EXPORT]: { component: ExportTab, progressType: 'export' }
};

const ImportContent = {
  oninit() {
    this.activeTab = TABS.DARKADIA;
    this.progress = {};
    this.progressSubscription = null;
    this.progressComputation = null;
  },

  oncreate() {
    this.progressSubscription = Meteor.subscribe('importProgress');

    this.progressComputation = Tracker.autorun(() => {
      this.progress = {
        darkadia: ImportProgress.findOne({ type: 'darkadia' }),
        backlog: ImportProgress.findOne({ type: 'backlog' }),
        simple: ImportProgress.findOne({ type: 'simple' }),
        storefront: ImportProgress.findOne({ type: 'storefront' }),
        export: ImportProgress.findOne({ type: 'export' })
      };
      m.redraw();
    });
  },

  onremove() {
    if (this.progressSubscription) {
      this.progressSubscription.stop();
    }
    if (this.progressComputation) {
      this.progressComputation.stop();
    }
  },

  setTab(tab) {
    this.activeTab = tab;
  },

  view() {
    const tabConfig = TAB_COMPONENTS[this.activeTab];
    const TabComponent = tabConfig.component;
    const progress = tabConfig.progressType ? this.progress[tabConfig.progressType] : null;

    return m('div.import-page', [
      m('h1', 'Import & Export'),

      m(ImportTabs, {
        activeTab: this.activeTab,
        onTabChange: (tab) => this.setTab(tab)
      }),

      m('article.import-content', [
        m(TabComponent, { key: this.activeTab, progress })
      ])
    ]);
  }
};

export const ImportPage = {
  view() {
    return m(RequireAuth, m(ImportContent));
  }
};
