/**
 * BeanstalkScrollbar.js - Draggable vertical scrollbar for quick navigation
 */

import m from 'mithril';

export const BeanstalkScrollbar = {
  oninit(vnode) {
    this.isDragging = false;
    this.trackElement = null;
  },

  oncreate(vnode) {
    if (!vnode.dom) {
      return;
    }
    this.trackElement = vnode.dom.querySelector('.beanstalk-scrollbar-track');

    // Bind methods for event listeners
    this.onPointerMove = this.handlePointerMove.bind(this, vnode);
    this.onPointerUp = this.handlePointerUp.bind(this, vnode);

    // Add global listeners for drag handling
    document.addEventListener('pointermove', this.onPointerMove);
    document.addEventListener('pointerup', this.onPointerUp);
  },

  onremove(vnode) {
    if (this.onPointerMove) {
      document.removeEventListener('pointermove', this.onPointerMove);
    }
    if (this.onPointerUp) {
      document.removeEventListener('pointerup', this.onPointerUp);
    }
  },

  handlePointerDown(vnode, event) {
    event.preventDefault();
    event.stopPropagation();
    this.isDragging = true;

    // Immediately seek to clicked position
    this.seekToPosition(vnode, event.clientY);
  },

  handlePointerMove(vnode, event) {
    if (!this.isDragging) {
      return;
    }
    event.preventDefault();
    this.seekToPosition(vnode, event.clientY);
  },

  handlePointerUp(vnode, event) {
    if (this.isDragging) {
      this.isDragging = false;
      m.redraw();
    }
  },

  seekToPosition(vnode, clientY) {
    if (!this.trackElement) {
      return;
    }

    const rect = this.trackElement.getBoundingClientRect();
    const { totalCount, visibleCount } = vnode.attrs;

    // Calculate position as ratio (0 = top, 1 = bottom)
    let ratio = (clientY - rect.top) / rect.height;
    ratio = Math.max(0, Math.min(1, ratio));

    // Convert to game index
    const maxIndex = Math.max(0, totalCount - visibleCount);
    const targetIndex = Math.round((1 - ratio) * maxIndex);

    if (vnode.attrs.onSeek) {
      vnode.attrs.onSeek(targetIndex);
    }
  },

  view(vnode) {
    const { currentIndex, visibleCount, totalCount } = vnode.attrs;

    // Don't render if not enough items to scroll
    if (totalCount <= visibleCount) {
      return null;
    }

    // Calculate thumb size and position
    const thumbRatio = Math.min(1, visibleCount / totalCount);
    const thumbHeight = Math.max(40, thumbRatio * 100); // Min 40px, percentage of track

    const maxIndex = Math.max(1, totalCount - visibleCount);
    const positionRatio = currentIndex / maxIndex;
    const thumbTop = (1 - positionRatio) * (100 - thumbHeight);

    return m('div.beanstalk-scrollbar', {
      class: this.isDragging ? 'dragging' : ''
    }, [
      m('div.beanstalk-scrollbar-track', {
        onpointerdown: (event) => this.handlePointerDown(vnode, event)
      }, [
        m('div.beanstalk-scrollbar-thumb', {
          style: {
            height: thumbHeight + '%',
            top: thumbTop + '%'
          }
        })
      ])
    ]);
  }
};
