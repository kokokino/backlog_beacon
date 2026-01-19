import m from 'mithril';
import { Meteor } from 'meteor/meteor';
import { COLLECTION_STATUSES, STATUS_LABELS } from '../../lib/collections/collectionItems.js';
import { StorefrontSelect } from './StorefrontSelect.js';
import { PlatformSelect } from './PlatformSelect.js';

export const EditItemModal = {
  oninit(vnode) {
    const item = vnode.attrs.item;
    const game = vnode.attrs.game;
    
    this.status = item?.status || COLLECTION_STATUSES.BACKLOG;
    this.rating = item?.rating || null;
    this.hoursPlayed = item?.hoursPlayed || '';
    this.notes = item?.notes || '';
    this.favorite = item?.favorite || false;
    this.physical = item?.physical || false;
    this.storefronts = item?.storefronts || [];
    
    // Handle platforms - support both old single platform and new array format
    if (item?.platforms && item.platforms.length > 0) {
      this.platforms = [...item.platforms];
    } else if (item?.platform) {
      this.platforms = [item.platform];
    } else {
      this.platforms = [];
    }
    
    // Store game platforms for suggestions
    this.gamePlatforms = game?.platforms || [];
    
    this.saving = false;
    this.error = null;
  },
  
  async save(vnode) {
    const { item, onClose, onSuccess } = vnode.attrs;
    
    if (this.platforms.length === 0) {
      this.error = 'Please select at least one platform';
      return;
    }
    
    this.saving = true;
    this.error = null;
    m.redraw();
    
    const updates = {
      status: this.status,
      rating: this.rating,
      hoursPlayed: this.hoursPlayed ? parseFloat(this.hoursPlayed) : null,
      notes: this.notes,
      favorite: this.favorite,
      physical: this.physical,
      storefronts: this.storefronts,
      platforms: this.platforms,
      platform: this.platforms[0] || ''
    };
    
    if (this.status === COLLECTION_STATUSES.COMPLETED && item.status !== COLLECTION_STATUSES.COMPLETED) {
      updates.dateCompleted = new Date();
    }
    
    if (this.status === COLLECTION_STATUSES.PLAYING && !item.dateStarted) {
      updates.dateStarted = new Date();
    }
    
    try {
      await Meteor.callAsync('collection.updateItem', item._id, updates);
      if (onSuccess) {
        onSuccess();
      }
      if (onClose) {
        onClose();
      }
    } catch (err) {
      this.error = err.reason || err.message || 'Failed to update item';
      this.saving = false;
      m.redraw();
    }
  },
  
  view(vnode) {
    const { item, game, onClose } = vnode.attrs;
    
    if (!item) {
      return null;
    }
    
    const renderRatingSelect = () => {
      return m('div.rating-select', [
        m('label', 'Rating'),
        m('div.star-buttons', [
          m('button.star-btn', {
            type: 'button',
            class: this.rating === null ? 'selected' : '',
            onclick: () => { this.rating = null; }
          }, 'None'),
          [1, 2, 3, 4, 5].map(num =>
            m('button.star-btn', {
              type: 'button',
              class: this.rating === num ? 'selected' : '',
              onclick: () => { this.rating = num; }
            }, '★'.repeat(num))
          )
        ])
      ]);
    };
    
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
          m('h3', 'Edit Collection Item')
        ]),
        
        m('p', [
          m('strong', game?.title || game?.name || item?.gameName || 'Unknown Game')
        ]),
        
        this.error && m('p.error-message', this.error),
        
        m('form', {
          onsubmit: (event) => {
            event.preventDefault();
            this.save(vnode);
          }
        }, [
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
          
          m(PlatformSelect, {
            value: this.platforms,
            onChange: (newValue) => {
              this.platforms = newValue;
            },
            disabled: this.saving,
            label: 'Platforms',
            gamePlatforms: this.gamePlatforms
          }),
          
          renderRatingSelect(),
          
          m('label', [
            'Hours Played',
            m('input[type=number]', {
              value: this.hoursPlayed,
              min: 0,
              step: 0.5,
              disabled: this.saving,
              oninput: (event) => {
                this.hoursPlayed = event.target.value;
              }
            })
          ]),
          
          m(StorefrontSelect, {
            value: this.storefronts,
            onChange: (newValue) => {
              this.storefronts = newValue;
            },
            disabled: this.saving,
            label: 'Purchased From'
          }),
          
          m('label', [
            'Notes',
            m('textarea', {
              value: this.notes,
              rows: 3,
              maxlength: 10000,
              disabled: this.saving,
              oninput: (event) => {
                this.notes = event.target.value;
              }
            })
          ]),
          
          m('fieldset', [
            m('label', [
              m('input[type=checkbox]', {
                checked: this.favorite,
                disabled: this.saving,
                onchange: (event) => {
                  this.favorite = event.target.checked;
                }
              }),
              ' Favorite'
            ]),
            m('label', [
              m('input[type=checkbox]', {
                checked: this.physical,
                disabled: this.saving,
                onchange: (event) => {
                  this.physical = event.target.checked;
                }
              }),
              ' Physical Copy'
            ])
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
            }, this.saving ? 'Saving...' : 'Save Changes')
          ])
        ])
      ])
    ]);
  }
};
