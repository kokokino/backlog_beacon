/**
 * BeanstalkView.js - Main Mithril component wrapping Babylon.js
 */

import m from 'mithril';
import { BeanstalkScene } from './BeanstalkScene.js';
import { BeanstalkScrollbar } from './BeanstalkScrollbar.js';
import { VIEW_MODES } from '../ViewModeSelector.js';
import { PositionIndicator } from '../PositionIndicator.js';

export const BeanstalkView = {
  oninit(vnode) {
    this.scene = null;
    this.visibleStart = 1;
    this.visibleEnd = 1;
    this.roosterVisible = false;
  },

  oncreate(vnode) {
    const canvas = vnode.dom.querySelector('canvas');
    if (!canvas) {
      console.error('BeanstalkView: canvas not found');
      return;
    }

    this.scene = new BeanstalkScene(canvas, {
      onGameSelect: (index) => {
        const item = vnode.attrs.items[index];
        if (item && vnode.attrs.onUpdateItem) {
          vnode.attrs.onUpdateItem(item);
        }
      },
      onVisibleRangeChange: (start, end) => {
        this.visibleStart = start + 1;  // Convert to 1-indexed
        this.visibleEnd = end + 1;
        if (vnode.attrs.onVisibleRangeChange) {
          vnode.attrs.onVisibleRangeChange(start, end, vnode.attrs.items.length);
        }
        m.redraw();
      },
      onRequestData: (fromIndex) => {
        // Trigger data loading for this index range
        if (vnode.attrs.onVisibleRangeChange) {
          const endIndex = Math.min(fromIndex + 100, vnode.attrs.totalCount);
          vnode.attrs.onVisibleRangeChange(fromIndex, endIndex, vnode.attrs.items.length);
        }
      },
      onRoosterVisibilityChange: (visible) => {
        this.roosterVisible = visible;
        m.redraw();
      }
    });

    // Initial data sync
    this.syncDataToScene(vnode.attrs);
  },

  onupdate(vnode) {
    this.syncDataToScene(vnode.attrs);
  },

  onremove(vnode) {
    if (this.scene) {
      this.scene.disposeAsync(); // Fire-and-forget
      this.scene = null;
    }
  },

  syncDataToScene(attrs) {
    if (this.scene && attrs.items) {
      this.scene.setData(attrs.items, attrs.totalCount);
    }
  },

  view(vnode) {
    const { totalCount, onModeChange } = vnode.attrs;

    return m('div.beanstalk-container', [
      m('canvas.beanstalk-canvas', { tabindex: 0 }),

      m('div.beanstalk-hud', [
        // Exit button
        m('button.beanstalk-exit-btn', {
          onclick: () => onModeChange(VIEW_MODES.INFINITE)
        }, 'Exit 3D'),

        // Position indicator
        totalCount > 0 && m(PositionIndicator, {
          start: this.visibleStart,
          end: Math.min(this.visibleEnd, totalCount),
          total: totalCount,
          loading: false
        }),

        // Instructions overlay (shown briefly, device-aware)
        m('div.beanstalk-instructions',
          ('ontouchstart' in window || navigator.maxTouchPoints > 0)
            ? [
                m('p', 'Swipe to climb'),
                m('p', 'Pinch to zoom \u2022 Two fingers to pan'),
                m('p', 'Tap a game to view')
              ]
            : [
                m('p', 'Scroll to climb'),
                m('p', 'Ctrl+Scroll to zoom \u2022 Shift+Scroll to pan'),
                m('p', 'Click a game to edit')
              ]
        ),

        // Scrollbar for quick navigation
        totalCount > 0 && m(BeanstalkScrollbar, {
          currentIndex: this.visibleStart - 1,  // Convert back to 0-indexed
          visibleCount: Math.max(1, this.visibleEnd - this.visibleStart + 1),
          totalCount: totalCount,
          onSeek: (targetIndex) => {
            if (this.scene) {
              this.scene.scrollToIndex(targetIndex);
            }
          }
        }),

        // Rooster model attribution (only shown when rooster is visible)
        this.roosterVisible && m('a.beanstalk-attribution', {
          href: 'https://sketchfab.com/Enkarra',
          target: '_blank',
          rel: 'noopener noreferrer'
        }, 'Rooster by Enkarra')
      ])
    ]);
  }
};
