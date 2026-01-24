import m from 'mithril';
import { Meteor } from 'meteor/meteor';
import { Tracker } from 'meteor/tracker';
import { RequireAuth } from '../components/RequireAuth.js';
import { GameCard } from '../components/GameCard.js';
import { AddGameModal } from '../components/AddGameModal.js';
import { Games } from '../../lib/collections/games.js';
import { CollectionItems } from '../../lib/collections/collectionItems.js';

const PAGE_SIZE = 24;

const BrowseContent = {
  oninit(vnode) {
    this.localGames = [];
    this.igdbGames = [];
    this.collectionGameIds = new Set();
    this.searchQuery = '';
    this.inputValue = '';
    this.localLoading = true;
    this.igdbLoading = false;
    this.igdbSearched = false;
    this.igdbError = null;
    this.igdbConfigured = true;
    this.addingGame = null;
    this.subscription = null;
    this.collectionSub = null;
    this.computation = null;
    this.searchTimeout = null;
    this.igdbTimeout = null;
    this.currentPage = 1;
    this.totalCount = 0;

    this.checkIgdbConfigured();
  },
  
  oncreate(vnode) {
    this.setupSubscriptions();
    this.fetchTotalCount();
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
    if (this.igdbTimeout) {
      clearTimeout(this.igdbTimeout);
    }
  },
  
  async checkIgdbConfigured() {
    try {
      this.igdbConfigured = await Meteor.callAsync('igdb.isConfigured');
      m.redraw();
    } catch (error) {
      this.igdbConfigured = false;
      m.redraw();
    }
  },

  async fetchTotalCount() {
    const filters = {};
    if (this.searchQuery && this.searchQuery.trim().length > 0) {
      filters.search = this.searchQuery.trim();
    }

    try {
      const count = await Meteor.callAsync('games.count', filters);
      this.totalCount = count;
      m.redraw();
    } catch (error) {
      console.error('Failed to fetch games count:', error);
      this.totalCount = 0;
    }
  },

  goToPage(page) {
    const maxPages = Math.ceil(this.totalCount / PAGE_SIZE) || 1;
    if (page < 1 || page > maxPages) {
      return;
    }
    this.currentPage = page;
    this.setupSubscriptions();
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

    this.localLoading = true;
    m.redraw();

    const options = {
      limit: PAGE_SIZE,
      skip: (this.currentPage - 1) * PAGE_SIZE
    };
    if (this.searchQuery && this.searchQuery.trim().length > 0) {
      options.search = this.searchQuery.trim();
    }

    this.subscription = Meteor.subscribe('gamesBrowse', options);
    this.collectionSub = Meteor.subscribe('userCollection', {});

    // Fetch ALL gameIds for collection check (not limited by subscription)
    Meteor.callAsync('collection.getGameIds').then(gameIds => {
      this.collectionGameIds = new Set(gameIds);
      m.redraw();
    });

    this.computation = Tracker.autorun(() => {
      const ready = this.subscription.ready() && this.collectionSub.ready();

      if (ready) {
        this.localGames = Games.find({}, { sort: { title: 1 } }).fetch();

        this.localLoading = false;
        m.redraw();
      }
    });
  },
  
  handleSearch(query) {
    this.searchQuery = query;
    this.currentPage = 1;
    this.igdbSearched = false;
    this.igdbGames = [];
    this.igdbError = null;

    if (this.igdbTimeout) {
      clearTimeout(this.igdbTimeout);
      this.igdbTimeout = null;
    }

    this.setupSubscriptions();
    this.fetchTotalCount();

    if (query.trim().length >= 3 && this.igdbConfigured) {
      this.igdbTimeout = setTimeout(() => {
        this.searchIgdb(query);
      }, 500);
    }
  },
  
  async searchIgdb(query) {
    if (query.trim().length < 3) {
      return;
    }
    
    this.igdbLoading = true;
    this.igdbError = null;
    m.redraw();
    
    try {
      const results = await Meteor.callAsync('igdb.searchAndCache', query);
      
      const localIgdbIds = new Set(this.localGames.map(g => g.igdbId).filter(Boolean));
      
      this.igdbGames = results.filter(game => !localIgdbIds.has(game.igdbId));
      this.igdbSearched = true;
    } catch (error) {
      console.error('IGDB search failed:', error);
      if (error.error === 'igdb-not-configured') {
        this.igdbConfigured = false;
        this.igdbError = null;
      } else {
        this.igdbError = error.reason || error.message || 'Failed to search IGDB';
      }
      this.igdbGames = [];
      this.igdbSearched = true;
    }
    
    this.igdbLoading = false;
    m.redraw();
  },
  
  view(vnode) {
    const hasLocalResults = this.localGames.length > 0;
    const hasIgdbResults = this.igdbGames.length > 0;
    const showIgdbSection = this.searchQuery.trim().length >= 3 && this.igdbConfigured;
    const isEmptySearch = !this.searchQuery.trim();
    const maxPages = Math.ceil(this.totalCount / PAGE_SIZE) || 1;
    const startIndex = this.totalCount > 0 ? ((this.currentPage - 1) * PAGE_SIZE) + 1 : 0;
    const endIndex = Math.min(this.currentPage * PAGE_SIZE, this.totalCount);
    
    return m('div.browse-page', [
      m('header.page-header', [
        m('h1', 'Browse Games'),
        m('a.button.outline', { href: '/collection', oncreate: m.route.link }, 'My Collection')
      ]),
      
      m('div.search-bar', [
        m('input[type=search]', {
          placeholder: this.igdbConfigured 
            ? 'Search games (type at least 3 characters to search IGDB)...'
            : 'Search games...',
          value: this.inputValue,
          oninput: (event) => {
            this.inputValue = event.target.value;
            
            if (this.searchTimeout) {
              clearTimeout(this.searchTimeout);
            }
            
            const query = this.inputValue;
            this.searchTimeout = setTimeout(() => {
              this.handleSearch(query);
            }, 150);
          }
        })
      ]),
      
      m('section.local-results', [
        m('h3.section-title', [
          '📚 ',
          isEmptySearch ? 'Games in Database' : 'Local Results',
          !this.localLoading && m('span.result-count', ` (${this.totalCount.toLocaleString()} total)`)
        ]),
        
        this.localLoading && m('div.loading-container', [
          m('div.loading'),
          m('p', 'Searching local database...')
        ]),
        
        !this.localLoading && !hasLocalResults && m('div.empty-state', [
          m('h3', 'No local games found'),
          isEmptySearch
            ? m('p', 'The local game database is empty. Search for games to add them from IGDB.')
            : m('p', 'No matches in local database.')
        ]),
        
        !this.localLoading && hasLocalResults && m('div.games-grid',
          this.localGames.map(game => {
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

        !this.localLoading && this.totalCount > 0 && m('div.pagination-row', [
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
        ])
      ]),

      showIgdbSection && m('section.igdb-results', [
        m('h3.section-title', [
          '🌐 Results from IGDB',
          !this.igdbLoading && this.igdbSearched && m('span.result-count', ` (${this.igdbGames.length})`),
          m('small.igdb-attribution', [
            ' — powered by ',
            m('a', { href: 'https://www.igdb.com', target: '_blank', rel: 'noopener' }, 'IGDB.com')
          ])
        ]),
        
        this.igdbLoading && m('div.loading-container', [
          m('div.loading'),
          m('p', 'Searching IGDB...')
        ]),
        
        !this.igdbLoading && this.igdbError && m('div.error-state', [
          m('p.error-message', this.igdbError),
          m('button.outline', {
            onclick: () => this.searchIgdb(this.searchQuery)
          }, 'Retry Search')
        ]),
        
        !this.igdbLoading && !this.igdbError && !this.igdbSearched && m('div.pending-state', [
          m('p', 'Searching IGDB...')
        ]),
        
        !this.igdbLoading && !this.igdbError && this.igdbSearched && !hasIgdbResults && m('div.empty-state', [
          m('p', 'No additional results found on IGDB.')
        ]),
        
        !this.igdbLoading && !this.igdbError && this.igdbSearched && hasIgdbResults && m('div.games-grid',
          this.igdbGames.map(game => {
            const inCollection = this.collectionGameIds.has(game._id);
            return m(GameCard, {
              key: game._id,
              game: game,
              collectionItem: null,
              showActions: true,
              onAddToCollection: inCollection ? null : (selectedGame) => { this.addingGame = selectedGame; }
            });
          })
        )
      ]),
      
      !showIgdbSection && this.searchQuery.trim().length > 0 && this.searchQuery.trim().length < 3 && this.igdbConfigured &&
        m('p.search-hint', 'Type at least 3 characters to also search IGDB.'),
      
      !this.igdbConfigured && this.searchQuery.trim().length >= 3 && m('p.search-hint', [
        'IGDB integration is not configured. Only local results are shown.'
      ]),
      
      this.addingGame && m(AddGameModal, {
        game: this.addingGame,
        onClose: () => { this.addingGame = null; },
        onSuccess: () => { 
          this.addingGame = null;
          this.setupSubscriptions();
        }
      })
    ]);
  }
};

export const BrowsePage = {
  view() {
    return m(RequireAuth, m(BrowseContent));
  }
};
