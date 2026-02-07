import m from 'mithril';
import { Meteor } from 'meteor/meteor';
import { downloadCSV } from '../../components/import/importHelpers.js';

export const ExportTab = {
  oninit() {
    this.exporting = false;
    this.exportError = null;
  },

  async exportCollection() {
    this.exporting = true;
    this.exportError = null;
    m.redraw();

    try {
      const csvContent = await Meteor.callAsync('export.collection');
      downloadCSV(csvContent, 'backlog_beacon_export.csv');
    } catch (error) {
      this.exportError = error.reason || error.message || 'Export failed';
    }

    this.exporting = false;
    m.redraw();
  },

  view() {
    return m('div.export-section', [
      m('header', [
        m('h2', 'Export Collection'),
        m('p', 'Download your entire game collection as a CSV file. You can use this to backup your data or import it later.')
      ]),

      this.exportError && m('div.error-message', { role: 'alert' }, [
        m('strong', 'Error: '),
        this.exportError
      ]),

      m('button', {
        disabled: this.exporting,
        onclick: () => this.exportCollection()
      }, this.exporting ? 'Exporting...' : 'Download CSV Export')
    ]);
  }
};
