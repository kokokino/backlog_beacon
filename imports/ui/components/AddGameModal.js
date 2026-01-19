import m from 'mithril';
import { Meteor } from 'meteor/meteor';
import { COLLECTION_STATUSES, STATUS_LABELS } from '../../lib/collections/collectionItems.js';

export const AddGameModal = {
  oninit(vnode) {
    this.game = vnode.attrs.game;
    this.platform = this.game?.platforms?.[0] || '';
    this.status = COLLECTION_STATUSES.BACKLOG;
    this.saving = false;
    this.error = null;
  },
  
  async save(vnode) {
    const { onClose, onSuccess } = vnode.attrs;
    
    if (!this.platform) {
      this.error = 'Please select a platform';
      return;
    }
    
    this.saving = true;
    this.error = null;
    m.redraw();
    
    try {
      await Meteor.callAsync('collection.addItem', this.game._id, this.platform, this.status);
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
          m('strong', game.title),
          game.releaseYear && m('span', ` (${game.releaseYear})`)
        ]),
        
        this.error && m('p.error-message', this.error),
        
        m('form', {
          onsubmit: (event) => {
            event.preventDefault();
            this.save(vnode);
          }
        }, [
          m('label', [
            'Platform',
            m('select', {
              value: this.platform,
              disabled: this.saving,
              onchange: (event) => {
                this.platform = event.target.value;
              }
            }, [
              m('option', { value: '' }, '-- Select Platform --'),
              ...(game.platforms || []).map(platform => 
                m('option', { value: platform }, platform)
              )
            ])
          ]),
          
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
