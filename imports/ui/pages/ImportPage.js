import m from 'mithril';
import { Meteor } from 'meteor/meteor';
import { Tracker } from 'meteor/tracker';
import { RequireAuth } from '../components/RequireAuth.js';
import { getStorefronts } from '../../lib/constants/storefronts.js';
import { ImportProgress } from '../../lib/collections/importProgress.js';

const TABS = {
  DARKADIA: 'darkadia',
  BACKLOG_BEACON: 'backlog_beacon',
  SIMPLE: 'simple',
  EXPORT: 'export'
};

const ImportContent = {
  oninit(vnode) {
    this.activeTab = TABS.DARKADIA;
    this.storefronts = [];
    this.loadStorefronts();
    
    // Darkadia import state
    this.darkadiaFile = null;
    this.darkadiaPreview = null;
    this.darkadiaImporting = false;
    this.darkadiaResult = null;
    this.darkadiaError = null;
    this.darkadiaOptions = {
      updateExisting: true
    };
    this.darkadiaProgress = null;
    
    // Backlog Beacon import state
    this.backlogFile = null;
    this.backlogImporting = false;
    this.backlogResult = null;
    this.backlogError = null;
    this.backlogOptions = {
      updateExisting: true
    };
    
    // Simple import state
    this.simpleGames = [{ name: '', storefront: '', platform: '' }];
    this.simpleImporting = false;
    this.simpleResult = null;
    this.simpleError = null;
    this.simpleBulkText = '';
    this.simpleInputMode = 'form';
    
    // Export state
    this.exporting = false;
    this.exportError = null;
    
    // Subscriptions
    this.progressSubscription = null;
    this.progressComputation = null;
  },
  
  oncreate(vnode) {
    // Subscribe to import progress
    this.progressSubscription = Meteor.subscribe('importProgress');
    
    // Set up reactive computation to track progress
    this.progressComputation = Tracker.autorun(() => {
      const progress = ImportProgress.findOne({ type: 'darkadia' });
      this.darkadiaProgress = progress;
      m.redraw();
    });
  },
  
  onremove(vnode) {
    if (this.progressSubscription) {
      this.progressSubscription.stop();
    }
    if (this.progressComputation) {
      this.progressComputation.stop();
    }
  },
  
  async loadStorefronts() {
    try {
      this.storefronts = getStorefronts();
      m.redraw();
    } catch (error) {
      console.error('Failed to load storefronts:', error);
    }
  },
  
  setTab(tab) {
    this.activeTab = tab;
    this.clearMessages();
  },
  
  clearMessages() {
    this.darkadiaError = null;
    this.darkadiaResult = null;
    this.darkadiaPreview = null;
    this.backlogError = null;
    this.backlogResult = null;
    this.simpleError = null;
    this.simpleResult = null;
    this.exportError = null;
  },
  
  handleDarkadiaFileSelect(event) {
    const file = event.target.files[0];
    if (file) {
      this.darkadiaFile = file;
      this.darkadiaPreview = null;
      this.darkadiaResult = null;
      this.darkadiaError = null;
      this.previewDarkadia();
    }
  },
  
  async previewDarkadia() {
    if (!this.darkadiaFile) {
      return;
    }
    
    try {
      const content = await this.readFile(this.darkadiaFile);
      this.darkadiaPreview = await Meteor.callAsync('import.previewDarkadia', content);
      m.redraw();
    } catch (error) {
      this.darkadiaError = error.reason || error.message || 'Failed to preview file';
      m.redraw();
    }
  },
  
  async importDarkadia() {
    if (!this.darkadiaFile) {
      return;
    }
    
    this.darkadiaImporting = true;
    this.darkadiaError = null;
    this.darkadiaResult = null;
    m.redraw();
    
    try {
      const content = await this.readFile(this.darkadiaFile);
      this.darkadiaResult = await Meteor.callAsync('import.darkadia', content, this.darkadiaOptions);
      this.darkadiaFile = null;
      this.darkadiaPreview = null;
      
      // Clear progress after a short delay
      setTimeout(async () => {
        try {
          await Meteor.callAsync('import.clearProgress');
        } catch (error) {
          console.error('Failed to clear progress:', error);
        }
      }, 2000);
    } catch (error) {
      this.darkadiaError = error.reason || error.message || 'Import failed';
    }
    
    this.darkadiaImporting = false;
    m.redraw();
  },
  
  handleBacklogFileSelect(event) {
    const file = event.target.files[0];
    if (file) {
      this.backlogFile = file;
      this.backlogResult = null;
      this.backlogError = null;
      m.redraw();
    }
  },
  
  async importBacklogBeacon() {
    if (!this.backlogFile) {
      return;
    }
    
    this.backlogImporting = true;
    this.backlogError = null;
    this.backlogResult = null;
    m.redraw();
    
    try {
      const content = await this.readFile(this.backlogFile);
      this.backlogResult = await Meteor.callAsync('import.backlogBeacon', content, this.backlogOptions);
      this.backlogFile = null;
    } catch (error) {
      this.backlogError = error.reason || error.message || 'Import failed';
    }
    
    this.backlogImporting = false;
    m.redraw();
  },
  
  addSimpleGame() {
    this.simpleGames.push({ name: '', storefront: '', platform: '' });
  },
  
  removeSimpleGame(index) {
    if (this.simpleGames.length > 1) {
      this.simpleGames.splice(index, 1);
    }
  },
  
  updateSimpleGame(index, field, value) {
    this.simpleGames[index][field] = value;
  },
  
  parseBulkText() {
    const lines = this.simpleBulkText.split('\n').filter(line => line.trim());
    const games = [];
    
    for (const line of lines) {
      const parts = line.split('\t').length > 1 ? line.split('\t') : line.split(',');
      const name = (parts[0] || '').trim();
      const storefront = (parts[1] || '').trim();
      const platform = (parts[2] || '').trim();
      
      if (name) {
        games.push({ name, storefront, platform });
      }
    }
    
    if (games.length > 0) {
      this.simpleGames = games;
      this.simpleInputMode = 'form';
    }
  },
  
  getValidSimpleGames() {
    return this.simpleGames.filter(game => game.name.trim() !== '');
  },
  
  async importSimple() {
    const games = this.getValidSimpleGames();
    
    if (games.length === 0) {
      this.simpleError = 'Please enter at least one game name';
      return;
    }
    
    this.simpleImporting = true;
    this.simpleError = null;
    this.simpleResult = null;
    m.redraw();
    
    try {
      this.simpleResult = await Meteor.callAsync('import.simple', games);
      this.simpleGames = [{ name: '', storefront: '', platform: '' }];
      this.simpleBulkText = '';
    } catch (error) {
      this.simpleError = error.reason || error.message || 'Import failed';
    }
    
    this.simpleImporting = false;
    m.redraw();
  },
  
  async exportCollection() {
    this.exporting = true;
    this.exportError = null;
    m.redraw();
    
    try {
      const csvContent = await Meteor.callAsync('export.collection');
      this.downloadCSV(csvContent, 'backlog_beacon_export.csv');
    } catch (error) {
      this.exportError = error.reason || error.message || 'Export failed';
    }
    
    this.exporting = false;
    m.redraw();
  },
  
  readFile(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = (event) => resolve(event.target.result);
      reader.onerror = (error) => reject(error);
      reader.readAsText(file);
    });
  },
  
  downloadCSV(content, filename) {
    const blob = new Blob([content], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  },
  
  view(vnode) {
    return m('div.import-page', [
      m('h1', 'Import & Export'),
      
      m('nav.import-tabs', [
        m('ul', [
          m('li', [
            m('a', {
              href: '#',
              class: this.activeTab === TABS.DARKADIA ? 'active' : '',
              onclick: (event) => {
                event.preventDefault();
                this.setTab(TABS.DARKADIA);
              }
            }, 'Darkadia CSV')
          ]),
          m('li', [
            m('a', {
              href: '#',
              class: this.activeTab === TABS.BACKLOG_BEACON ? 'active' : '',
              onclick: (event) => {
                event.preventDefault();
                this.setTab(TABS.BACKLOG_BEACON);
              }
            }, 'Backlog Beacon CSV')
          ]),
          m('li', [
            m('a', {
              href: '#',
              class: this.activeTab === TABS.SIMPLE ? 'active' : '',
              onclick: (event) => {
                event.preventDefault();
                this.setTab(TABS.SIMPLE);
              }
            }, 'Simple Import')
          ]),
          m('li', [
            m('a', {
              href: '#',
              class: this.activeTab === TABS.EXPORT ? 'active' : '',
              onclick: (event) => {
                event.preventDefault();
                this.setTab(TABS.EXPORT);
              }
            }, 'Export')
          ])
        ])
      ]),
      
      m('article.import-content', [
        this.activeTab === TABS.DARKADIA && this.renderDarkadiaTab(),
        this.activeTab === TABS.BACKLOG_BEACON && this.renderBacklogBeaconTab(),
        this.activeTab === TABS.SIMPLE && this.renderSimpleTab(),
        this.activeTab === TABS.EXPORT && this.renderExportTab()
      ])
    ]);
  },
  
  renderDarkadiaTab() {
    const progress = this.darkadiaProgress;
    const isProcessing = progress && progress.status === 'processing';
    
    return m('div.darkadia-import', [
      m('header', [
        m('h2', 'Import from Darkadia'),
        m('p', 'Import your game collection from a Darkadia CSV export file.')
      ]),
      
      m('div.form-group', [
        m('label', { for: 'darkadia-file' }, 'Select CSV File'),
        m('input', {
          type: 'file',
          id: 'darkadia-file',
          accept: '.csv',
          disabled: this.darkadiaImporting,
          onchange: (event) => this.handleDarkadiaFileSelect(event)
        })
      ]),
      
      m('fieldset', [
        m('legend', 'Import Options'),
        m('label', [
          m('input', {
            type: 'checkbox',
            checked: this.darkadiaOptions.updateExisting,
            disabled: this.darkadiaImporting,
            onchange: (event) => {
              this.darkadiaOptions.updateExisting = event.target.checked;
            }
          }),
          ' Update existing games instead of skipping. Overwrites edits (notes, rating, status, etc.)'
        ])
      ]),
      
      // Progress indicator
      (this.darkadiaImporting || isProcessing) && progress && m('div.import-progress', [
        m('h3', 'Import Progress'),
        m('div.progress-info', [
          m('p', [
            m('strong', 'Processing: '),
            `${progress.current || 0} of ${progress.total || 0} games`
          ]),
          progress.currentGame && m('p', [
            m('strong', 'Current: '),
            progress.currentGame
          ]),
          m('div.progress-stats', [
            m('span.stat-imported', `✓ Imported: ${progress.imported || 0}`),
            m('span.stat-updated', ` | Updated: ${progress.updated || 0}`),
            m('span.stat-skipped', ` | Skipped: ${progress.skipped || 0}`)
          ])
        ]),
        m('progress', {
          value: progress.current || 0,
          max: progress.total || 100
        })
      ]),
      
      this.darkadiaPreview && !this.darkadiaImporting && m('div.import-preview', [
        m('h3', `Preview (${this.darkadiaPreview.total} games found)`),
        m('p', `Showing first ${this.darkadiaPreview.games.length} games:`),
        m('table', { role: 'grid' }, [
          m('thead', [
            m('tr', [
              m('th', 'Name'),
              m('th', 'Platforms'),
              m('th', 'Status'),
              m('th', 'Favorite')
            ])
          ]),
          m('tbody', [
            this.darkadiaPreview.games.map((game, index) => 
              m('tr', { key: index }, [
                m('td', game.name),
                m('td', game.platforms.join(', ') || '-'),
                m('td', game.status),
                m('td', game.favorite ? '★' : '-')
              ])
            )
          ])
        ])
      ]),
      
      this.darkadiaError && m('div.error-message', { role: 'alert' }, [
        m('strong', 'Error: '),
        this.darkadiaError
      ]),
      
      this.darkadiaResult && m('div.import-results', [
        m('div.import-results-summary', {
          class: this.darkadiaResult.errors.length > 0 ? 'has-errors' : ''
        }, [
          m('strong', 'Import Complete!'),
          m('p', [
            `Imported: ${this.darkadiaResult.imported} games`,
            this.darkadiaResult.updated > 0 ? `, Updated: ${this.darkadiaResult.updated}` : '',
            `, Skipped: ${this.darkadiaResult.skipped}`
          ])
        ]),
        this.darkadiaResult.errors.length > 0 && m('div.import-errors', [
          m('details', { open: true }, [
            m('summary', `${this.darkadiaResult.errors.length} errors`),
            m('ul', [
              this.darkadiaResult.errors.map((error, index) =>
                m('li', { key: index }, `Row ${error.row}: ${error.name} - ${error.error}`)
              )
            ])
          ])
        ])
      ]),
      
      m('button', {
        disabled: !this.darkadiaFile || this.darkadiaImporting,
        onclick: () => this.importDarkadia()
      }, this.darkadiaImporting ? 'Importing...' : 'Import')
    ]);
  },
  
  renderBacklogBeaconTab() {
    return m('div.backlog-beacon-import', [
      m('header', [
        m('h2', 'Import from Backlog Beacon'),
        m('p', 'Import a previously exported Backlog Beacon CSV file.')
      ]),
      
      m('div.form-group', [
        m('label', { for: 'backlog-file' }, 'Select CSV File'),
        m('input', {
          type: 'file',
          id: 'backlog-file',
          accept: '.csv',
          onchange: (event) => this.handleBacklogFileSelect(event)
        })
      ]),
      
      m('fieldset', [
        m('legend', 'Import Options'),
        m('label', [
          m('input', {
            type: 'checkbox',
            checked: this.backlogOptions.updateExisting,
            onchange: (event) => {
              this.backlogOptions.updateExisting = event.target.checked;
            }
          }),
          ' Update existing games instead of skipping. Overwrites edits (notes, rating, status, etc.)'
        ])
      ]),
      
      this.backlogFile && m('p', [
        m('strong', 'Selected: '),
        this.backlogFile.name,
        ` (${Math.round(this.backlogFile.size / 1024)} KB)`
      ]),
      
      this.backlogError && m('div.error-message', { role: 'alert' }, [
        m('strong', 'Error: '),
        this.backlogError
      ]),
      
      this.backlogResult && m('div.success-message', { role: 'alert' }, [
        m('strong', 'Import Complete!'),
        m('p', [
          `Imported: ${this.backlogResult.imported} games`,
          this.backlogResult.updated > 0 ? `, Updated: ${this.backlogResult.updated}` : '',
          `, Skipped: ${this.backlogResult.skipped}`
        ])
      ]),
      
      m('button', {
        disabled: !this.backlogFile || this.backlogImporting,
        onclick: () => this.importBacklogBeacon()
      }, this.backlogImporting ? 'Importing...' : 'Import')
    ]);
  },
  
  renderSimpleTab() {
    const validGames = this.getValidSimpleGames();
    
    return m('div.simple-import', [
      m('header', [
        m('h2', 'Simple Import'),
        m('p', 'Quickly add games by entering their names. Optionally specify storefront and platform.')
      ]),
      
      m('div.input-mode-toggle', [
        m('button', {
          class: this.simpleInputMode === 'form' ? 'secondary' : 'outline',
          onclick: () => {
            this.simpleInputMode = 'form';
          }
        }, 'Form Input'),
        m('button', {
          class: this.simpleInputMode === 'bulk' ? 'secondary' : 'outline',
          onclick: () => {
            this.simpleInputMode = 'bulk';
          }
        }, 'Bulk Paste')
      ]),
      
      this.simpleInputMode === 'form' ? this.renderSimpleForm() : this.renderSimpleBulk(),
      
      this.simpleError && m('div.error-message', { role: 'alert' }, [
        m('strong', 'Error: '),
        this.simpleError
      ]),
      
      this.simpleResult && m('div.success-message', { role: 'alert' }, [
        m('strong', 'Import Complete!'),
        m('p', [
          `Imported: ${this.simpleResult.imported} games`,
          `, Skipped: ${this.simpleResult.skipped}`
        ]),
        this.simpleResult.errors.length > 0 && m('details', [
          m('summary', `${this.simpleResult.errors.length} errors`),
          m('ul', [
            this.simpleResult.errors.map((error, index) => 
              m('li', { key: index }, `${error.name}: ${error.error}`)
            )
          ])
        ])
      ]),
      
      m('button', {
        disabled: validGames.length === 0 || this.simpleImporting,
        onclick: () => this.importSimple()
      }, this.simpleImporting ? 'Importing...' : `Import ${validGames.length} Game${validGames.length !== 1 ? 's' : ''}`)
    ]);
  },
  
  renderSimpleForm() {
    return m('div.simple-form', [
      m('table', { role: 'grid' }, [
        m('thead', [
          m('tr', [
            m('th', 'Game Name *'),
            m('th', 'Storefront'),
            m('th', 'Platform'),
            m('th', '')
          ])
        ]),
        m('tbody', [
          this.simpleGames.map((game, index) => 
            m('tr', { key: index }, [
              m('td', [
                m('input', {
                  type: 'text',
                  placeholder: 'Enter game name',
                  value: game.name,
                  oninput: (event) => this.updateSimpleGame(index, 'name', event.target.value)
                })
              ]),
              m('td', [
                m('select', {
                  value: game.storefront,
                  onchange: (event) => this.updateSimpleGame(index, 'storefront', event.target.value)
                }, [
                  m('option', { value: '' }, '-- Select --'),
                  this.storefronts.map(storefront => 
                    m('option', { key: storefront.id, value: storefront.name }, storefront.name)
                  )
                ])
              ]),
              m('td', [
                m('input', {
                  type: 'text',
                  placeholder: 'e.g., PC, PS5',
                  value: game.platform,
                  oninput: (event) => this.updateSimpleGame(index, 'platform', event.target.value)
                })
              ]),
              m('td', [
                m('button', {
                  class: 'outline secondary',
                  disabled: this.simpleGames.length <= 1,
                  onclick: () => this.removeSimpleGame(index),
                  title: 'Remove row'
                }, '×')
              ])
            ])
          )
        ])
      ]),
      
      m('button', {
        class: 'outline',
        onclick: () => this.addSimpleGame()
      }, '+ Add Another Game')
    ]);
  },
  
  renderSimpleBulk() {
    return m('div.simple-bulk', [
      m('p', 'Paste a list of games, one per line. Use tabs or commas to separate columns:'),
      m('p', m('code', 'Game Name, Storefront, Platform')),
      
      m('textarea', {
        rows: 10,
        placeholder: 'The Legend of Zelda, Nintendo eShop, Switch\nHalf-Life 2, Steam, PC\nFinal Fantasy VII',
        value: this.simpleBulkText,
        oninput: (event) => {
          this.simpleBulkText = event.target.value;
        }
      }),
      
      m('button', {
        class: 'outline',
        disabled: !this.simpleBulkText.trim(),
        onclick: () => this.parseBulkText()
      }, 'Parse and Review')
    ]);
  },
  
  renderExportTab() {
    return m('div.export-section', [
      m('header', [
        m('h2', 'Export Collection'),
        m('p', 'Download your entire game collection as a CSV file. You can use this to backup your data or import it later.')
      ]),
      
      this.exportError && m('div.error-message', { role: 'alert' }, [
        m('strong', 'Error: '),
        this.exportError
      ]),
      
      m('button', {
        disabled: this.exporting,
        onclick: () => this.exportCollection()
      }, this.exporting ? 'Exporting...' : 'Download CSV Export')
    ]);
  }
};

export const ImportPage = {
  view() {
    return m(RequireAuth, m(ImportContent));
  }
};
