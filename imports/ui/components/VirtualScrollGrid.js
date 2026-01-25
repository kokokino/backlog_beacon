import m from 'mithril';
import { GameCard } from './GameCard.js';
import { PositionIndicator } from './PositionIndicator.js';

export const VirtualScrollGrid = {
  oninit(vnode) {
    this.scrollTop = 0;
    this.containerHeight = 0;
    this.itemHeight = 0;          // Will be measured from actual items
    this.rowGap = 24;             // 1.5rem gap
    this.itemsPerRow = 4;         // Recalculated on resize
    this.bufferRows = 2;          // Rows above/below viewport for smooth scroll
    this.visibleStartIndex = 0;
    this.visibleEndIndex = 23;    // Initial visible range
    this.ticking = false;
    this.attrs = vnode.attrs;
    this.measured = false;
  },

  oncreate(vnode) {
    this.containerEl = vnode.dom;
    this.scrollEl = window;

    // Measure and calculate layout
    this.measureContainer();

    // Measure actual item height after first render
    requestAnimationFrame(() => {
      this.measureItemHeight();
      this.updateVisibleRange();
      m.redraw();
    });

    // Throttled scroll with rAF
    this.scrollHandler = () => {
      if (!this.ticking) {
        requestAnimationFrame(() => {
          this.updateVisibleRange();
          this.ticking = false;
        });
        this.ticking = true;
      }
    };

    this.scrollEl.addEventListener('scroll', this.scrollHandler, { passive: true });

    // ResizeObserver for responsive grid
    this.resizeObserver = new ResizeObserver(() => {
      this.measureContainer();
      this.measureItemHeight();
      this.updateVisibleRange();
      m.redraw();
    });
    this.resizeObserver.observe(this.containerEl);
  },

  onupdate(vnode) {
    this.attrs = vnode.attrs;

    // Re-measure if we haven't yet and items are available
    if (!this.measured && vnode.attrs.items.length > 0) {
      requestAnimationFrame(() => {
        this.measureItemHeight();
        this.updateVisibleRange();
        m.redraw();
      });
    }
  },

  onremove() {
    if (this.scrollHandler) {
      this.scrollEl.removeEventListener('scroll', this.scrollHandler);
    }
    if (this.resizeObserver) {
      this.resizeObserver.disconnect();
    }
  },

  measureContainer() {
    if (!this.containerEl) {
      return;
    }
    const width = this.containerEl.clientWidth;
    const minItemWidth = 280;
    const gap = 24;
    this.itemsPerRow = Math.max(1, Math.floor((width + gap) / (minItemWidth + gap)));
    this.containerHeight = window.innerHeight;
  },

  measureItemHeight() {
    if (!this.containerEl) {
      return;
    }

    // Find the first game card and measure it
    const card = this.containerEl.querySelector('.game-card');
    if (card) {
      const rect = card.getBoundingClientRect();
      this.itemHeight = rect.height;
      this.measured = true;
    } else {
      // Fallback estimate if no card rendered yet
      this.itemHeight = 450;
    }
  },

  updateVisibleRange() {
    if (!this.containerEl || !this.attrs) {
      return;
    }

    // Use fallback height if not measured
    const itemHeight = this.itemHeight || 450;
    const rowHeight = itemHeight + this.rowGap;
    const totalCount = this.attrs.totalCount || 0;
    const loadedCount = this.attrs.items?.length || 0;

    if (totalCount === 0) {
      this.visibleStartIndex = 0;
      this.visibleEndIndex = 0;
      return;
    }

    const rect = this.containerEl.getBoundingClientRect();
    const scrollTop = Math.max(0, -rect.top);

    const visibleRows = Math.ceil(this.containerHeight / rowHeight);
    const scrolledRows = Math.floor(scrollTop / rowHeight);

    const startRow = Math.max(0, scrolledRows - this.bufferRows);
    const totalRows = Math.ceil(totalCount / this.itemsPerRow);
    const endRow = Math.min(totalRows - 1, scrolledRows + visibleRows + this.bufferRows);

    const newStartIndex = startRow * this.itemsPerRow;
    const newEndIndex = Math.min(
      (endRow + 1) * this.itemsPerRow - 1,
      totalCount - 1
    );

    // Always trigger prefetch check, not just on range change
    // Check if we're approaching the edge of loaded data
    if (this.attrs.onVisibleRangeChange && loadedCount < totalCount) {
      console.log('[VirtualScroll] Visible range:', newStartIndex, '-', newEndIndex, 'loaded:', loadedCount, 'total:', totalCount);
      this.attrs.onVisibleRangeChange(newStartIndex, newEndIndex, loadedCount);
    }

    // Only trigger redraw if range actually changed
    if (newStartIndex !== this.visibleStartIndex || newEndIndex !== this.visibleEndIndex) {
      this.visibleStartIndex = newStartIndex;
      this.visibleEndIndex = newEndIndex;
      m.redraw();
    }
  },

  view(vnode) {
    this.attrs = vnode.attrs;
    const { items, games, totalCount, onUpdateItem, onRemoveItem, loading } = vnode.attrs;

    // Use fallback height if not measured
    const itemHeight = this.itemHeight || 450;
    const rowHeight = itemHeight + this.rowGap;
    const totalRows = Math.ceil(totalCount / this.itemsPerRow);
    const totalHeight = totalRows * rowHeight;

    const startRow = Math.floor(this.visibleStartIndex / this.itemsPerRow);
    const topOffset = startRow * rowHeight;

    // Slice visible items from the loaded data
    const sliceStart = Math.max(0, this.visibleStartIndex);
    const sliceEnd = Math.min(this.visibleEndIndex + 1, items.length);
    const visibleItems = items.slice(sliceStart, sliceEnd);

    // Calculate actual displayed range for position indicator
    // Show position within totalCount, not just loaded items
    const displayStart = totalCount > 0 ? this.visibleStartIndex + 1 : 0;
    const displayEnd = Math.min(this.visibleEndIndex + 1, totalCount);

    return m('div.virtual-scroll-container', {
      style: {
        height: `${totalHeight}px`,
        position: 'relative',
        willChange: 'contents'
      }
    }, [
      m('div.virtual-scroll-content', {
        style: {
          position: 'absolute',
          left: 0,
          right: 0,
          transform: `translateY(${topOffset}px)`,
          willChange: 'transform'
        }
      }, [
        m('div.collection-grid',
          visibleItems.map((item) =>
            m(GameCard, {
              key: item._id,
              game: games[item.gameId],
              collectionItem: item,
              onUpdateItem,
              onRemoveItem
            })
          )
        )
      ]),

      // Position indicator
      totalCount > 0 && m(PositionIndicator, {
        start: displayStart,
        end: displayEnd,
        total: totalCount,
        loading: loading
      })
    ]);
  }
};
