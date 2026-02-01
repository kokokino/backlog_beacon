import m from 'mithril';
import { Meteor } from 'meteor/meteor';
import { COLLECTION_STATUSES, STATUS_LABELS } from '../../lib/collections/collectionItems.js';
import { PlatformSelect } from './PlatformSelect.js';
import { StorefrontSelect } from './StorefrontSelect.js';

const MAX_TITLE_LENGTH = 512;

export const EditCustomGameModal = {
  oninit(vnode) {
    const { game, collectionItem } = vnode.attrs;

    // Game fields
    this.title = game?.title || '';
    this.gamePlatforms = game?.platforms || [];
    this.releaseYear = game?.releaseYear?.toString() || '';
    this.developer = game?.developer || '';
    this.summary = game?.summary || '';
    this.coverPreview = game?.localCoverUrl || null;
    this.coverFile = null;
    this.coverChanged = false;

    // Collection item fields
    this.itemPlatforms = collectionItem?.platforms || [];
    this.storefronts = collectionItem?.storefronts || [];
    this.status = collectionItem?.status || COLLECTION_STATUSES.BACKLOG;
    this.rating = collectionItem?.rating || null;
    this.hoursPlayed = collectionItem?.hoursPlayed || '';
    this.notes = collectionItem?.notes || '';
    this.favorite = collectionItem?.favorite || false;
    this.physical = collectionItem?.physical || false;

    this.saving = false;
    this.error = null;
  },

  handleCoverSelect(event) {
    const file = event.target.files[0];
    if (!file) {
      return;
    }

    // Validate file type
    if (!file.type.startsWith('image/')) {
      this.error = 'Please select an image file';
      event.target.value = '';
      return;
    }

    // Validate file size (2MB max)
    if (file.size > 2 * 1024 * 1024) {
      this.error = 'Image must be less than 2MB';
      event.target.value = '';
      return;
    }

    this.coverFile = file;
    this.coverChanged = true;
    this.error = null;

    // Create preview
    const reader = new FileReader();
    reader.onload = (e) => {
      this.coverPreview = e.target.result;
      m.redraw();
    };
    reader.readAsDataURL(file);
  },

  async save(vnode) {
    const { game, collectionItem, onClose, onSuccess } = vnode.attrs;

    const trimmedTitle = this.title.trim();

    if (trimmedTitle.length === 0) {
      this.error = 'Title is required';
      return;
    }

    if (trimmedTitle.length > MAX_TITLE_LENGTH) {
      this.error = `Title cannot exceed ${MAX_TITLE_LENGTH} characters`;
      return;
    }

    if (this.itemPlatforms.length === 0) {
      this.error = 'Please select at least one platform';
      return;
    }

    this.saving = true;
    this.error = null;
    m.redraw();

    try {
      // Update game details
      const gameUpdates = {
        title: trimmedTitle,
        platforms: this.gamePlatforms,
        developer: this.developer.trim(),
        summary: this.summary.trim()
      };

      // Parse release year if provided
      if (this.releaseYear.trim()) {
        const year = parseInt(this.releaseYear.trim(), 10);
        if (!isNaN(year) && year >= 1950 && year <= 2100) {
          gameUpdates.releaseYear = year;
        } else {
          gameUpdates.releaseYear = null;
        }
      } else {
        gameUpdates.releaseYear = null;
      }

      await Meteor.callAsync('games.updateCustom', game._id, gameUpdates);

      // Upload cover if changed
      if (this.coverChanged && this.coverFile && this.coverPreview) {
        try {
          await Meteor.callAsync('games.uploadCustomCover', game._id, this.coverPreview);
        } catch (coverError) {
          console.warn('Failed to upload cover:', coverError);
        }
      }

      // Build item updates (defined outside if block so it's accessible for onSuccess)
      let itemUpdates = null;

      // Update collection item if it exists
      if (collectionItem) {
        itemUpdates = {
          status: this.status,
          rating: this.rating,
          hoursPlayed: this.hoursPlayed ? parseFloat(this.hoursPlayed) : null,
          notes: this.notes,
          favorite: this.favorite,
          physical: this.physical,
          storefronts: this.storefronts,
          platforms: this.itemPlatforms
        };

        if (this.status === COLLECTION_STATUSES.COMPLETED && collectionItem.status !== COLLECTION_STATUSES.COMPLETED) {
          itemUpdates.dateCompleted = new Date();
        }

        if (this.status === COLLECTION_STATUSES.PLAYING && !collectionItem.dateStarted) {
          itemUpdates.dateStarted = new Date();
        }

        await Meteor.callAsync('collection.updateItem', collectionItem._id, itemUpdates);
      }

      if (onSuccess) {
        onSuccess(collectionItem?._id, itemUpdates, game._id, gameUpdates);
      }
      if (onClose) {
        onClose();
      }
      m.redraw();
    } catch (err) {
      this.error = err.reason || err.message || 'Failed to save changes';
      this.saving = false;
      m.redraw();
    }
  },

  view(vnode) {
    const { game, collectionItem, onClose } = vnode.attrs;
    const remainingChars = MAX_TITLE_LENGTH - this.title.length;

    if (!game) {
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
            }, '\u2605'.repeat(num))
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
          m('h3', 'Edit Custom Game')
        ]),

        m('span.badge.custom-badge', 'Custom'),

        this.error && m('p.error-message', this.error),

        m('form', {
          onsubmit: (event) => {
            event.preventDefault();
            this.save(vnode);
          }
        }, [
          // Game Details Section
          m('fieldset', [
            m('legend', 'Game Details'),

            m('label', [
              'Title *',
              m('input[type=text]', {
                value: this.title,
                maxlength: MAX_TITLE_LENGTH,
                disabled: this.saving,
                required: true,
                oninput: (event) => {
                  this.title = event.target.value;
                }
              }),
              m('small.char-count', {
                class: remainingChars < 50 ? 'warning' : ''
              }, `${remainingChars} characters remaining`)
            ]),

            m(PlatformSelect, {
              value: this.gamePlatforms,
              onChange: (newValue) => {
                this.gamePlatforms = newValue;
              },
              disabled: this.saving,
              label: 'Game Platforms',
              gamePlatforms: []
            }),

            m('label', [
              'Release Year',
              m('input[type=number]', {
                value: this.releaseYear,
                min: 1950,
                max: 2100,
                disabled: this.saving,
                oninput: (event) => {
                  this.releaseYear = event.target.value;
                }
              })
            ]),

            m('label', [
              'Developer',
              m('input[type=text]', {
                value: this.developer,
                disabled: this.saving,
                oninput: (event) => {
                  this.developer = event.target.value;
                }
              })
            ]),

            m('label', [
              'Cover Image',
              m('div.cover-upload', [
                m('input[type=file]', {
                  accept: 'image/*',
                  disabled: this.saving,
                  onchange: (event) => this.handleCoverSelect(event)
                }),
                this.coverPreview && m('div.cover-preview', [
                  m('img', {
                    src: this.coverPreview,
                    alt: 'Cover preview'
                  })
                ])
              ])
            ]),

            m('label', [
              'Summary',
              m('textarea', {
                value: this.summary,
                rows: 2,
                maxlength: 2000,
                disabled: this.saving,
                oninput: (event) => {
                  this.summary = event.target.value;
                }
              })
            ])
          ]),

          // Collection Details Section (only if in collection)
          collectionItem && m('fieldset', [
            m('legend', 'Collection Details'),

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
              value: this.itemPlatforms,
              onChange: (newValue) => {
                this.itemPlatforms = newValue;
              },
              disabled: this.saving,
              label: 'Your Platforms',
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

            m('div.checkbox-row', [
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
