import m from 'mithril';
import { Meteor } from 'meteor/meteor';
import { Tracker } from 'meteor/tracker';
import { RequireAuth } from '../components/RequireAuth.js';
import { GameCard } from '../components/GameCard.js';
import { EditItemModal } from '../components/EditItemModal.js';
import { CollectionFilters } from '../components/CollectionFilters.js';
import { CollectionItems } from '../../lib/collections/collectionItems.js';
import { Games } from '../../lib/collections/games.js';

const CollectionContent = {
  oninit(vnode) {
    this.items = [];
    this.games = {};
    this.platforms = [];
    this.filters = {
      status: null,
      platform: null,
      favorite: null,
      search: ''
    };
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

  setupSubscriptions() {
    if (this.subscription) {
      this.subscription.stop();
    }
    if (this.computation) {
      this.computation.stop();
    }

    this.loading = true;
    m.redraw();

    // Build options with all filters including search
    const options = {};
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
        const items = CollectionItems.find(
          { gameName: { $exists: true } },
          { sort: { gameName: 1 } }
        ).fetch();
        this.items = items;

        // Build games lookup from only the games that were published
        const gameIds = items.map(item => item.gameId).filter(Boolean);
        const games = Games.find({ _id: { $in: gameIds } }).fetch();
        this.games = {};
        games.forEach(game => {
          this.games[game._id] = game;
        });

        this.loading = false;
        m.redraw();
      }
    });
  },

  handleFilterChange(newFilters) {
    const searchChanged = newFilters.search !== this.filters.search;
    this.filters = newFilters;

    // Debounce search to avoid excessive subscriptions while typing
    if (searchChanged && newFilters.search) {
      if (this.searchDebounceTimer) {
        clearTimeout(this.searchDebounceTimer);
      }
      this.searchDebounceTimer = setTimeout(() => {
        this.setupSubscriptions();
      }, 300);
    } else {
      // Non-search filters apply immediately
      if (this.searchDebounceTimer) {
        clearTimeout(this.searchDebounceTimer);
      }
      this.setupSubscriptions();
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
      search: ''
    };
    this.setupSubscriptions();
  },
  
  async handleRemoveItem(itemId) {
    try {
      await Meteor.callAsync('collection.removeItem', itemId);
    } catch (err) {
      alert(err.reason || err.message || 'Failed to remove item');
    }
  },
  
  view(vnode) {
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
      
      !this.loading && this.items.length === 0 && m('div.empty-state', [
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
      
      !this.loading && this.items.length > 0 && m('p.results-count', [
        m('small', `Showing ${this.items.length} games`)
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
