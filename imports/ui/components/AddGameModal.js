import m from 'mithril';
import { Meteor } from 'meteor/meteor';
import { COLLECTION_STATUSES, STATUS_LABELS } from '../../lib/collections/collectionItems.js';
import { PlatformSelect } from './PlatformSelect.js';
import { StorefrontSelect } from './StorefrontSelect.js';

export const AddGameModal = {
  oninit(vnode) {
    this.game = vnode.attrs.game;
    this.platforms = [];
    this.storefronts = [];
    this.status = COLLECTION_STATUSES.BACKLOG;
    this.notes = '';
    this.saving = false;
    this.error = null;
  },
  
  async save(vnode) {
    const { onClose, onSuccess } = vnode.attrs;
    
    if (this.platforms.length === 0) {
      this.error = 'Please select at least one platform';
      return;
    }
    
    this.saving = true;
    this.error = null;
    m.redraw();
    
    try {
      await Meteor.callAsync('collection.addItem', this.game._id, this.platforms[0], this.status, {
        platforms: this.platforms,
        storefronts: this.storefronts,
        notes: this.notes
      });
      
      if (onSuccess) {
        onSuccess();
      }
      if (onClose) {
        onClose();
      }
    } catch (err) {
      this.error = err.reason || err.message || 'Failed to add game';
      this.saving = false;
      m.redraw();
    }
  },
  
  view(vnode) {
    const { onClose } = vnode.attrs;
    const game = this.game;
    
    if (!game) {
      return null;
    }
    
    return m('dialog[open]', { 
      onclick(event) {
        if (event.target.tagName === 'DIALOG') {
          onClose();
        }
      }
    }, [
      m('article', [
        m('header', [
          m('button.close', { 
            'aria-label': 'Close',
            onclick: onClose 
          }),
          m('h3', 'Add to Collection')
        ]),
        
        m('p', [
          m('strong', game.title || game.name),
          game.releaseYear && m('span', ` (${game.releaseYear})`)
        ]),
        
        this.error && m('p.error-message', this.error),
        
        m('form', {
          onsubmit: (event) => {
            event.preventDefault();
            this.save(vnode);
          }
        }, [
          m(PlatformSelect, {
            value: this.platforms,
            onChange: (newValue) => {
              this.platforms = newValue;
            },
            disabled: this.saving,
            label: 'Platforms',
            gamePlatforms: game.platforms || []
          }),
          
          m(StorefrontSelect, {
            value: this.storefronts,
            onChange: (newValue) => {
              this.storefronts = newValue;
            },
            disabled: this.saving,
            label: 'Purchased From'
          }),
          
          m('label', [
            'Status',
            m('select', {
              value: this.status,
              disabled: this.saving,
              onchange: (event) => {
                this.status = event.target.value;
              }
            }, Object.entries(STATUS_LABELS).map(([value, label]) =>
              m('option', { value }, label)
            ))
          ]),
          
          m('label', [
            'Notes',
            m('textarea', {
              value: this.notes,
              rows: 2,
              maxlength: 10000,
              disabled: this.saving,
              placeholder: 'Optional notes...',
              oninput: (event) => {
                this.notes = event.target.value;
              }
            })
          ]),
          
          m('footer', [
            m('button.secondary', {
              type: 'button',
              onclick: onClose,
              disabled: this.saving
            }, 'Cancel'),
            m('button', {
              type: 'submit',
              disabled: this.saving,
              'aria-busy': this.saving
            }, this.saving ? 'Adding...' : 'Add to Collection')
          ])
        ])
      ])
    ]);
  }
};
