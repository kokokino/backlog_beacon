import m from 'mithril';
import { Meteor } from 'meteor/meteor';
import { Tracker } from 'meteor/tracker';
import { Storefronts, STOREFRONT_CATEGORIES } from '../../lib/collections/storefronts.js';
import { DEFAULT_STOREFRONTS } from '../../lib/constants/storefronts.js';

// Multi-select storefront component with chips and dropdown
export const StorefrontSelect = {
  oninit(vnode) {
    this.isOpen = false;
    this.storefronts = [];
    this.subscription = null;
    this.computation = null;
    
    this.loadStorefronts();
  },
  
  oncreate(vnode) {
    // Close dropdown when clicking outside
    this.handleClickOutside = (event) => {
      const element = vnode.dom;
      if (element && !element.contains(event.target)) {
        this.isOpen = false;
        m.redraw();
      }
    };
    document.addEventListener('click', this.handleClickOutside);
    
    // Subscribe to storefronts
    this.subscription = Meteor.subscribe('storefronts');
    
    this.computation = Tracker.autorun(() => {
      if (this.subscription.ready()) {
        this.loadStorefronts();
        m.redraw();
      }
    });
  },
  
  onremove(vnode) {
    document.removeEventListener('click', this.handleClickOutside);
    if (this.subscription) {
      this.subscription.stop();
    }
    if (this.computation) {
      this.computation.stop();
    }
  },
  
  loadStorefronts() {
    // Try to get from database first
    const dbStorefronts = Storefronts.find(
      { isActive: true },
      { sort: { sortOrder: 1 } }
    ).fetch();
    
    if (dbStorefronts.length > 0) {
      this.storefronts = dbStorefronts.map(s => ({
        id: s.storefrontId,
        name: s.name,
        category: s.category
      }));
    } else {
      // Fallback to defaults
      this.storefronts = DEFAULT_STOREFRONTS.map(s => ({
        id: s.storefrontId,
        name: s.name,
        category: s.category
      }));
    }
  },
  
  toggleStorefront(vnode, storefrontId) {
    const { value = [], onChange, disabled } = vnode.attrs;
    
    if (disabled) {
      return;
    }
    
    const newValue = value.includes(storefrontId)
      ? value.filter(id => id !== storefrontId)
      : [...value, storefrontId];
    
    if (onChange) {
      onChange(newValue);
    }
  },
  
  removeStorefront(vnode, storefrontId, event) {
    event.stopPropagation();
    const { value = [], onChange, disabled } = vnode.attrs;
    
    if (disabled) {
      return;
    }
    
    const newValue = value.filter(id => id !== storefrontId);
    
    if (onChange) {
      onChange(newValue);
    }
  },
  
  getStorefrontName(storefrontId) {
    const storefront = this.storefronts.find(s => s.id === storefrontId);
    return storefront ? storefront.name : storefrontId;
  },
  
  getStorefrontsByCategory() {
    const grouped = {};
    
    for (const category of STOREFRONT_CATEGORIES) {
      const categoryStorefronts = this.storefronts.filter(s => s.category === category.categoryId);
      if (categoryStorefronts.length > 0) {
        grouped[category.categoryId] = {
          name: category.name,
          storefronts: categoryStorefronts
        };
      }
    }
    
    return grouped;
  },
  
  view(vnode) {
    const { value = [], disabled = false, label = 'Storefronts' } = vnode.attrs;
    const groupedStorefronts = this.getStorefrontsByCategory();
    
    return m('div.storefront-select', { class: disabled ? 'disabled' : '' }, [
      label && m('label.storefront-label', label),
      
      m('div.storefront-input-container', {
        onclick: () => {
          if (!disabled) {
            this.isOpen = !this.isOpen;
          }
        }
      }, [
        // Selected chips
        m('div.storefront-chips', [
          value.length === 0 && m('span.storefront-placeholder', 'Click to select storefronts...'),
          
          value.map(storefrontId => 
            m('span.storefront-chip', {
              key: storefrontId
            }, [
              this.getStorefrontName(storefrontId),
              !disabled && m('button.chip-remove', {
                type: 'button',
                onclick: (event) => this.removeStorefront(vnode, storefrontId, event),
                'aria-label': 'Remove'
              }, '×')
            ])
          ),
          
          // Dropdown toggle
          m('span.storefront-toggle', {
            class: this.isOpen ? 'open' : ''
          }, '▼')
        ])
      ]),
      
      // Dropdown
      this.isOpen && m('div.storefront-dropdown', [
        Object.entries(groupedStorefronts).map(([categoryId, category]) =>
          m('div.storefront-category', { key: categoryId }, [
            m('div.category-header', category.name),
            category.storefronts.map(storefront =>
              m('label.storefront-option', {
                key: storefront.id,
                class: value.includes(storefront.id) ? 'selected' : ''
              }, [
                m('input[type=checkbox]', {
                  checked: value.includes(storefront.id),
                  disabled: disabled,
                  onchange: () => this.toggleStorefront(vnode, storefront.id)
                }),
                m('span.option-name', storefront.name)
              ])
            )
          ])
        )
      ])
    ]);
  }
};
