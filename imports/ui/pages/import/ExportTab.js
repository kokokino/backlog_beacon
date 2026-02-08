import m from 'mithril';
import { Meteor } from 'meteor/meteor';
import { downloadCSV, clearProgressAfterDelay } from '../../components/import/importHelpers.js';

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
      clearProgressAfterDelay('import.clearProgress', 'export');
    } catch (error) {
      this.exportError = error.reason || error.message || 'Export failed';
    }

    this.exporting = false;
    m.redraw();
  },

  view(vnode) {
    const { progress } = vnode.attrs;

    return m('div.export-section', [
      m('header', [
        m('h2', 'Export Collection'),
        m('p', 'Download your entire game collection as a CSV file. You can use this to backup your data or import it later.')
      ]),

      progress && progress.status === 'processing' && m('div.import-progress', [
        m('h3', 'Export Progress'),
        m('p', `Processing ${progress.current || 0} of ${progress.total || 0} games`),
        m('progress', { value: progress.current || 0, max: progress.total || 100 })
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
