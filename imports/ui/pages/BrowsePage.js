import m from 'mithril';
import { Meteor } from 'meteor/meteor';
import { Tracker } from 'meteor/tracker';
import { RequireAuth } from '../components/RequireAuth.js';
import { GameCard } from '../components/GameCard.js';
import { AddGameModal } from '../components/AddGameModal.js';
import { CreateCustomGameModal } from '../components/CreateCustomGameModal.js';
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
    this.creatingCustomGame = false;
    this.subscription = null;
    this.computation = null;
    this.searchDebounceTimer = null;
    this.searchFeedbackTimer = null;
    this.isSearchPending = false;
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
    if (this.computation) {
      this.computation.stop();
    }
    if (this.searchDebounceTimer) {
      clearTimeout(this.searchDebounceTimer);
    }
    if (this.searchFeedbackTimer) {
      clearTimeout(this.searchFeedbackTimer);
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

    // Fetch ALL gameIds for collection check via method (no subscription needed)
    Meteor.callAsync('collection.getGameIds').then(gameIds => {
      this.collectionGameIds = new Set(gameIds);
      m.redraw();
    });

    this.computation = Tracker.autorun(() => {
      const ready = this.subscription.ready();

      if (ready) {
        this.localGames = Games.find({}, { sort: { title: 1 } }).fetch();

        this.localLoading = false;
        m.redraw();
      }
    });
  },
  
  handleSearchInput(query) {
    // Clear all pending timers
    if (this.searchDebounceTimer) {
      clearTimeout(this.searchDebounceTimer);
      this.searchDebounceTimer = null;
    }
    if (this.searchFeedbackTimer) {
      clearTimeout(this.searchFeedbackTimer);
      this.searchFeedbackTimer = null;
    }
    this.isSearchPending = false;

    const trimmed = query.trim();

    // Check if we had an active search before (3+ chars)
    const hadActiveSearch = this.searchQuery.length >= 3;

    if (trimmed.length === 0) {
      // Empty - only refresh if we had an active search
      if (hadActiveSearch) {
        this.searchQuery = '';
        this.igdbGames = [];
        this.igdbSearched = false;
        this.setupSubscriptions();
        this.fetchTotalCount();
      }
      return;
    }

    if (trimmed.length < 3) {
      // 1-2 chars - only refresh if clearing an active search
      if (hadActiveSearch) {
        this.searchQuery = '';
        this.igdbGames = [];
        this.igdbSearched = false;
        this.setupSubscriptions();
        this.fetchTotalCount();
      }
      return;
    }

    // 3+ chars - double-layered debounce
    this.searchFeedbackTimer = setTimeout(() => {
      this.isSearchPending = true;
      m.redraw();
    }, 200);

    this.searchDebounceTimer = setTimeout(() => {
      this.isSearchPending = false;
      this.searchQuery = trimmed;
      this.currentPage = 1;
      this.igdbGames = [];
      this.igdbSearched = false;
      this.igdbError = null;

      this.setupSubscriptions();
      this.fetchTotalCount();

      if (this.igdbConfigured) {
        this.searchIgdb(trimmed);
      }
      m.redraw();
    }, 800);
  },
  
  async searchIgdb(query) {
    const searchingFor = query.trim();
    if (searchingFor.length < 3) {
      return;
    }

    this.igdbLoading = true;
    this.igdbError = null;
    m.redraw();

    try {
      const results = await Meteor.callAsync('igdb.searchAndCache', query);

      // RACE CONDITION FIX: discard if query changed while waiting
      if (this.searchQuery !== searchingFor) {
        return;
      }

      const localIgdbIds = new Set(this.localGames.map(g => g.igdbId).filter(Boolean));

      this.igdbGames = results.filter(game => !localIgdbIds.has(game.igdbId));
      this.igdbSearched = true;

      // Re-fetch count since IGDB caching may have added new games to local DB
      if (results.length > 0) {
        this.fetchTotalCount();
      }
    } catch (error) {
      // RACE CONDITION FIX: discard if query changed while waiting
      if (this.searchQuery !== searchingFor) {
        return;
      }

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
            ? 'Search games (type at least 3 characters to search)...'
            : 'Search games (type at least 3 characters)...',
          value: this.inputValue,
          oninput: (event) => {
            this.inputValue = event.target.value;
            this.handleSearchInput(this.inputValue);
          }
        })
      ]),
      
      // Searching indicator
      this.isSearchPending && m('div.search-pending', [
        m('p', 'Searching...')
      ]),

      !this.isSearchPending && m('section.local-results', [
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

      // Create Custom Game card - shown when searching and no local results found
      !this.isSearchPending && this.searchQuery.trim().length >= 3 && m('section.create-custom-section', [
        m('article.game-card.create-custom-card', {
          onclick: () => { this.creatingCustomGame = true; }
        }, [
          m('div.create-custom-icon', '+'),
          m('div.create-custom-text', [
            m('h4', "Can't find it?"),
            m('p', 'Create your own custom game entry')
          ])
        ])
      ]),

      !this.isSearchPending && showIgdbSection && m('section.igdb-results', [
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
      
      !this.isSearchPending && this.inputValue.trim().length > 0 && this.inputValue.trim().length < 3 &&
        m('p.search-hint', 'Type at least 3 characters to search.'),
      
      !this.isSearchPending && !this.igdbConfigured && this.searchQuery.trim().length >= 3 && m('p.search-hint', [
        'IGDB integration is not configured. Only local results are shown.'
      ]),
      
      this.addingGame && m(AddGameModal, {
        game: this.addingGame,
        onClose: () => { this.addingGame = null; },
        onSuccess: () => {
          this.addingGame = null;
          this.setupSubscriptions();
        }
      }),

      this.creatingCustomGame && m(CreateCustomGameModal, {
        initialTitle: this.searchQuery,
        onClose: () => { this.creatingCustomGame = false; },
        onSuccess: (gameId) => {
          this.creatingCustomGame = false;
          this.setupSubscriptions();
          this.fetchTotalCount();
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
