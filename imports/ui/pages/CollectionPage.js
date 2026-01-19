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
    this.gamesSubscription = null;
    this.computation = null;
  },
  
  oncreate(vnode) {
    this.setupSubscriptions();
  },
  
  onremove(vnode) {
    if (this.subscription) {
      this.subscription.stop();
    }
    if (this.gamesSubscription) {
      this.gamesSubscription.stop();
    }
    if (this.computation) {
      this.computation.stop();
    }
  },
  
  setupSubscriptions() {
    if (this.subscription) {
      this.subscription.stop();
    }
    if (this.gamesSubscription) {
      this.gamesSubscription.stop();
    }
    if (this.computation) {
      this.computation.stop();
    }
    
    this.loading = true;
    m.redraw();
    
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
    
    this.subscription = Meteor.subscribe('userCollection', options);
    this.gamesSubscription = Meteor.subscribe('collectionGames');
    
    this.computation = Tracker.autorun(() => {
      const ready = this.subscription.ready() && this.gamesSubscription.ready();
      
      if (ready) {
        let items = CollectionItems.find({}, { sort: { dateAdded: -1 } }).fetch();
        
        if (this.filters.search) {
          const gameIds = Games.find({
            title: { $regex: this.filters.search, $options: 'i' }
          }).fetch().map(game => game._id);
          items = items.filter(item => gameIds.includes(item.gameId));
        }
        
        this.items = items;
        
        const allGames = Games.find({}).fetch();
        this.games = {};
        allGames.forEach(game => {
          this.games[game._id] = game;
        });
        
        const platformSet = new Set();
        items.forEach(item => {
          if (item.platform) {
            platformSet.add(item.platform);
          }
        });
        this.platforms = Array.from(platformSet).sort();
        
        this.loading = false;
        m.redraw();
      }
    });
  },
  
  handleFilterChange(newFilters) {
    this.filters = newFilters;
    this.setupSubscriptions();
  },
  
  handleClearFilters() {
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
