import m from 'mithril';
import { Meteor } from 'meteor/meteor';
import { RequireAuth } from '../components/RequireAuth.js';
import { STATUS_LABELS } from '../../lib/collections/collectionItems.js';

const StatisticsContent = {
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
      this.error = err.reason || err.message || 'Failed to load statistics';
    }
    
    this.loading = false;
    m.redraw();
  },
  
  view(vnode) {
    if (this.loading) {
      return m('div.statistics-page', [
        m('h1', 'Collection Statistics'),
        m('div.loading-container', [
          m('div.loading'),
          m('p', 'Loading statistics...')
        ])
      ]);
    }
    
    if (this.error) {
      return m('div.statistics-page', [
        m('h1', 'Collection Statistics'),
        m('p.error-message', this.error),
        m('button', { onclick: () => this.loadStats() }, 'Retry')
      ]);
    }
    
    const stats = this.stats;
    
    if (!stats || stats.total === 0) {
      return m('div.statistics-page', [
        m('h1', 'Collection Statistics'),
        m('div.empty-state', [
          m('h3', 'No statistics yet'),
          m('p', 'Add some games to your collection to see statistics.'),
          m('a.button', { href: '/browse', oncreate: m.route.link }, 'Browse Games')
        ])
      ]);
    }
    
    const completionRate = stats.total > 0 
      ? Math.round((stats.byStatus.completed / stats.total) * 100) 
      : 0;
    
    const sortedPlatforms = Object.entries(stats.platformCounts)
      .sort((a, b) => b[1] - a[1]);
    
    return m('div.statistics-page', [
      m('h1', 'Collection Statistics'),
      
      m('section.stats-overview', [
        m('h2', 'Overview'),
        m('div.stats-grid', [
          m('article.stat-card.highlight', [
            m('span.stat-value', stats.total),
            m('span.stat-label', 'Total Games')
          ]),
          m('article.stat-card', [
            m('span.stat-value', `${completionRate}%`),
            m('span.stat-label', 'Completion Rate')
          ]),
          m('article.stat-card', [
            m('span.stat-value', stats.totalHoursPlayed),
            m('span.stat-label', 'Hours Played')
          ]),
          m('article.stat-card', [
            m('span.stat-value', stats.averageRating ? `${stats.averageRating} ★` : 'N/A'),
            m('span.stat-label', 'Average Rating')
          ]),
          m('article.stat-card', [
            m('span.stat-value', stats.favorites),
            m('span.stat-label', 'Favorites')
          ])
        ])
      ]),
      
      m('section.stats-status', [
        m('h2', 'By Status'),
        m('div.status-bars', 
          Object.entries(stats.byStatus).map(([status, count]) => {
            const percentage = stats.total > 0 ? (count / stats.total) * 100 : 0;
            return m('div.status-bar-item', { key: status }, [
              m('div.status-bar-label', [
                m('span', STATUS_LABELS[status] || status),
                m('span', `${count} (${Math.round(percentage)}%)`)
              ]),
              m('div.status-bar-track', [
                m('div.status-bar-fill', {
                  class: status,
                  style: { width: `${percentage}%` }
                })
              ])
            ]);
          })
        )
      ]),
      
      sortedPlatforms.length > 0 && m('section.stats-platforms', [
        m('h2', 'By Platform'),
        m('div.platform-list',
          sortedPlatforms.slice(0, 10).map(([platform, count]) =>
            m('div.platform-item', { key: platform }, [
              m('span.platform-name', platform),
              m('span.platform-count', count)
            ])
          )
        ),
        sortedPlatforms.length > 10 && m('p', m('small', `And ${sortedPlatforms.length - 10} more platforms...`))
      ]),
      
      m('div.stats-actions', [
        m('button.outline', { onclick: () => this.loadStats() }, 'Refresh Statistics')
      ])
    ]);
  }
};

export const StatisticsPage = {
  view() {
    return m(RequireAuth, m(StatisticsContent));
  }
};
