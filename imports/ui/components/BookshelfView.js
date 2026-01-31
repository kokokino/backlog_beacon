import m from 'mithril';
import { BookshelfItem } from './BookshelfItem.js';

// Constants for shelf layout
const MAX_ITEMS_PER_ROW = 8;
const ITEM_WIDTH = 108;  // Base item width in pixels
const ITEM_HEIGHT = 149; // Base item height in pixels
const SHELF_PADDING_TOP = 16;
const SHELF_PADDING_BOTTOM = 50; // Space for the wood shelf texture
const ROW_GAP = 12;

export const BookshelfView = {
  oninit(vnode) {
    this.scrollTop = 0;
    this.containerHeight = 0;
    this.containerWidth = 0;
    this.itemsPerRow = MAX_ITEMS_PER_ROW;
    this.shelfHeight = ITEM_HEIGHT + SHELF_PADDING_TOP + SHELF_PADDING_BOTTOM;
    this.visibleStartRow = 0;
    this.visibleEndRow = 5;
    this.ticking = false;
    this.attrs = vnode.attrs;
    this.bufferRows = 2;
  },

  oncreate(vnode) {
    this.containerEl = vnode.dom;
    this.scrollEl = window;

    this.measureContainer();
    this.updateVisibleRange();

    // Throttled scroll handler
    this.scrollEndTimeout = null;
    this.scrollHandler = () => {
      if (this.scrollEndTimeout) {
        clearTimeout(this.scrollEndTimeout);
      }

      if (!this.ticking) {
        requestAnimationFrame(() => {
          this.updateVisibleRange();
          this.ticking = false;
        });
        this.ticking = true;
      }

      this.scrollEndTimeout = setTimeout(() => {
        this.updateVisibleRange();
        m.redraw();
      }, 100);
    };

    this.scrollEl.addEventListener('scroll', this.scrollHandler, { passive: true });

    // Resize observer for responsive layout
    this.resizeTimeout = null;
    this.containerWidth = this.containerEl.clientWidth;
    this.resizeObserver = new ResizeObserver(() => {
      const newWidth = this.containerEl.clientWidth;
      if (Math.abs(newWidth - this.containerWidth) < 5) {
        return;
      }

      if (this.resizeTimeout) {
        clearTimeout(this.resizeTimeout);
      }
      this.resizeTimeout = setTimeout(() => {
        const currentWidth = this.containerEl.clientWidth;
        if (Math.abs(currentWidth - this.containerWidth) < 5) {
          return;
        }
        this.containerWidth = currentWidth;
        this.measureContainer();
        this.updateVisibleRange();
        m.redraw();
      }, 150);
    });
    this.resizeObserver.observe(this.containerEl);
  },

  onupdate(vnode) {
    this.attrs = vnode.attrs;
  },

  onremove() {
    if (this.scrollHandler) {
      this.scrollEl.removeEventListener('scroll', this.scrollHandler);
    }
    if (this.resizeObserver) {
      this.resizeObserver.disconnect();
    }
    if (this.resizeTimeout) {
      clearTimeout(this.resizeTimeout);
    }
    if (this.scrollEndTimeout) {
      clearTimeout(this.scrollEndTimeout);
    }
  },

  measureContainer() {
    if (!this.containerEl) {
      return;
    }
    this.containerHeight = window.innerHeight;
    const width = this.containerEl.clientWidth;

    // Calculate items per row based on container width
    // Account for padding and gaps
    const availableWidth = width - 32; // 16px padding on each side
    const itemWithGap = ITEM_WIDTH + ROW_GAP;
    let itemsFit = Math.floor((availableWidth + ROW_GAP) / itemWithGap);

    // Clamp between 3 and MAX_ITEMS_PER_ROW
    this.itemsPerRow = Math.max(3, Math.min(MAX_ITEMS_PER_ROW, itemsFit));
  },

  updateVisibleRange() {
    if (!this.containerEl || !this.attrs) {
      return;
    }

    const totalCount = this.attrs.totalCount || 0;
    if (totalCount === 0) {
      this.visibleStartRow = 0;
      this.visibleEndRow = 0;
      return;
    }

    const rect = this.containerEl.getBoundingClientRect();
    const scrollTop = Math.max(0, -rect.top);

    const visibleRows = Math.ceil(this.containerHeight / this.shelfHeight) + 1;
    const scrolledRows = Math.floor(scrollTop / this.shelfHeight);

    const startRow = Math.max(0, scrolledRows - this.bufferRows);
    const totalRows = Math.ceil(totalCount / this.itemsPerRow);
    const endRow = Math.min(totalRows - 1, scrolledRows + visibleRows + this.bufferRows);

    // Convert row range to item indices for the callback
    const startIdx = startRow * this.itemsPerRow;
    const endIdx = Math.min((endRow + 1) * this.itemsPerRow - 1, totalCount - 1);

    if (this.attrs.onVisibleRangeChange) {
      const loadedCount = this.attrs.items?.filter(item => item !== undefined).length || 0;
      this.attrs.onVisibleRangeChange(startIdx, endIdx, loadedCount);
    }

    if (startRow !== this.visibleStartRow || endRow !== this.visibleEndRow) {
      this.visibleStartRow = startRow;
      this.visibleEndRow = endRow;
      m.redraw();
    }
  },

  view(vnode) {
    this.attrs = vnode.attrs;
    const { items, games, totalCount, theme, onUpdateItem, loading } = vnode.attrs;

    const totalRows = Math.ceil(totalCount / this.itemsPerRow);
    const totalHeight = totalRows * this.shelfHeight;

    // Get rows to render
    const rows = [];
    for (let rowIdx = this.visibleStartRow; rowIdx <= this.visibleEndRow; rowIdx++) {
      const startIdx = rowIdx * this.itemsPerRow;
      const endIdx = Math.min(startIdx + this.itemsPerRow, totalCount);

      const rowItems = [];
      for (let itemIdx = startIdx; itemIdx < endIdx; itemIdx++) {
        const item = items[itemIdx];
        if (item) {
          rowItems.push({
            item,
            game: games[item.gameId]
          });
        }
      }

      rows.push({
        rowIdx,
        items: rowItems,
        topOffset: rowIdx * this.shelfHeight
      });
    }

    // Check if we're viewing a range with no loaded items
    const visibleStartIdx = this.visibleStartRow * this.itemsPerRow;
    const hasVisibleItems = rows.some(row => row.items.length > 0);
    const isPastLoadedData = !hasVisibleItems && totalCount > 0 && visibleStartIdx < totalCount;

    return m('div.bookshelf-container', {
      class: `theme-${theme}`,
      style: {
        height: `${totalHeight}px`,
        position: 'relative'
      }
    }, [
      // Render visible shelf rows
      rows.map(row =>
        m('div.bookshelf-row', {
          key: row.rowIdx,
          style: {
            position: 'absolute',
            left: 0,
            right: 0,
            top: `${row.topOffset}px`,
            height: `${this.shelfHeight}px`
          }
        }, [
          m('div.bookshelf-row-items',
            row.items.map(({ item, game }) =>
              m(BookshelfItem, {
                key: item._id,
                game,
                collectionItem: item,
                onUpdateItem
              })
            )
          )
        ])
      ),

      // Loading overlay when scrolled past loaded data
      isPastLoadedData && m('div.bookshelf-loading', [
        m('div.loading'),
        m('p', 'Loading more games...')
      ])
    ]);
  }
};
