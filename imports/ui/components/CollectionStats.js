import m from 'mithril';
import { Meteor } from 'meteor/meteor';

export const CollectionStats = {
  oninit(vnode) {
    this.stats = null;
    this.loading = true;
    this.error = null;
    this.loadStats();
  },
  
  async loadStats() {
    this.loading = true;
    this.error = null;
    m.redraw();
    
    try {
      this.stats = await Meteor.callAsync('collection.getStats');
    } catch (err) {
      this.error = err.reason || err.message || 'Failed to load stats';
    }
    
    this.loading = false;
    m.redraw();
  },
  
  view(vnode) {
    if (this.loading) {
      return m('div.collection-stats', m('p', 'Loading stats...'));
    }
    
    if (this.error) {
      return m('div.collection-stats', m('p.error-message', this.error));
    }
    
    if (!this.stats) {
      return null;
    }
    
    const stats = this.stats;
    
    return m('div.collection-stats', [
      m('div.stats-grid', [
        m('div.stat-card', [
          m('span.stat-value', stats.total),
          m('span.stat-label', 'Total Games')
        ]),
        m('div.stat-card', [
          m('span.stat-value', stats.byStatus.completed),
          m('span.stat-label', 'Completed')
        ]),
        m('div.stat-card', [
          m('span.stat-value', stats.byStatus.playing),
          m('span.stat-label', 'Playing')
        ]),
        m('div.stat-card', [
          m('span.stat-value', stats.byStatus.backlog),
          m('span.stat-label', 'Backlog')
        ]),
        m('div.stat-card', [
          m('span.stat-value', stats.totalHoursPlayed),
          m('span.stat-label', 'Hours Played')
        ]),
        stats.averageRating && m('div.stat-card', [
          m('span.stat-value', `${stats.averageRating} ★`),
          m('span.stat-label', 'Avg Rating')
        ])
      ])
    ]);
  }
};
