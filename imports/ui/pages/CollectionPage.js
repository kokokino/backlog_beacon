import m from 'mithril';
import { Meteor } from 'meteor/meteor';
import { Tracker } from 'meteor/tracker';
import { RequireAuth } from '../components/RequireAuth.js';
import { GameCard } from '../components/GameCard.js';
import { EditItemModal } from '../components/EditItemModal.js';
import { CollectionFilters } from '../components/CollectionFilters.js';
import { CollectionItems } from '../../lib/collections/collectionItems.js';
import { Games } from '../../lib/collections/games.js';

const PAGE_SIZE = 24;

const CollectionContent = {
  oninit(vnode) {
    this.items = [];
    this.games = {};
    this.platforms = [];
    this.filters = {
      status: null,
      platform: null,
      favorite: null,
      search: '',
      sort: 'name-asc'
    };
    this.currentPage = 1;
    this.totalCount = 0;
    this.loading = true;
    this.editingItem = null;
    this.subscription = null;
    this.platformsSubscription = null;
    this.computation = null;
    this.searchDebounceTimer = null;
  },

  oncreate(vnode) {
    this.setupSubscriptions();
    this.setupPlatformsSubscription();
    this.fetchTotalCount();
  },

  onremove(vnode) {
    if (this.subscription) {
      this.subscription.stop();
    }
    if (this.platformsSubscription) {
      this.platformsSubscription.stop();
    }
    if (this.computation) {
      this.computation.stop();
    }
    if (this.searchDebounceTimer) {
      clearTimeout(this.searchDebounceTimer);
    }
  },

  setupPlatformsSubscription() {
    // Separate lightweight subscription just for platform filter options
    this.platformsSubscription = Meteor.subscribe('collectionPlatforms');
    Tracker.autorun(() => {
      if (this.platformsSubscription.ready()) {
        const platformSet = new Set();
        CollectionItems.find({}, { fields: { platforms: 1, platform: 1 } }).forEach(item => {
          if (item.platform) {
            platformSet.add(item.platform);
          }
          if (item.platforms) {
            item.platforms.forEach(platform => platformSet.add(platform));
          }
        });
        this.platforms = Array.from(platformSet).sort();
        m.redraw();
      }
    });
  },

  async fetchTotalCount() {
    const countFilters = {};
    if (this.filters.status) {
      countFilters.status = this.filters.status;
    }
    if (this.filters.platform) {
      countFilters.platform = this.filters.platform;
    }
    if (this.filters.favorite) {
      countFilters.favorite = true;
    }
    if (this.filters.search && this.filters.search.trim()) {
      countFilters.search = this.filters.search.trim();
    }

    try {
      const count = await Meteor.callAsync('collection.getCount', countFilters);
      this.totalCount = count;
      m.redraw();
    } catch (error) {
      console.error('Failed to fetch count:', error);
      this.totalCount = 0;
    }
  },

  setupSubscriptions() {
    if (this.subscription) {
      this.subscription.stop();
    }
    if (this.computation) {
      this.computation.stop();
    }

    this.loading = true;
    m.redraw();

    // Capture current sort value for use in the autorun closure
    const currentSort = this.filters.sort || 'name-asc';
    const sortField = currentSort.startsWith('date') ? 'dateAdded' : 'gameName';
    const sortDirection = currentSort.endsWith('desc') ? -1 : 1;

    // Build options with all filters including search, sort, and pagination
    const options = {
      sort: currentSort,
      limit: PAGE_SIZE,
      skip: (this.currentPage - 1) * PAGE_SIZE
    };
    if (this.filters.status) {
      options.status = this.filters.status;
    }
    if (this.filters.platform) {
      options.platform = this.filters.platform;
    }
    if (this.filters.favorite) {
      options.favorite = true;
    }
    if (this.filters.search && this.filters.search.trim()) {
      options.search = this.filters.search.trim();
    }

    // Use unified publication that returns both items AND their games
    this.subscription = Meteor.subscribe('userCollectionWithGames', options);

    this.computation = Tracker.autorun(() => {
      const ready = this.subscription.ready();

      if (ready) {
        // Query items that have gameName field - this filters out partial docs
        // from collectionPlatforms subscription which only has platforms field
        let items = CollectionItems.find(
          { gameName: { $exists: true } }
        ).fetch();

        // Build games lookup first (needed for name sorting)
        const gameIds = items.map(item => item.gameId).filter(Boolean);
        const games = Games.find({ _id: { $in: gameIds } }).fetch();
        this.games = {};
        games.forEach(game => {
          this.games[game._id] = game;
        });

        // Sort client-side
        if (sortField === 'gameName') {
          // Sort by game.title first, then game.name (case-insensitive)
          items.sort((a, b) => {
            const gameA = this.games[a.gameId] || {};
            const gameB = this.games[b.gameId] || {};
            const titleA = (gameA.title || gameA.name || a.gameName || '').toLowerCase();
            const titleB = (gameB.title || gameB.name || b.gameName || '').toLowerCase();
            if (titleA < titleB) {
              return sortDirection === 1 ? -1 : 1;
            }
            if (titleA > titleB) {
              return sortDirection === 1 ? 1 : -1;
            }
            // Secondary sort by name if titles are equal
            const nameA = (gameA.name || '').toLowerCase();
            const nameB = (gameB.name || '').toLowerCase();
            if (nameA < nameB) {
              return sortDirection === 1 ? -1 : 1;
            }
            if (nameA > nameB) {
              return sortDirection === 1 ? 1 : -1;
            }
            return 0;
          });
        } else {
          // Date sort - use regular comparison
          items.sort((a, b) => {
            const valA = a[sortField] || 0;
            const valB = b[sortField] || 0;
            return sortDirection === 1 ? valA - valB : valB - valA;
          });
        }

        this.items = items;

        this.loading = false;
        m.redraw();
      }
    });
  },

  handleFilterChange(newFilters) {
    const searchChanged = newFilters.search !== this.filters.search;
    const filtersChanged = newFilters.status !== this.filters.status ||
                          newFilters.platform !== this.filters.platform ||
                          newFilters.favorite !== this.filters.favorite;
    this.filters = newFilters;

    // Reset to page 1 when filters change (except sort)
    if (searchChanged || filtersChanged) {
      this.currentPage = 1;
    }

    // Debounce search to avoid excessive subscriptions while typing
    if (searchChanged && newFilters.search) {
      if (this.searchDebounceTimer) {
        clearTimeout(this.searchDebounceTimer);
      }
      this.searchDebounceTimer = setTimeout(() => {
        this.setupSubscriptions();
        this.fetchTotalCount();
      }, 300);
    } else {
      // Non-search filters apply immediately
      if (this.searchDebounceTimer) {
        clearTimeout(this.searchDebounceTimer);
      }
      this.setupSubscriptions();
      // Fetch new count when filters change
      if (filtersChanged || searchChanged) {
        this.fetchTotalCount();
      }
    }
  },

  handleClearFilters() {
    if (this.searchDebounceTimer) {
      clearTimeout(this.searchDebounceTimer);
    }
    this.filters = {
      status: null,
      platform: null,
      favorite: null,
      search: '',
      sort: 'name-asc'
    };
    this.currentPage = 1;
    this.setupSubscriptions();
    this.fetchTotalCount();
  },

  goToPage(page) {
    const maxPages = Math.ceil(this.totalCount / PAGE_SIZE) || 1;
    if (page < 1 || page > maxPages) {
      return;
    }
    this.currentPage = page;
    this.setupSubscriptions();
  },

  async handleRemoveItem(itemId) {
    try {
      await Meteor.callAsync('collection.removeItem', itemId);
      this.setupSubscriptions();
      this.fetchTotalCount();
    } catch (err) {
      alert(err.reason || err.message || 'Failed to remove item');
    }
  },

  view(vnode) {
    const hasActiveFilters = this.filters.status || this.filters.platform ||
                             this.filters.favorite || this.filters.search;
    const maxPages = Math.ceil(this.totalCount / PAGE_SIZE) || 1;
    const startIndex = this.totalCount > 0 ? ((this.currentPage - 1) * PAGE_SIZE) + 1 : 0;
    const endIndex = Math.min(this.currentPage * PAGE_SIZE, this.totalCount);

    return m('div.collection-page', [
      m('header.page-header', [
        m('h1', 'My Collection'),
        m('a.button.outline', { href: '/browse', oncreate: m.route.link }, 'Add Games')
      ]),

      m(CollectionFilters, {
        filters: this.filters,
        platforms: this.platforms,
        onFilterChange: (newFilters) => this.handleFilterChange(newFilters),
        onClearFilters: () => this.handleClearFilters()
      }),

      this.loading && m('div.loading-container', [
        m('div.loading'),
        m('p', 'Loading your collection...')
      ]),

      // No results due to filters
      !this.loading && this.items.length === 0 && hasActiveFilters && m('div.empty-state', [
        m('h3', 'No games match your filters'),
        m('p', 'Try adjusting your search or filter criteria.'),
        m('button', { onclick: () => this.handleClearFilters() }, 'Clear Filters'), 
        m('p', 'Or browse games to add them to your collection.'),
        m('a.button', { href: '/browse', oncreate: m.route.link }, 'Browse Games')
      ]),

      // Truly empty collection
      !this.loading && this.items.length === 0 && !hasActiveFilters && m('div.empty-state', [
        m('h3', 'No games in your collection'),
        m('p', 'Start by browsing games and adding them to your collection.'),
        m('a.button', { href: '/browse', oncreate: m.route.link }, 'Browse Games')
      ]),

      !this.loading && this.items.length > 0 && m('div.collection-grid',
        this.items.map(item =>
          m(GameCard, {
            key: item._id,
            game: this.games[item.gameId],
            collectionItem: item,
            onUpdateItem: (collectionItem) => { this.editingItem = collectionItem; },
            onRemoveItem: (id) => this.handleRemoveItem(id)
          })
        )
      ),

      !this.loading && this.totalCount > 0 && m('div.pagination-row', [
        m('span.results-info', `Showing ${startIndex}-${endIndex} of ${this.totalCount.toLocaleString()} games`),
        this.totalCount > PAGE_SIZE && m('div.pagination-buttons', [
          m('button.outline.small', {
            disabled: this.currentPage === 1,
            onclick: () => this.goToPage(this.currentPage - 1)
          }, 'Previous'),
          m('span.page-indicator', `Page ${this.currentPage} of ${maxPages}`),
          m('button.outline.small', {
            disabled: this.currentPage >= maxPages,
            onclick: () => this.goToPage(this.currentPage + 1)
          }, 'Next')
        ])
      ]),

      this.editingItem && m(EditItemModal, {
        item: this.editingItem,
        game: this.games[this.editingItem.gameId],
        onClose: () => { this.editingItem = null; },
        onSuccess: () => { this.editingItem = null; }
      })
    ]);
  }
};

export const CollectionPage = {
  view() {
    return m(RequireAuth, m(CollectionContent));
  }
};
