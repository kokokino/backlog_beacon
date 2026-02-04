import m from 'mithril';
import { Meteor } from 'meteor/meteor';
import { Tracker } from 'meteor/tracker';
import { RequireAuth } from '../components/RequireAuth.js';
import { GameCard } from '../components/GameCard.js';
import { EditItemModal } from '../components/EditItemModal.js';
import { EditCustomGameModal } from '../components/EditCustomGameModal.js';
import { CollectionFilters } from '../components/CollectionFilters.js';
import { ViewModeSelector, VIEW_MODES, loadViewMode, saveViewMode } from '../components/ViewModeSelector.js';
import { VirtualScrollGrid } from '../components/VirtualScrollGrid.js';
import { PositionIndicator } from '../components/PositionIndicator.js';
import { BeanstalkView } from '../components/beanstalk/BeanstalkView.js';
import { BookshelfView } from '../components/BookshelfView.js';
import { BookshelfThemeSelector, loadBookshelfTheme, saveBookshelfTheme } from '../components/BookshelfThemeSelector.js';
import { CollectionItems } from '../../lib/collections/collectionItems.js';
import { Games } from '../../lib/collections/games.js';
import { UserPlatforms } from '../../lib/collections/userPlatforms.js';

const PAGE_SIZE = 24;
const INFINITE_CHUNK_SIZE = 100;

const CollectionContent = {
  oninit(vnode) {
    this.items = [];
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
    this.loadingMore = false;
    this.editingItem = null;
    this.subscription = null;
    this.platformsSubscription = null;
    this.computation = null;
    this.searchDebounceTimer = null;
    this.searchFeedbackTimer = null;
    this.isSearchPending = false;
    this.viewMode = loadViewMode();
    this.loadedCount = 0;  // Track how many items are loaded in infinite mode
    this.loadedRanges = [];  // Track loaded ranges for sparse loading: [[start, end], ...]
    this.visibleStart = 0;  // For position indicator
    this.visibleEnd = 0;    // For position indicator
    this.bookshelfTheme = loadBookshelfTheme();  // Load saved theme preference
    this.pendingChunks = new Set();  // Track in-flight prefetch requests
    this.prefetchDebounceTimer = null;  // Debounce rapid scroll events
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
    if (this.searchFeedbackTimer) {
      clearTimeout(this.searchFeedbackTimer);
    }
    if (this.prefetchDebounceTimer) {
      clearTimeout(this.prefetchDebounceTimer);
    }
  },

  setupPlatformsSubscription() {
    // Separate lightweight subscription just for platform filter options
    this.platformsSubscription = Meteor.subscribe('collectionPlatforms');
    Tracker.autorun(() => {
      if (this.platformsSubscription.ready()) {
        const platformsDoc = UserPlatforms.findOne(Meteor.userId());
        this.platforms = platformsDoc?.platforms || [];
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
    if (this.filters.search && this.filters.search.trim().length >= 3) {
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
    const sortField = currentSort.startsWith('date') ? 'dateAdded' : 'title';
    const sortDirection = currentSort.endsWith('desc') ? -1 : 1;

    const isInfiniteMode = this.viewMode === VIEW_MODES.INFINITE;
    const isBookshelfMode = this.viewMode === VIEW_MODES.BOOKSHELF;
    const isBeanstalkMode = this.viewMode === VIEW_MODES.BEANSTALK;

    // INFINITE/BOOKSHELF/BEANSTALK MODE: Use method calls only (no subscription reactivity issues)
    if (isInfiniteMode || isBookshelfMode || isBeanstalkMode) {
      this.loadInitialInfiniteData();
      return;
    }

    // PAGES MODE: Use subscriptions for reactive updates
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
    if (this.filters.search && this.filters.search.trim().length >= 3) {
      options.search = this.filters.search.trim();
    }

    this.subscription = Meteor.subscribe('userCollectionWithGames', options);

    this.computation = Tracker.autorun(() => {
      const ready = this.subscription.ready();

      if (ready) {
        let items = CollectionItems.find({}).fetch();

        // Build games lookup and embed game in each item (same structure as method response)
        const gameIds = items.map(item => item.gameId).filter(Boolean);
        const games = Games.find({ _id: { $in: gameIds } }).fetch();
        const gamesMap = {};
        games.forEach(game => {
          gamesMap[game._id] = game;
        });

        // Embed game in each item
        items.forEach(item => {
          item.game = gamesMap[item.gameId] || null;
        });

        // Sort client-side
        if (sortField === 'title') {
          items.sort((a, b) => {
            const titleA = (a.game?.title || '').toLowerCase();
            const titleB = (b.game?.title || '').toLowerCase();
            if (titleA < titleB) {
              return sortDirection === 1 ? -1 : 1;
            }
            if (titleA > titleB) {
              return sortDirection === 1 ? 1 : -1;
            }
            return 0;
          });
        } else {
          items.sort((a, b) => {
            const valA = a[sortField] || 0;
            const valB = b[sortField] || 0;
            return sortDirection === 1 ? valA - valB : valB - valA;
          });
        }

        this.items = items;
        this.loadedCount = items.length;
        this.loading = false;
        m.redraw();
      }
    });
  },

  async loadInitialInfiniteData() {
    // Reset sparse array state
    this.items = [];
    this.loadedRanges = [];

    const options = this.buildFilterOptions();
    options.limit = INFINITE_CHUNK_SIZE;
    options.skip = 0;

    try {
      // Method now returns items directly with game embedded in each item
      const newItems = await Meteor.callAsync('collection.getItemsChunk', options);
      this.items = newItems;  // Initial load starts at index 0
      this.loadedCount = newItems.length;
      // Track the initial loaded range
      if (newItems.length > 0) {
        this.loadedRanges = [[0, newItems.length - 1]];
      }
      this.loading = false;
      m.redraw();
    } catch (error) {
      console.error('Failed to load initial data:', error);
      this.loading = false;
      m.redraw();
    }
  },

  buildFilterOptions() {
    const options = {
      sort: this.filters.sort || 'name-asc'
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
    if (this.filters.search && this.filters.search.trim().length >= 3) {
      options.search = this.filters.search.trim();
    }
    return options;
  },

  // Check if a range is already loaded (for sparse loading)
  isRangeLoaded(start, end) {
    for (const [rangeStart, rangeEnd] of this.loadedRanges) {
      if (start >= rangeStart && end <= rangeEnd) {
        return true;
      }
    }
    return false;
  },

  // Merge adjacent/overlapping ranges for cleaner tracking
  mergeAdjacentRanges() {
    if (this.loadedRanges.length < 2) {
      return;
    }

    this.loadedRanges.sort((a, b) => a[0] - b[0]);
    const merged = [this.loadedRanges[0]];

    for (let rangeIndex = 1; rangeIndex < this.loadedRanges.length; rangeIndex++) {
      const last = merged[merged.length - 1];
      const current = this.loadedRanges[rangeIndex];

      // Allow merging ranges that are adjacent (within 1 index) or overlapping
      if (current[0] <= last[1] + 1) {
        last[1] = Math.max(last[1], current[1]);
      } else {
        merged.push(current);
      }
    }

    this.loadedRanges = merged;
  },

  handleFilterChange(newFilters) {
    const searchChanged = newFilters.search !== this.filters.search;
    const filtersChanged = newFilters.status !== this.filters.status ||
                          newFilters.platform !== this.filters.platform ||
                          newFilters.favorite !== this.filters.favorite;

    // Check if we had an active search before (3+ chars) - must do this before updating filters
    const previousSearch = (this.filters.search || '').trim();
    const hadActiveSearch = previousSearch.length >= 3;

    this.filters = newFilters;
    this.pendingChunks.clear();

    // Clear all pending timers on every change
    if (this.searchDebounceTimer) {
      clearTimeout(this.searchDebounceTimer);
      this.searchDebounceTimer = null;
    }
    if (this.searchFeedbackTimer) {
      clearTimeout(this.searchFeedbackTimer);
      this.searchFeedbackTimer = null;
    }
    this.isSearchPending = false;

    // Reset to page 1 when filters change (except sort)
    if (searchChanged || filtersChanged) {
      this.currentPage = 1;
      this.loadedCount = 0;
      // Scroll to top when filters change in infinite/bookshelf mode
      if (this.viewMode === VIEW_MODES.INFINITE || this.viewMode === VIEW_MODES.BOOKSHELF) {
        window.scrollTo(0, 0);
      }
    }

    const trimmedSearch = (newFilters.search || '').trim();

    if (searchChanged) {
      if (trimmedSearch.length === 0) {
        // Search cleared - only refresh if we had an active search
        if (hadActiveSearch) {
          this.setupSubscriptions();
          this.fetchTotalCount();
        }
      } else if (trimmedSearch.length < 3) {
        // 1-2 chars - only refresh if clearing an active search
        if (hadActiveSearch) {
          this.setupSubscriptions();
          this.fetchTotalCount();
        }
      } else {
        // 3+ chars - double-layered debounce
        this.searchFeedbackTimer = setTimeout(() => {
          this.isSearchPending = true;
          m.redraw();
        }, 200);

        this.searchDebounceTimer = setTimeout(() => {
          this.isSearchPending = false;
          this.setupSubscriptions();
          this.fetchTotalCount();
        }, 800);
      }
    } else {
      // Non-search filter changes - apply immediately (include search only if 3+ chars)
      this.setupSubscriptions();
      if (filtersChanged) {
        this.fetchTotalCount();
      }
    }
  },

  handleClearFilters() {
    if (this.searchDebounceTimer) {
      clearTimeout(this.searchDebounceTimer);
      this.searchDebounceTimer = null;
    }
    if (this.searchFeedbackTimer) {
      clearTimeout(this.searchFeedbackTimer);
      this.searchFeedbackTimer = null;
    }
    this.isSearchPending = false;
    this.filters = {
      status: null,
      platform: null,
      favorite: null,
      search: '',
      sort: 'name-asc'
    };
    this.currentPage = 1;
    this.loadedCount = 0;
    // Scroll to top when filters are cleared (especially useful in infinite/bookshelf mode)
    if (this.viewMode === VIEW_MODES.INFINITE || this.viewMode === VIEW_MODES.BOOKSHELF) {
      window.scrollTo(0, 0);
    }
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

  handleModeChange(newMode) {
    if (newMode === this.viewMode) {
      return;
    }
    this.viewMode = newMode;
    saveViewMode(newMode);
    this.items = [];
    this.loadedRanges = [];
    this.loadedCount = 0;
    this.currentPage = 1;
    this.pendingChunks.clear();
    // Scroll to top when switching modes
    window.scrollTo(0, 0);
    this.setupSubscriptions();
  },

  handleVisibleRangeChange(startIdx, endIdx, loadedCount) {
    // Update position indicator state
    this.visibleStart = startIdx + 1;
    this.visibleEnd = Math.min(endIdx + 1, this.totalCount);

    // Don't try to load if already loading or no more data
    if (this.loadingMore) {
      m.redraw();
      return;
    }

    // Check if the visible range is loaded (sparse loading)
    const rangeEnd = Math.min(endIdx, this.totalCount - 1);
    if (!this.isRangeLoaded(startIdx, rangeEnd)) {
      // Calculate which chunk contains the start of visible range (chunk-aligned)
      const chunkStart = Math.floor(startIdx / INFINITE_CHUNK_SIZE) * INFINITE_CHUNK_SIZE;
      this.loadItemsAtRange(chunkStart);
    }

    // Schedule predictive prefetch
    this.schedulePrefetch(endIdx);

    m.redraw();
  },

  schedulePrefetch(currentEndIdx) {
    if (this.prefetchDebounceTimer) {
      clearTimeout(this.prefetchDebounceTimer);
    }

    this.prefetchDebounceTimer = setTimeout(() => {
      this.prefetchNextChunk(currentEndIdx);
    }, 50);
  },

  async prefetchNextChunk(currentEndIdx) {
    // Calculate distance to next chunk boundary
    const currentChunk = Math.floor(currentEndIdx / INFINITE_CHUNK_SIZE);
    const nextChunkStart = (currentChunk + 1) * INFINITE_CHUNK_SIZE;
    const distanceToNextChunk = nextChunkStart - currentEndIdx;

    // Prefetch when within 30 items of chunk boundary
    const PREFETCH_THRESHOLD = 30;

    if (distanceToNextChunk > PREFETCH_THRESHOLD) {
      return; // Not close enough to boundary
    }

    // Prefetch chunk+1 (with ~12ms query times, chunk+2 is unnecessary)
    const chunksToFetch = [nextChunkStart];

    for (const chunkStart of chunksToFetch) {
      if (chunkStart >= this.totalCount) {
        continue; // No more chunks to load
      }

      if (this.isRangeLoaded(chunkStart, chunkStart + INFINITE_CHUNK_SIZE - 1)) {
        continue; // Already loaded
      }

      if (this.pendingChunks.has(chunkStart)) {
        continue; // Already being fetched
      }

      // Background prefetch (don't await, let them run in parallel)
      this.prefetchSingleChunk(chunkStart);
    }
  },

  async prefetchSingleChunk(chunkStart) {
    this.pendingChunks.add(chunkStart);

    try {
      const options = this.buildFilterOptions();
      options.limit = INFINITE_CHUNK_SIZE;
      options.skip = chunkStart;

      // Method now returns items directly with game embedded
      const newItems = await Meteor.callAsync('collection.getItemsChunk', options);

      newItems.forEach((item, itemIndex) => {
        this.items[chunkStart + itemIndex] = item;
      });

      if (newItems.length > 0) {
        this.loadedRanges.push([chunkStart, chunkStart + newItems.length - 1]);
        this.mergeAdjacentRanges();
      }

      this.loadedCount = this.items.filter(item => item !== undefined).length;
      m.redraw();
    } catch (error) {
      console.error('Prefetch failed:', error);
    } finally {
      this.pendingChunks.delete(chunkStart);
    }
  },

  async loadItemsAtRange(fromIndex) {
    if (this.loadingMore || fromIndex >= this.totalCount) {
      return;
    }

    this.loadingMore = true;
    m.redraw();

    const options = this.buildFilterOptions();
    options.limit = INFINITE_CHUNK_SIZE;
    options.skip = fromIndex;

    try {
      // Method now returns items directly with game embedded
      const newItems = await Meteor.callAsync('collection.getItemsChunk', options);

      // Store items at their actual indices (sparse array)
      newItems.forEach((item, itemIndex) => {
        this.items[fromIndex + itemIndex] = item;
      });

      // Track loaded range
      const rangeEnd = fromIndex + newItems.length - 1;
      if (newItems.length > 0) {
        this.loadedRanges.push([fromIndex, rangeEnd]);
        this.mergeAdjacentRanges();
      }

      // loadedCount tracks actual items (not sparse length)
      this.loadedCount = this.items.filter(item => item !== undefined).length;
    } catch (error) {
      console.error('Failed to load items at range:', error);
    }

    this.loadingMore = false;
    m.redraw();

    // Check if visible range needs more chunks (cascading load)
    // This handles viewports that span multiple chunks
    const visibleStartIdx = this.visibleStart - 1;  // Convert from 1-indexed
    const visibleEndIdx = Math.min(this.visibleEnd - 1, this.totalCount - 1);
    if (visibleEndIdx >= 0 && !this.isRangeLoaded(visibleStartIdx, visibleEndIdx)) {
      const nextChunkStart = Math.floor(visibleEndIdx / INFINITE_CHUNK_SIZE) * INFINITE_CHUNK_SIZE;
      if (nextChunkStart > fromIndex) {
        this.loadItemsAtRange(nextChunkStart);
      }
    }
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
    const trimmedSearch = (this.filters.search || '').trim();
    const hasActiveFilters = this.filters.status || this.filters.platform ||
                             this.filters.favorite || trimmedSearch.length >= 3;
    const maxPages = Math.ceil(this.totalCount / PAGE_SIZE) || 1;
    const startIndex = this.totalCount > 0 ? ((this.currentPage - 1) * PAGE_SIZE) + 1 : 0;
    const endIndex = Math.min(this.currentPage * PAGE_SIZE, this.totalCount);
    const showSearchHint = trimmedSearch.length > 0 && trimmedSearch.length < 3;

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

      // View mode selector
      m(ViewModeSelector, {
        currentMode: this.viewMode,
        onModeChange: (mode) => this.handleModeChange(mode)
      }),

      // Bookshelf theme selector (only shown in bookshelf mode)
      this.viewMode === VIEW_MODES.BOOKSHELF && m(BookshelfThemeSelector, {
        currentTheme: this.bookshelfTheme,
        onThemeChange: (theme) => {
          this.bookshelfTheme = theme;
          saveBookshelfTheme(theme);
        }
      }),

      // Hint when search is 1-2 characters
      showSearchHint && m('p.search-hint', 'Type at least 3 characters to search.'),

      // Searching indicator
      this.isSearchPending && m('div.search-pending', [
        m('p', 'Searching...')
      ]),

      !this.isSearchPending && this.loading && m('div.loading-container', [
        m('div.loading'),
        m('p', 'Loading your collection...')
      ]),

      // No results due to filters
      !this.isSearchPending && !this.loading && this.items.length === 0 && hasActiveFilters && m('div.empty-state', [
        m('h3', 'No games match your filters'),
        m('p', 'Try adjusting your search or filter criteria.'),
        m('button', { onclick: () => this.handleClearFilters() }, 'Clear Filters'),
        m('p', 'Or browse games to add them to your collection.'),
        m('a.button', { href: '/browse', oncreate: m.route.link }, 'Browse Games')
      ]),

      // Truly empty collection
      !this.isSearchPending && !this.loading && this.items.length === 0 && !hasActiveFilters && m('div.empty-state', [
        m('h3', 'No games in your collection'),
        m('p', 'Start by browsing games and adding them to your collection.'),
        m('a.button', { href: '/browse', oncreate: m.route.link }, 'Browse Games')
      ]),

      // Pages mode: traditional grid with pagination
      !this.isSearchPending && !this.loading && this.items.length > 0 && this.viewMode === VIEW_MODES.PAGES && m('div.collection-grid',
        this.items.map(item =>
          m(GameCard, {
            key: item._id,
            game: item.game,
            collectionItem: item,
            onUpdateItem: (collectionItem) => { this.editingItem = collectionItem; },
            onRemoveItem: (id) => this.handleRemoveItem(id)
          })
        )
      ),

      !this.isSearchPending && !this.loading && this.totalCount > 0 && this.viewMode === VIEW_MODES.PAGES && m('div.pagination-row', [
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

      // Infinite mode: virtual scroll grid
      !this.isSearchPending && !this.loading && this.viewMode === VIEW_MODES.INFINITE && this.totalCount > 0 && m(VirtualScrollGrid, {
        items: this.items,
        totalCount: this.totalCount,
        loading: this.loadingMore,
        onUpdateItem: (collectionItem) => { this.editingItem = collectionItem; },
        onRemoveItem: (id) => this.handleRemoveItem(id),
        onVisibleRangeChange: (start, end, loaded) => this.handleVisibleRangeChange(start, end, loaded)
      }),

      // Position indicator for infinite mode (rendered at page level to avoid contain:layout issues)
      !this.isSearchPending && !this.loading && this.viewMode === VIEW_MODES.INFINITE && this.totalCount > 0 && m(PositionIndicator, {
        start: this.visibleStart || 1,
        end: this.visibleEnd || Math.min(24, this.totalCount),
        total: this.totalCount,
        loading: this.loadingMore
      }),

      // Bookshelf mode: virtual scroll shelves
      !this.isSearchPending && !this.loading && this.viewMode === VIEW_MODES.BOOKSHELF && this.totalCount > 0 && m(BookshelfView, {
        items: this.items,
        totalCount: this.totalCount,
        theme: this.bookshelfTheme,
        loading: this.loadingMore,
        onUpdateItem: (collectionItem) => { this.editingItem = collectionItem; },
        onVisibleRangeChange: (start, end, loaded) => this.handleVisibleRangeChange(start, end, loaded)
      }),

      // Position indicator for bookshelf mode
      !this.isSearchPending && !this.loading && this.viewMode === VIEW_MODES.BOOKSHELF && this.totalCount > 0 && m(PositionIndicator, {
        start: this.visibleStart || 1,
        end: this.visibleEnd || Math.min(24, this.totalCount),
        total: this.totalCount,
        loading: this.loadingMore
      }),

      // Beanstalk 3D mode
      !this.isSearchPending && !this.loading && this.viewMode === VIEW_MODES.BEANSTALK && this.totalCount > 0 && m(BeanstalkView, {
        items: this.items,
        totalCount: this.totalCount,
        onUpdateItem: (item) => { this.editingItem = item; },
        onVisibleRangeChange: (start, end, loaded) => this.handleVisibleRangeChange(start, end, loaded),
        onModeChange: (mode) => this.handleModeChange(mode)
      }),

      // Show appropriate modal based on whether it's a custom game
      this.editingItem && (
        this.editingItem.game?.ownerId
          ? m(EditCustomGameModal, {
              game: this.editingItem.game,
              collectionItem: this.editingItem,
              onClose: () => { this.editingItem = null; },
              onSuccess: (itemId, itemUpdates, gameId, gameUpdates) => {
                // Update local item data
                if (itemId) {
                  const index = this.items.findIndex(item => item._id === itemId);
                  if (index !== -1) {
                    Object.assign(this.items[index], itemUpdates);
                  }
                }
                // Update local game data (embedded in item)
                if (this.editingItem && this.editingItem.game) {
                  Object.assign(this.editingItem.game, gameUpdates);
                }
                this.editingItem = null;
              }
            })
          : m(EditItemModal, {
              item: this.editingItem,
              game: this.editingItem.game,
              onClose: () => { this.editingItem = null; },
              onSuccess: (itemId, updates) => {
                // Update local item data so 3D view reflects changes
                const index = this.items.findIndex(item => item._id === itemId);
                if (index !== -1) {
                  Object.assign(this.items[index], updates);
                }
                this.editingItem = null;
              }
            })
      )
    ]);
  }
};

export const CollectionPage = {
  view() {
    return m(RequireAuth, m(CollectionContent));
  }
};
