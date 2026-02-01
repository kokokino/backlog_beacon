import m from 'mithril';
import { Meteor } from 'meteor/meteor';
import { PlatformSelect } from './PlatformSelect.js';

const MAX_TITLE_LENGTH = 512;

export const CreateCustomGameModal = {
  oninit(vnode) {
    this.title = vnode.attrs.initialTitle || '';
    this.platforms = [];
    this.releaseYear = '';
    this.developer = '';
    this.summary = '';
    this.coverFile = null;
    this.coverPreview = null;
    this.saving = false;
    this.error = null;
  },

  handleCoverSelect(event) {
    const file = event.target.files[0];
    if (!file) {
      this.coverFile = null;
      this.coverPreview = null;
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
    const { onClose, onSuccess } = vnode.attrs;

    const trimmedTitle = this.title.trim();

    if (trimmedTitle.length === 0) {
      this.error = 'Title is required';
      return;
    }

    if (trimmedTitle.length > MAX_TITLE_LENGTH) {
      this.error = `Title cannot exceed ${MAX_TITLE_LENGTH} characters`;
      return;
    }

    this.saving = true;
    this.error = null;
    m.redraw();

    try {
      // Create the game
      const gameData = {
        title: trimmedTitle,
        platforms: this.platforms,
        developer: this.developer.trim() || undefined,
        summary: this.summary.trim() || undefined
      };

      // Parse release year if provided
      if (this.releaseYear.trim()) {
        const year = parseInt(this.releaseYear.trim(), 10);
        if (!isNaN(year) && year >= 1950 && year <= 2100) {
          gameData.releaseYear = year;
        }
      }

      const gameId = await Meteor.callAsync('games.createCustom', gameData);

      // Upload cover if selected
      if (this.coverFile && this.coverPreview) {
        try {
          await Meteor.callAsync('games.uploadCustomCover', gameId, this.coverPreview);
        } catch (coverError) {
          console.warn('Failed to upload cover:', coverError);
          // Don't fail the whole operation for cover upload failure
        }
      }

      if (onSuccess) {
        onSuccess(gameId);
      }
      if (onClose) {
        onClose();
      }
      m.redraw();
    } catch (err) {
      this.error = err.reason || err.message || 'Failed to create game';
      this.saving = false;
      m.redraw();
    }
  },

  view(vnode) {
    const { onClose } = vnode.attrs;
    const remainingChars = MAX_TITLE_LENGTH - this.title.length;

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
          m('h3', 'Create Custom Game')
        ]),

        this.error && m('p.error-message', this.error),

        m('form', {
          onsubmit: (event) => {
            event.preventDefault();
            this.save(vnode);
          }
        }, [
          m('label', [
            'Title *',
            m('input[type=text]', {
              value: this.title,
              maxlength: MAX_TITLE_LENGTH,
              disabled: this.saving,
              required: true,
              placeholder: 'Enter game title...',
              oninput: (event) => {
                this.title = event.target.value;
              }
            }),
            m('small.char-count', {
              class: remainingChars < 50 ? 'warning' : ''
            }, `${remainingChars} characters remaining`)
          ]),

          m(PlatformSelect, {
            value: this.platforms,
            onChange: (newValue) => {
              this.platforms = newValue;
            },
            disabled: this.saving,
            label: 'Platforms',
            gamePlatforms: []
          }),

          m('label', [
            'Release Year',
            m('input[type=number]', {
              value: this.releaseYear,
              min: 1950,
              max: 2100,
              disabled: this.saving,
              placeholder: 'e.g., 2024',
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
              placeholder: 'Developer name...',
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
              rows: 3,
              maxlength: 2000,
              disabled: this.saving,
              placeholder: 'Brief description of the game...',
              oninput: (event) => {
                this.summary = event.target.value;
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
            }, this.saving ? 'Creating...' : 'Create Game')
          ])
        ])
      ])
    ]);
  }
};
