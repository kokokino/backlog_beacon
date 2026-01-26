import m from 'mithril';
import { GameCard } from './GameCard.js';

export const VirtualScrollGrid = {
  oninit(vnode) {
    this.scrollTop = 0;
    this.containerHeight = 0;
    this.containerWidth = 0;      // Track width to detect real resizes
    this.itemHeight = 0;          // Will be measured from actual items
    this.rowGap = 24;             // 1.5rem gap
    this.itemsPerRow = 4;         // Recalculated on resize
    this.minBufferItems = 12;     // Minimum items to buffer above/below viewport
    this.visibleStartIndex = 0;
    this.visibleEndIndex = 23;    // Initial visible range
    this.ticking = false;
    this.attrs = vnode.attrs;
    this.measured = false;
    this.isResizing = false;      // Prevent resize feedback loops
    this.prevItemCount = 0;       // Track item count for change detection
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

    // Throttled scroll with rAF + scroll end detection
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

      // Set a timeout to catch scroll end (for fast scrollbar drags)
      this.scrollEndTimeout = setTimeout(() => {
        this.updateVisibleRange();
        m.redraw();
      }, 100);
    };

    this.scrollEl.addEventListener('scroll', this.scrollHandler, { passive: true });

    // ResizeObserver for responsive grid (debounced to avoid jank during resize)
    this.resizeTimeout = null;
    this.containerWidth = this.containerEl.clientWidth;
    this.resizeObserver = new ResizeObserver(() => {
      // Prevent feedback loops - only respond to actual width changes
      const newWidth = this.containerEl.clientWidth;
      if (Math.abs(newWidth - this.containerWidth) < 5) {
        return;  // Width didn't really change, ignore
      }

      if (this.resizeTimeout) {
        clearTimeout(this.resizeTimeout);
      }
      this.resizeTimeout = setTimeout(() => {
        // Double-check width still different (might have changed back during debounce)
        const currentWidth = this.containerEl.clientWidth;
        if (Math.abs(currentWidth - this.containerWidth) < 5) {
          return;
        }
        this.containerWidth = currentWidth;

        const oldItemsPerRow = this.itemsPerRow;

        this.measureContainer();
        this.measureItemHeight();

        // If itemsPerRow changed, reset visible range to align with new grid
        if (oldItemsPerRow !== this.itemsPerRow) {
          // Calculate which row we were viewing (approximately)
          const currentRow = Math.floor(this.visibleStartIndex / oldItemsPerRow);
          // Realign to new grid
          this.visibleStartIndex = currentRow * this.itemsPerRow;
          this.visibleEndIndex = this.visibleStartIndex + (this.itemsPerRow * 8) - 1;
          // Reset measured flag to re-measure item height with new layout
          this.measured = false;
        }

        this.updateVisibleRange();
        m.redraw();
      }, 150);  // 150ms debounce
    });
    this.resizeObserver.observe(this.containerEl);
  },

  onupdate(vnode) {
    this.attrs = vnode.attrs;
    const currentItemCount = vnode.attrs.items?.length || 0;

    // Re-measure if we haven't yet and items are available
    if (!this.measured && currentItemCount > 0) {
      requestAnimationFrame(() => {
        this.measureItemHeight();
        this.updateVisibleRange();
        m.redraw();
      });
    }

    // When items count changes (data arrived), update visible range
    // This ensures we continue loading if scrolled past loaded data
    if (currentItemCount !== this.prevItemCount) {
      this.prevItemCount = currentItemCount;
      // Clear any pending update to avoid stacking
      if (this.itemChangeTimeout) {
        clearTimeout(this.itemChangeTimeout);
      }
      // Use setTimeout to run after current render cycle completes
      this.itemChangeTimeout = setTimeout(() => {
        this.updateVisibleRange();
        m.redraw();
      }, 0);
    }
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
    if (this.itemChangeTimeout) {
      clearTimeout(this.itemChangeTimeout);
    }
  },

  measureContainer() {
    if (!this.containerEl) {
      return;
    }
    this.containerHeight = window.innerHeight;

    // Measure actual items per row from the DOM by checking item positions
    const cards = this.containerEl.querySelectorAll('.game-card');
    if (cards.length >= 2) {
      const firstCardTop = cards[0].getBoundingClientRect().top;
      let itemsInFirstRow = 1;
      for (let i = 1; i < cards.length; i++) {
        if (Math.abs(cards[i].getBoundingClientRect().top - firstCardTop) < 5) {
          itemsInFirstRow++;
        } else {
          break;
        }
      }
      this.itemsPerRow = itemsInFirstRow;
    } else if (cards.length === 1) {
      // Only one card, estimate based on container width
      const cardWidth = cards[0].getBoundingClientRect().width;
      const containerWidth = this.containerEl.clientWidth;
      const gap = 24;
      this.itemsPerRow = Math.max(1, Math.floor((containerWidth + gap) / (cardWidth + gap)));
    } else {
      // No cards yet, use fallback
      const width = this.containerEl.clientWidth;
      const minItemWidth = 200;  // More conservative estimate
      const gap = 24;
      this.itemsPerRow = Math.max(1, Math.floor((width + gap) / (minItemWidth + gap)));
    }
  },

  measureItemHeight() {
    if (!this.containerEl) {
      return;
    }

    // Find game cards and measure actual row height from positions
    const cards = this.containerEl.querySelectorAll('.game-card');
    if (cards.length >= 2) {
      // Find two cards on different rows to measure actual row height (including gap)
      const firstCardRect = cards[0].getBoundingClientRect();
      this.itemHeight = firstCardRect.height;

      // Find the first card on the second row
      for (let i = 1; i < cards.length; i++) {
        const cardRect = cards[i].getBoundingClientRect();
        if (cardRect.top > firstCardRect.bottom) {
          // This card is on a new row - measure the actual gap
          this.rowGap = cardRect.top - firstCardRect.bottom;
          break;
        }
      }
      this.measured = true;
    } else if (cards.length === 1) {
      const rect = cards[0].getBoundingClientRect();
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

    // Dynamic buffer: ensure at least minBufferItems above and below
    // This adapts to different screen widths (fewer items per row = more buffer rows needed)
    const bufferRows = Math.max(2, Math.ceil(this.minBufferItems / this.itemsPerRow));

    const startRow = Math.max(0, scrolledRows - bufferRows);
    const totalRows = Math.ceil(totalCount / this.itemsPerRow);
    const endRow = Math.min(totalRows - 1, scrolledRows + visibleRows + bufferRows);

    const newStartIndex = startRow * this.itemsPerRow;
    // Always end on a complete row (unless it's the actual last row)
    const newEndIndex = Math.min(
      (endRow + 1) * this.itemsPerRow - 1,
      totalCount - 1
    );

    // Always call the callback to update position indicator and trigger prefetch
    if (this.attrs.onVisibleRangeChange) {
      // console.log('[VirtualScroll] Visible range:', newStartIndex, '-', newEndIndex, 'loaded:', loadedCount, 'total:', totalCount);
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
    // Total height: all rows with gaps between them, but no gap after the last row
    const totalHeight = totalRows > 0
      ? (totalRows * itemHeight) + ((totalRows - 1) * this.rowGap)
      : 0;

    // Calculate slice bounds
    const sliceStart = Math.max(0, this.visibleStartIndex);
    let sliceEnd = Math.min(this.visibleEndIndex + 1, items.length);

    // Extend sliceEnd to complete the current row (if we have more items loaded)
    const itemsInLastRow = sliceEnd % this.itemsPerRow;
    if (itemsInLastRow > 0 && sliceEnd < items.length) {
      const itemsNeededToCompleteRow = this.itemsPerRow - itemsInLastRow;
      sliceEnd = Math.min(sliceEnd + itemsNeededToCompleteRow, items.length);
    }

    // Get items from the slice and filter out undefined entries (sparse array gaps)
    const rawSlice = sliceStart < items.length ? items.slice(sliceStart, sliceEnd) : [];
    const visibleItems = rawSlice.filter(item => item !== undefined);

    // Check if scrolled to a range with no loaded items yet
    const isPastLoadedData = visibleItems.length === 0 && totalCount > 0 && sliceStart < totalCount;

    const startRow = Math.floor(this.visibleStartIndex / this.itemsPerRow);
    const topOffset = startRow * rowHeight;

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

      // Loading overlay when scrolled past loaded data
      isPastLoadedData && m('div.virtual-scroll-loading', [
        m('div.loading'),
        m('p', 'Loading more games...')
      ])
    ]);
  }
};
