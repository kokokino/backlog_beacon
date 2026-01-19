import m from 'mithril';
import { Meteor } from 'meteor/meteor';
import { Tracker } from 'meteor/tracker';
import { RequireAuth } from '../components/RequireAuth.js';
import { GameCard } from '../components/GameCard.js';
import { AddGameModal } from '../components/AddGameModal.js';
import { Games } from '../../lib/collections/games.js';
import { CollectionItems } from '../../lib/collections/collectionItems.js';

const BrowseContent = {
  oninit(vnode) {
    this.games = [];
    this.collectionGameIds = new Set();
    this.searchQuery = '';
    this.loading = true;
    this.addingGame = null;
    this.subscription = null;
    this.collectionSub = null;
    this.computation = null;
    this.searchTimeout = null;
  },
  
  oncreate(vnode) {
    this.setupSubscriptions();
  },
  
  onremove(vnode) {
    if (this.subscription) {
      this.subscription.stop();
    }
    if (this.collectionSub) {
      this.collectionSub.stop();
    }
    if (this.computation) {
      this.computation.stop();
    }
    if (this.searchTimeout) {
      clearTimeout(this.searchTimeout);
    }
  },
  
  setupSubscriptions() {
    if (this.subscription) {
      this.subscription.stop();
    }
    if (this.collectionSub) {
      this.collectionSub.stop();
    }
    if (this.computation) {
      this.computation.stop();
    }
    
    this.loading = true;
    m.redraw();
    
    this.subscription = Meteor.subscribe('gamesSearch', this.searchQuery, { limit: 50 });
    this.collectionSub = Meteor.subscribe('userCollection', {});
    
    this.computation = Tracker.autorun(() => {
      const ready = this.subscription.ready() && this.collectionSub.ready();
      
      if (ready) {
        this.games = Games.find({}, { sort: { title: 1 } }).fetch();
        
        const items = CollectionItems.find({}).fetch();
        this.collectionGameIds = new Set(items.map(item => item.gameId));
        
        this.loading = false;
        m.redraw();
      }
    });
  },
  
  handleSearch(query) {
    this.searchQuery = query;
    this.setupSubscriptions();
  },
  
  view(vnode) {
    return m('div.browse-page', [
      m('header.page-header', [
        m('h1', 'Browse Games'),
        m('a.button.outline', { href: '/collection', oncreate: m.route.link }, 'My Collection')
      ]),
      
      m('div.search-bar', [
        m('input[type=search]', {
          placeholder: 'Search games...',
          value: this.searchQuery,
          oninput: (event) => {
            if (this.searchTimeout) {
              clearTimeout(this.searchTimeout);
            }
            const query = event.target.value;
            this.searchTimeout = setTimeout(() => {
              this.handleSearch(query);
            }, 300);
          }
        })
      ]),
      
      this.loading && m('div.loading-container', [
        m('div.loading'),
        m('p', 'Loading games...')
      ]),
      
      !this.loading && this.games.length === 0 && m('div.empty-state', [
        m('h3', 'No games found'),
        this.searchQuery 
          ? m('p', 'Try a different search term.')
          : m('p', 'The game database is empty. Try seeding sample games from the home page.')
      ]),
      
      !this.loading && this.games.length > 0 && m('div.games-grid',
        this.games.map(game => {
          const inCollection = this.collectionGameIds.has(game._id);
          return m(GameCard, {
            key: game._id,
            game: game,
            collectionItem: null,
            showActions: true,
            onAddToCollection: inCollection ? null : (selectedGame) => { this.addingGame = selectedGame; }
          });
        })
      ),
      
      !this.loading && this.games.length > 0 && m('p.results-count', [
        m('small', `Showing ${this.games.length} games`)
      ]),
      
      this.addingGame && m(AddGameModal, {
        game: this.addingGame,
        onClose: () => { this.addingGame = null; },
        onSuccess: () => { 
          this.addingGame = null;
          this.setupSubscriptions();
        }
      }),
      
      m('footer', [
        m('small', [
          'Game data powered by ',
          m('a', { href: 'https://www.igdb.com', target: '_blank', rel: 'noopener' }, 'IGDB.com')
        ])
      ])
    ]);
  }
};

export const BrowsePage = {
  view() {
    return m(RequireAuth, m(BrowseContent));
  }
};
