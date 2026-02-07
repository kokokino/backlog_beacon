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
  STOREFRONT: 'storefront',
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
    this.backlogPreview = null;
    this.backlogImporting = false;
    this.backlogResult = null;
    this.backlogError = null;
    this.backlogOptions = {
      updateExisting: true
    };
    this.backlogProgress = null;
    
    // Simple import state
    this.simpleGames = [{ name: '', storefront: '', platform: '' }];
    this.simpleImporting = false;
    this.simpleResult = null;
    this.simpleError = null;
    this.simpleBulkText = '';
    this.simpleInputMode = 'form';
    this.simpleProgress = null;
    this.simpleOptions = {
      updateExisting: true
    };

    // Storefront import state
    this.storefrontType = null;
    this.steamUsername = '';
    this.storefrontPreview = null;
    this.storefrontPreviewing = false;
    this.storefrontImporting = false;
    this.storefrontResult = null;
    this.storefrontError = null;
    this.storefrontProgress = null;
    this.storefrontOptions = {
      updateExisting: true,
      importPlaytime: true,
      importLastPlayed: true
    };

    // GOG-specific state
    this.gogUsername = '';
    this.gogMethod = 'public'; // 'public' or 'login'
    this.gogSessionCookie = null; // In-memory only, never persisted
    this.gogLoginWindow = null;
    this.gogLoginCheckInterval = null;

    // Epic-specific state
    this.epicAuthCode = null; // In-memory only, never persisted

    // Amazon-specific state
    this.amazonAuthCode = null; // In-memory only, never persisted
    this.amazonCodeVerifier = null; // PKCE verifier, generated dynamically
    this.amazonDeviceSerial = null; // Unique device ID for this auth session
    this.amazonLoginWindow = null; // Popup window reference

    // Oculus-specific state
    this.oculusAccessToken = null; // In-memory only, never persisted
    this.oculusPlatform = 'quest'; // 'quest', 'rift', or 'go'

    // Ubisoft-specific state
    this.ubisoftEmail = '';
    this.ubisoftPassword = '';
    this.ubisoftTwoFactorTicket = null; // In-memory only, stored when 2FA is needed
    this.ubisoftTwoFactorCode = '';
    this.ubisoftNeeds2FA = false;

    // Xbox-specific state
    this.xboxAuthCode = null; // In-memory only, never persisted

    // EA-specific state
    this.eaBearerToken = null; // In-memory only, never persisted

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
      this.darkadiaProgress = ImportProgress.findOne({ type: 'darkadia' });
      this.simpleProgress = ImportProgress.findOne({ type: 'simple' });
      this.backlogProgress = ImportProgress.findOne({ type: 'backlog' });
      this.storefrontProgress = ImportProgress.findOne({ type: 'storefront' });
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
    // Clean up GOG login popup resources
    if (this.gogLoginCheckInterval) {
      clearInterval(this.gogLoginCheckInterval);
    }
    if (this.gogLoginWindow && !this.gogLoginWindow.closed) {
      this.gogLoginWindow.close();
    }
    // Clean up Amazon login popup
    if (this.amazonLoginWindow && !this.amazonLoginWindow.closed) {
      this.amazonLoginWindow.close();
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
    this.backlogPreview = null;
    this.simpleError = null;
    this.simpleResult = null;
    this.storefrontError = null;
    this.storefrontResult = null;
    this.storefrontPreview = null;
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
      this.backlogPreview = null;
      this.backlogResult = null;
      this.backlogError = null;
      this.previewBacklogBeacon();
    }
  },

  async previewBacklogBeacon() {
    if (!this.backlogFile) {
      return;
    }

    try {
      const content = await this.readFile(this.backlogFile);
      this.backlogPreview = await Meteor.callAsync('import.previewBacklogBeacon', content);
      m.redraw();
    } catch (error) {
      this.backlogError = error.reason || error.message || 'Failed to preview file';
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
      this.backlogPreview = null;

      // Clear progress after a short delay
      setTimeout(async () => {
        try {
          await Meteor.callAsync('import.clearProgress', 'backlog');
        } catch (error) {
          console.error('Failed to clear progress:', error);
        }
      }, 2000);
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
      this.simpleResult = await Meteor.callAsync('import.simple', games, this.simpleOptions);
      this.simpleGames = [{ name: '', storefront: '', platform: '' }];
      this.simpleBulkText = '';

      // Clear progress after a short delay
      setTimeout(async () => {
        try {
          await Meteor.callAsync('import.clearProgress', 'simple');
        } catch (error) {
          console.error('Failed to clear progress:', error);
        }
      }, 2000);
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

  selectStorefront(type) {
    this.storefrontType = type;
    this.steamUsername = '';
    this.gogUsername = '';
    this.gogMethod = 'public';
    this.gogSessionCookie = null;
    this.epicAuthCode = null;
    this.amazonAuthCode = null;
    this.amazonCodeVerifier = null;
    this.amazonDeviceSerial = null;
    // Clean up Amazon popup
    if (this.amazonLoginWindow && !this.amazonLoginWindow.closed) {
      this.amazonLoginWindow.close();
    }
    this.amazonLoginWindow = null;
    // Reset Oculus state
    this.oculusAccessToken = null;
    this.oculusPlatform = 'quest';
    // Reset Ubisoft state
    this.ubisoftEmail = '';
    this.ubisoftPassword = '';
    this.ubisoftTwoFactorTicket = null;
    this.ubisoftTwoFactorCode = '';
    this.ubisoftNeeds2FA = false;
    // Reset Xbox state
    this.xboxAuthCode = null;
    // Reset EA state
    this.eaBearerToken = null;
    this.storefrontPreview = null;
    this.storefrontResult = null;
    this.storefrontError = null;
    // Clean up any open GOG login window
    if (this.gogLoginCheckInterval) {
      clearInterval(this.gogLoginCheckInterval);
      this.gogLoginCheckInterval = null;
    }
    if (this.gogLoginWindow && !this.gogLoginWindow.closed) {
      this.gogLoginWindow.close();
      this.gogLoginWindow = null;
    }
  },

  updateSteamUsername(value) {
    this.steamUsername = value;
  },

  async previewStorefront() {
    if (!this.storefrontType || !this.steamUsername.trim()) {
      return;
    }

    this.storefrontPreviewing = true;
    this.storefrontError = null;
    this.storefrontPreview = null;
    this.storefrontResult = null;
    m.redraw();

    try {
      this.storefrontPreview = await Meteor.callAsync('import.previewStorefront', this.storefrontType, this.steamUsername);
    } catch (error) {
      this.storefrontError = error.reason || error.message || 'Failed to preview library';
    }

    this.storefrontPreviewing = false;
    m.redraw();
  },

  async importStorefront() {
    if (!this.storefrontType || !this.steamUsername.trim()) {
      return;
    }

    this.storefrontImporting = true;
    this.storefrontError = null;
    this.storefrontResult = null;
    m.redraw();

    try {
      this.storefrontResult = await Meteor.callAsync('import.storefront', this.storefrontType, this.steamUsername, this.storefrontOptions);
      // Clear username after successful import
      this.steamUsername = '';
      this.storefrontPreview = null;

      // Clear progress after a short delay
      setTimeout(async () => {
        try {
          await Meteor.callAsync('import.clearStorefrontProgress');
        } catch (error) {
          console.error('Failed to clear progress:', error);
        }
      }, 2000);
    } catch (error) {
      this.storefrontError = error.reason || error.message || 'Import failed';
    }

    this.storefrontImporting = false;
    m.redraw();
  },

  // GOG-specific methods
  updateGogUsername(value) {
    this.gogUsername = value;
  },

  setGogMethod(method) {
    this.gogMethod = method;
    // Clear preview when switching methods
    this.storefrontPreview = null;
    this.storefrontResult = null;
    this.storefrontError = null;
  },

  openGogLoginPopup() {
    // Open GOG login page in a popup
    const width = 500;
    const height = 700;
    const left = window.screenX + (window.outerWidth - width) / 2;
    const top = window.screenY + (window.outerHeight - height) / 2;

    this.gogLoginWindow = window.open(
      'https://www.gog.com/account',
      'gog-login',
      `width=${width},height=${height},left=${left},top=${top},menubar=no,toolbar=no,location=yes,status=no`
    );

    if (!this.gogLoginWindow) {
      this.storefrontError = 'Could not open login popup. Please allow popups for this site.';
      m.redraw();
      return;
    }

    this.storefrontError = null;
    m.redraw();

    // Poll for popup closure or navigation to account page
    this.gogLoginCheckInterval = setInterval(() => {
      try {
        if (this.gogLoginWindow.closed) {
          clearInterval(this.gogLoginCheckInterval);
          this.gogLoginCheckInterval = null;
          // User closed the popup - they may have logged in
          // We can't read cookies from GOG domain due to same-origin policy
          // So we'll ask them to confirm login manually
          this.storefrontError = 'Popup closed. If you logged in successfully, please enter your session cookie manually or try the Public Profile method instead.';
          m.redraw();
        }
      } catch (error) {
        // Cross-origin access error - popup is on GOG domain
        // This is expected behavior
      }
    }, 1000);
  },

  clearGogSession() {
    this.gogSessionCookie = null;
    this.storefrontPreview = null;
    this.storefrontResult = null;
    this.storefrontError = null;
    m.redraw();
  },

  async previewGogPublic() {
    if (!this.gogUsername.trim()) {
      return;
    }

    this.storefrontPreviewing = true;
    this.storefrontError = null;
    this.storefrontPreview = null;
    this.storefrontResult = null;
    m.redraw();

    try {
      this.storefrontPreview = await Meteor.callAsync('import.previewStorefront', 'gog', this.gogUsername);
    } catch (error) {
      this.storefrontError = error.reason || error.message || 'Failed to preview library';
    }

    this.storefrontPreviewing = false;
    m.redraw();
  },

  async previewGogAuth() {
    if (!this.gogSessionCookie) {
      this.storefrontError = 'Please enter your GOG session cookie first.';
      m.redraw();
      return;
    }

    this.storefrontPreviewing = true;
    this.storefrontError = null;
    this.storefrontPreview = null;
    this.storefrontResult = null;
    m.redraw();

    try {
      this.storefrontPreview = await Meteor.callAsync('import.previewGogAuth', this.gogSessionCookie);
    } catch (error) {
      this.storefrontError = error.reason || error.message || 'Failed to preview library';
    }

    this.storefrontPreviewing = false;
    m.redraw();
  },

  async importGogPublic() {
    if (!this.gogUsername.trim()) {
      return;
    }

    this.storefrontImporting = true;
    this.storefrontError = null;
    this.storefrontResult = null;
    m.redraw();

    try {
      this.storefrontResult = await Meteor.callAsync('import.storefront', 'gog', this.gogUsername, this.storefrontOptions);
      // Clear username after successful import
      this.gogUsername = '';
      this.storefrontPreview = null;

      // Clear progress after a short delay
      setTimeout(async () => {
        try {
          await Meteor.callAsync('import.clearStorefrontProgress');
        } catch (error) {
          console.error('Failed to clear progress:', error);
        }
      }, 2000);
    } catch (error) {
      this.storefrontError = error.reason || error.message || 'Import failed';
    }

    this.storefrontImporting = false;
    m.redraw();
  },

  async importGogAuth() {
    if (!this.gogSessionCookie) {
      this.storefrontError = 'Please enter your GOG session cookie first.';
      m.redraw();
      return;
    }

    this.storefrontImporting = true;
    this.storefrontError = null;
    this.storefrontResult = null;
    m.redraw();

    try {
      this.storefrontResult = await Meteor.callAsync('import.gogAuth', this.gogSessionCookie, {
        updateExisting: this.storefrontOptions.updateExisting
      });
      // Clear session cookie after successful import (security best practice)
      this.gogSessionCookie = null;
      this.storefrontPreview = null;

      // Clear progress after a short delay
      setTimeout(async () => {
        try {
          await Meteor.callAsync('import.clearStorefrontProgress');
        } catch (error) {
          console.error('Failed to clear progress:', error);
        }
      }, 2000);
    } catch (error) {
      this.storefrontError = error.reason || error.message || 'Import failed';
    }

    this.storefrontImporting = false;
    m.redraw();
  },

  formatDate(date) {
    if (!date) {
      return '-';
    }
    const d = new Date(date);
    if (isNaN(d.getTime())) {
      return '-';
    }
    return d.toLocaleDateString();
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
              class: this.activeTab === TABS.STOREFRONT ? 'active' : '',
              onclick: (event) => {
                event.preventDefault();
                this.setTab(TABS.STOREFRONT);
              }
            }, 'Storefront')
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
        this.activeTab === TABS.STOREFRONT && this.renderStorefrontTab(),
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
        this.darkadiaResult.games.filter(g => g.action === 'inserted').length > 0 &&
          m('div.import-imported', [
            m('details', [
              m('summary', `${this.darkadiaResult.games.filter(g => g.action === 'inserted').length} games imported`),
              m('ul', [
                this.darkadiaResult.games
                  .filter(g => g.action === 'inserted')
                  .map((game, index) => m('li', { key: index },
                    game.matchedName && game.matchedName !== game.name
                      ? `${game.name} → ${game.matchedName}`
                      : game.name
                  ))
              ])
            ])
          ]),
        this.darkadiaResult.games.filter(g => g.action === 'updated').length > 0 &&
          m('div.import-updated', [
            m('details', { open: true }, [
              m('summary', `${this.darkadiaResult.updated} games updated`),
              m('ul', [
                this.darkadiaResult.games
                  .filter(g => g.action === 'updated')
                  .map((game, index) => m('li', { key: index },
                    game.matchedName && game.matchedName !== game.name
                      ? `${game.name} → ${game.matchedName}`
                      : game.name
                  ))
              ])
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
    const progress = this.backlogProgress;
    const isProcessing = progress && progress.status === 'processing';

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
          disabled: this.backlogImporting,
          onchange: (event) => this.handleBacklogFileSelect(event)
        })
      ]),

      m('fieldset', [
        m('legend', 'Import Options'),
        m('label', [
          m('input', {
            type: 'checkbox',
            checked: this.backlogOptions.updateExisting,
            disabled: this.backlogImporting,
            onchange: (event) => {
              this.backlogOptions.updateExisting = event.target.checked;
            }
          }),
          ' Update existing games instead of skipping. Overwrites edits (notes, rating, status, etc.)'
        ])
      ]),

      // Progress indicator
      (this.backlogImporting || isProcessing) && progress && m('div.import-progress', [
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
            m('span.stat-imported', `Imported: ${progress.imported || 0}`),
            m('span.stat-updated', ` | Updated: ${progress.updated || 0}`),
            m('span.stat-skipped', ` | Skipped: ${progress.skipped || 0}`)
          ])
        ]),
        m('progress', {
          value: progress.current || 0,
          max: progress.total || 100
        })
      ]),

      // Preview table
      this.backlogPreview && !this.backlogImporting && m('div.import-preview', [
        m('h3', `Preview (${this.backlogPreview.total} games found)`),
        m('p', `Showing first ${this.backlogPreview.games.length} games:`),
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
            this.backlogPreview.games.map((game, index) =>
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

      this.backlogError && m('div.error-message', { role: 'alert' }, [
        m('strong', 'Error: '),
        this.backlogError
      ]),

      // Results with collapsible sections
      this.backlogResult && m('div.import-results', [
        m('div.import-results-summary', {
          class: this.backlogResult.errors.length > 0 ? 'has-errors' : ''
        }, [
          m('strong', 'Import Complete!'),
          m('p', [
            `Imported: ${this.backlogResult.imported} games`,
            this.backlogResult.updated > 0 ? `, Updated: ${this.backlogResult.updated}` : '',
            `, Skipped: ${this.backlogResult.skipped}`
          ])
        ]),
        // Imported games section
        this.backlogResult.games && this.backlogResult.games.filter(g => g.action === 'imported').length > 0 &&
          m('div.import-imported', [
            m('details', [
              m('summary', `${this.backlogResult.imported} games imported`),
              m('ul', [
                this.backlogResult.games
                  .filter(g => g.action === 'imported')
                  .map((game, index) => m('li', { key: index },
                    game.matchedName && game.matchedName !== game.name
                      ? `${game.name} → ${game.matchedName}`
                      : game.name
                  ))
              ])
            ])
          ]),
        // Updated games section
        this.backlogResult.games && this.backlogResult.games.filter(g => g.action === 'updated').length > 0 &&
          m('div.import-updated', [
            m('details', { open: true }, [
              m('summary', `${this.backlogResult.updated} games updated`),
              m('ul', [
                this.backlogResult.games
                  .filter(g => g.action === 'updated')
                  .map((game, index) => m('li', { key: index },
                    game.matchedName && game.matchedName !== game.name
                      ? `${game.name} → ${game.matchedName}`
                      : game.name
                  ))
              ])
            ])
          ]),
        // Skipped games section
        this.backlogResult.games && this.backlogResult.games.filter(g => g.action === 'skipped').length > 0 &&
          m('div.import-skipped', [
            m('details', [
              m('summary', `${this.backlogResult.skipped} games skipped`),
              m('ul', [
                this.backlogResult.games
                  .filter(g => g.action === 'skipped')
                  .map((game, index) => m('li', { key: index }, `${game.name}${game.reason ? ` - ${game.reason}` : ''}`))
              ])
            ])
          ]),
        // Errors section
        this.backlogResult.errors.length > 0 && m('div.import-errors', [
          m('details', { open: true }, [
            m('summary', `${this.backlogResult.errors.length} errors`),
            m('ul', [
              this.backlogResult.errors.map((error, index) =>
                m('li', { key: index }, `Row ${error.row}: ${error.name} - ${error.error}`)
              )
            ])
          ])
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
    const progress = this.simpleProgress;
    const isProcessing = progress && progress.status === 'processing';

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

      m('fieldset', [
        m('legend', 'Import Options'),
        m('label', [
          m('input', {
            type: 'checkbox',
            checked: this.simpleOptions.updateExisting,
            disabled: this.simpleImporting,
            onchange: (event) => {
              this.simpleOptions.updateExisting = event.target.checked;
            }
          }),
          ' Update existing games (merge platforms and storefronts)'
        ])
      ]),

      this.simpleInputMode === 'form' ? this.renderSimpleForm() : this.renderSimpleBulk(),

      // Progress indicator
      (this.simpleImporting || isProcessing) && progress && m('div.import-progress', [
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
            m('span.stat-imported', `Imported: ${progress.imported || 0}`),
            m('span.stat-updated', ` | Updated: ${progress.updated || 0}`),
            m('span.stat-skipped', ` | Skipped: ${progress.skipped || 0}`)
          ])
        ]),
        m('progress', {
          value: progress.current || 0,
          max: progress.total || 100
        })
      ]),

      this.simpleError && m('div.error-message', { role: 'alert' }, [
        m('strong', 'Error: '),
        this.simpleError
      ]),

      this.simpleResult && m('div.import-results', [
        m('div.import-results-summary', {
          class: this.simpleResult.errors.length > 0 ? 'has-errors' : ''
        }, [
          m('strong', 'Import Complete!'),
          m('p', [
            `Imported: ${this.simpleResult.imported} games`,
            this.simpleResult.updated > 0 ? `, Updated: ${this.simpleResult.updated}` : '',
            `, Skipped: ${this.simpleResult.skipped}`
          ])
        ]),
        // Imported games section
        this.simpleResult.games && this.simpleResult.games.filter(g => g.action === 'imported').length > 0 &&
          m('div.import-imported', [
            m('details', [
              m('summary', `${this.simpleResult.imported} games imported`),
              m('ul', [
                this.simpleResult.games
                  .filter(g => g.action === 'imported')
                  .map((game, index) => m('li', { key: index },
                    game.matchedName && game.matchedName !== game.name
                      ? `${game.name} → ${game.matchedName}`
                      : game.name
                  ))
              ])
            ])
          ]),
        // Updated games section
        this.simpleResult.games && this.simpleResult.games.filter(g => g.action === 'updated').length > 0 &&
          m('div.import-updated', [
            m('details', { open: true }, [
              m('summary', `${this.simpleResult.updated} games updated`),
              m('ul', [
                this.simpleResult.games
                  .filter(g => g.action === 'updated')
                  .map((game, index) => m('li', { key: index },
                    game.matchedName && game.matchedName !== game.name
                      ? `${game.name} → ${game.matchedName}`
                      : game.name
                  ))
              ])
            ])
          ]),
        // Skipped games section
        this.simpleResult.games && this.simpleResult.games.filter(g => g.action === 'skipped').length > 0 &&
          m('div.import-skipped', [
            m('details', [
              m('summary', `${this.simpleResult.skipped} games skipped`),
              m('ul', [
                this.simpleResult.games
                  .filter(g => g.action === 'skipped')
                  .map((game, index) => m('li', { key: index }, `${game.name}${game.reason ? ` - ${game.reason}` : ''}`))
              ])
            ])
          ]),
        // Errors section
        this.simpleResult.errors.length > 0 && m('div.import-errors', [
          m('details', { open: true }, [
            m('summary', `${this.simpleResult.errors.length} errors`),
            m('ul', [
              this.simpleResult.errors.map((error, index) =>
                m('li', { key: index }, `${error.name}: ${error.error}`)
              )
            ])
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
  
  renderStorefrontTab() {
    const progress = this.storefrontProgress;
    const isProcessing = progress && progress.status === 'processing';

    return m('div.storefront-import', [
      m('header', [
        m('h2', 'Import from Storefront'),
        m('p', 'Import your game library directly from digital storefronts like Steam.')
      ]),

      // Storefront selector
      m('div.form-group', [
        m('label', { for: 'storefront-select' }, 'Select Storefront'),
        m('select', {
          id: 'storefront-select',
          value: this.storefrontType || '',
          disabled: this.storefrontImporting || this.storefrontPreviewing,
          onchange: (event) => this.selectStorefront(event.target.value || null)
        }, [
          m('option', { value: '' }, '-- Select a storefront --'),
          m('option', { value: 'steam' }, 'Steam'),
          m('option', { value: 'gog' }, 'GOG'),
          m('option', { value: 'epic' }, 'Epic Games Store'),
          m('option', { value: 'amazon' }, 'Amazon Games'),
          m('option', { value: 'oculus' }, 'Oculus / Meta Quest'),
          m('option', { value: 'ea' }, 'EA App'),
          m('option', { value: 'ubisoft' }, 'Ubisoft Connect'),
          m('option', { value: 'xbox' }, 'Xbox / Microsoft Store')
        ])
      ]),

      // Steam form
      this.storefrontType === 'steam' && this.renderSteamForm(),

      // GOG form
      this.storefrontType === 'gog' && this.renderGogForm(),

      // Epic form
      this.storefrontType === 'epic' && this.renderEpicForm(),

      // Amazon form
      this.storefrontType === 'amazon' && this.renderAmazonForm(),

      // Oculus form
      this.storefrontType === 'oculus' && this.renderOculusForm(),

      // EA form
      this.storefrontType === 'ea' && this.renderEaForm(),

      // Ubisoft form
      this.storefrontType === 'ubisoft' && this.renderUbisoftForm(),

      // Xbox form
      this.storefrontType === 'xbox' && this.renderXboxForm(),

      // Progress indicator
      (this.storefrontImporting || isProcessing) && progress && m('div.import-progress', [
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
            m('span.stat-imported', `Imported: ${progress.imported || 0}`),
            m('span.stat-updated', ` | Updated: ${progress.updated || 0}`),
            m('span.stat-skipped', ` | Skipped: ${progress.skipped || 0}`)
          ])
        ]),
        m('progress', {
          value: progress.current || 0,
          max: progress.total || 100
        })
      ]),

      this.storefrontError && m('div.error-message', { role: 'alert' }, [
        m('strong', 'Error: '),
        this.storefrontError
      ]),

      // Preview table
      this.storefrontPreview && !this.storefrontImporting && m('div.import-preview', [
        m('h3', `Preview (${this.storefrontPreview.total} games found)`),
        m('p', `Showing first ${this.storefrontPreview.games.length} games (sorted by playtime):`),
        m('table', { role: 'grid' }, [
          m('thead', [
            m('tr', [
              m('th', 'Name'),
              m('th', 'Hours Played'),
              m('th', 'Last Played')
            ])
          ]),
          m('tbody', [
            this.storefrontPreview.games.map((game, index) =>
              m('tr', { key: index }, [
                m('td', game.name),
                m('td', game.hoursPlayed !== null ? `${game.hoursPlayed}h` : '-'),
                m('td', this.formatDate(game.lastPlayed))
              ])
            )
          ])
        ])
      ]),

      // Results with collapsible sections
      this.storefrontResult && m('div.import-results', [
        m('div.import-results-summary', {
          class: this.storefrontResult.errors.length > 0 ? 'has-errors' : ''
        }, [
          m('strong', 'Import Complete!'),
          m('p', [
            `Imported: ${this.storefrontResult.imported} games`,
            this.storefrontResult.updated > 0 ? `, Updated: ${this.storefrontResult.updated}` : '',
            `, Skipped: ${this.storefrontResult.skipped}`
          ])
        ]),
        // Imported games section
        this.storefrontResult.games && this.storefrontResult.games.filter(g => g.action === 'imported').length > 0 &&
          m('div.import-imported', [
            m('details', [
              m('summary', `${this.storefrontResult.imported} games imported`),
              m('ul', [
                this.storefrontResult.games
                  .filter(g => g.action === 'imported')
                  .map((game, index) => m('li', { key: index },
                    game.matchedName && game.matchedName !== game.name
                      ? `${game.name} → ${game.matchedName}`
                      : game.name
                  ))
              ])
            ])
          ]),
        // Updated games section
        this.storefrontResult.games && this.storefrontResult.games.filter(g => g.action === 'updated').length > 0 &&
          m('div.import-updated', [
            m('details', { open: true }, [
              m('summary', `${this.storefrontResult.updated} games updated`),
              m('ul', [
                this.storefrontResult.games
                  .filter(g => g.action === 'updated')
                  .map((game, index) => m('li', { key: index },
                    game.matchedName && game.matchedName !== game.name
                      ? `${game.name} → ${game.matchedName}`
                      : game.name
                  ))
              ])
            ])
          ]),
        // Skipped games section
        this.storefrontResult.games && this.storefrontResult.games.filter(g => g.action === 'skipped').length > 0 &&
          m('div.import-skipped', [
            m('details', [
              m('summary', `${this.storefrontResult.skipped} games skipped`),
              m('ul', [
                this.storefrontResult.games
                  .filter(g => g.action === 'skipped')
                  .map((game, index) => m('li', { key: index }, `${game.name}${game.reason ? ` - ${game.reason}` : ''}`))
              ])
            ])
          ]),
        // Errors section
        this.storefrontResult.errors.length > 0 && m('div.import-errors', [
          m('details', { open: true }, [
            m('summary', `${this.storefrontResult.errors.length} errors`),
            m('ul', [
              this.storefrontResult.errors.map((error, index) =>
                m('li', { key: index }, `${error.name}: ${error.error}`)
              )
            ])
          ])
        ])
      ])
    ]);
  },

  renderSteamForm() {
    const hasUsername = this.steamUsername.trim().length > 0;

    return m('div.steam-form', [
      // Username input
      m('div.form-group', [
        m('label', { for: 'steam-username' }, 'Steam Profile URL'),
        m('input', {
          type: 'text',
          id: 'steam-username',
          placeholder: 'e.g., https://steamcommunity.com/profiles/71212121212121212',
          value: this.steamUsername,
          disabled: this.storefrontImporting || this.storefrontPreviewing,
          oninput: (event) => this.updateSteamUsername(event.target.value)
        }),
        m('small', 'Paste your Steam profile URL, or custom URL name.')
      ]),

      // Privacy notice
      m('div.privacy-notice', [
        m('strong', 'Note: '),
        'Your Steam profile must be set to public for this to work. ',
        m('a', {
          href: 'https://help.steampowered.com/en/faqs/view/588C-C67D-0251-C276',
          target: '_blank',
          rel: 'noopener noreferrer'
        }, 'How to make your profile public')
      ]),

      // Import options
      m('fieldset', [
        m('legend', 'Import Options'),
        m('label', [
          m('input', {
            type: 'checkbox',
            checked: this.storefrontOptions.updateExisting,
            disabled: this.storefrontImporting || this.storefrontPreviewing,
            onchange: (event) => {
              this.storefrontOptions.updateExisting = event.target.checked;
            }
          }),
          ' Update existing games (merge platforms and storefronts)'
        ]),
        m('label', [
          m('input', {
            type: 'checkbox',
            checked: this.storefrontOptions.importPlaytime,
            disabled: this.storefrontImporting || this.storefrontPreviewing,
            onchange: (event) => {
              this.storefrontOptions.importPlaytime = event.target.checked;
            }
          }),
          ' Import playtime hours'
        ]),
        m('label', [
          m('input', {
            type: 'checkbox',
            checked: this.storefrontOptions.importLastPlayed,
            disabled: this.storefrontImporting || this.storefrontPreviewing,
            onchange: (event) => {
              this.storefrontOptions.importLastPlayed = event.target.checked;
            }
          }),
          ' Import last played date'
        ])
      ]),

      // Preview button
      !this.storefrontPreview && !this.storefrontResult && m('button', {
        disabled: !hasUsername || this.storefrontPreviewing || this.storefrontImporting,
        onclick: () => this.previewStorefront()
      }, this.storefrontPreviewing ? 'Loading...' : 'Preview Library'),

      // Import button (visible once preview is loaded)
      this.storefrontPreview && !this.storefrontImporting && !this.storefrontResult && m('div.import-actions', { style: 'margin-top: 1rem;' }, [
        m('button', {
          disabled: this.storefrontImporting || this.storefrontPreview.total === 0,
          onclick: () => this.importStorefront()
        }, this.storefrontImporting ? 'Importing...' : `Import ${this.storefrontPreview.total} Games`)
      ])
    ]);
  },

  renderGogForm() {
    const hasUsername = this.gogUsername.trim().length > 0;
    const hasSession = !!this.gogSessionCookie;
    const isPublicMethod = this.gogMethod === 'public';
    const canPreview = isPublicMethod ? hasUsername : hasSession;
    const canImport = this.storefrontPreview && this.storefrontPreview.total > 0;

    return m('div.gog-form', [
      // Method selector
      m('fieldset.gog-method-selector', [
        m('legend', 'Import Method'),

        m('label.method-option', { style: 'display: block; margin-bottom: 1rem; cursor: pointer;' }, [
          m('input', {
            type: 'radio',
            name: 'gog-method',
            value: 'public',
            checked: this.gogMethod === 'public',
            disabled: this.storefrontImporting || this.storefrontPreviewing,
            onchange: () => this.setGogMethod('public')
          }),
          m('strong', ' Public Profile'),
          m('p', { style: 'margin: 0.25rem 0 0 1.5rem; font-size: 0.9em; color: var(--muted-color);' }, [
            'Enter your GOG username. Requires your profile to be set to public.',
            m('br'),
            m('small', 'Includes playtime data.')
          ])
        ]),

        m('label.method-option', { style: 'display: block; cursor: pointer;' }, [
          m('input', {
            type: 'radio',
            name: 'gog-method',
            value: 'login',
            checked: this.gogMethod === 'login',
            disabled: this.storefrontImporting || this.storefrontPreviewing,
            onchange: () => this.setGogMethod('login')
          }),
          m('strong', ' Session Cookie'),
          m('p', { style: 'margin: 0.25rem 0 0 1.5rem; font-size: 0.9em; color: var(--muted-color);' }, [
            'Paste your GOG session cookie. Works with any account, including private profiles.',
            m('br'),
            m('small', 'Does not include playtime data.')
          ])
        ])
      ]),

      // Public method: username input
      isPublicMethod && m('div.gog-public-form', [
        m('div.form-group', [
          m('label', { for: 'gog-username' }, 'GOG Profile URL or Username'),
          m('input', {
            type: 'text',
            id: 'gog-username',
            placeholder: 'e.g., https://www.gog.com/u/username or just username',
            value: this.gogUsername,
            disabled: this.storefrontImporting || this.storefrontPreviewing,
            oninput: (event) => this.updateGogUsername(event.target.value)
          }),
          m('small', 'Paste your GOG profile URL, or just your username.')
        ]),

        m('div.privacy-notice', { style: 'margin-bottom: 1rem;' }, [
          m('strong', 'Note: '),
          'Your profile must be public. ',
          m('a', {
            href: 'https://www.gog.com/account/settings/privacy',
            target: '_blank',
            rel: 'noopener noreferrer'
          }, 'Check privacy settings')
        ])
      ]),

      // Login method: session cookie input
      !isPublicMethod && m('div.gog-login-form', [
        m('div.form-group', [
          m('label', { for: 'gog-session' }, 'GOG Session Cookie'),
          m('textarea', {
            id: 'gog-session',
            rows: 3,
            placeholder: 'Paste your gog-al cookie value here...',
            value: this.gogSessionCookie || '',
            disabled: this.storefrontImporting || this.storefrontPreviewing,
            oninput: (event) => {
              this.gogSessionCookie = event.target.value.trim() || null;
            }
          }),
          m('small', [
            'To get your session cookie: ',
            m('ol', { style: 'margin: 0.5rem 0; padding-left: 1.5rem;' }, [
              m('li', 'Login to GOG.com in your browser'),
              m('li', 'Open Developer Tools (F12) and go to Application > Cookies > www.gog.com'),
              m('li', 'Find the cookie named "gog-al" and copy the entire Value (it\'s a long string)')
            ]),
            m('p', { style: 'margin-top: 0.5rem; font-style: italic;' },
              'Tip: The value is very long. Make sure to copy the entire thing, not just the visible portion.')
          ])
        ]),

        hasSession && m('div.logged-in-notice', { style: 'margin-bottom: 1rem;' }, [
          m('span', { style: 'color: var(--ins-color);' }, 'Session cookie provided'),
          ' ',
          m('button.outline.secondary', {
            style: 'padding: 0.25rem 0.5rem; font-size: 0.85em;',
            onclick: () => this.clearGogSession()
          }, 'Clear')
        ]),

        m('div.privacy-notice', { style: 'margin-bottom: 1rem;' }, [
          m('strong', 'Security Note: '),
          'Your session cookie is only used once to fetch your library and is never stored. It will be cleared after import.'
        ])
      ]),

      // Import options
      m('fieldset', [
        m('legend', 'Import Options'),
        m('label', [
          m('input', {
            type: 'checkbox',
            checked: this.storefrontOptions.updateExisting,
            disabled: this.storefrontImporting || this.storefrontPreviewing,
            onchange: (event) => {
              this.storefrontOptions.updateExisting = event.target.checked;
            }
          }),
          ' Update existing games (merge platforms and storefronts)'
        ]),
        // Only show playtime options for public method (auth doesn't have playtime)
        isPublicMethod && m('label', [
          m('input', {
            type: 'checkbox',
            checked: this.storefrontOptions.importPlaytime,
            disabled: this.storefrontImporting || this.storefrontPreviewing,
            onchange: (event) => {
              this.storefrontOptions.importPlaytime = event.target.checked;
            }
          }),
          ' Import playtime hours'
        ]),
        isPublicMethod && m('label', [
          m('input', {
            type: 'checkbox',
            checked: this.storefrontOptions.importLastPlayed,
            disabled: this.storefrontImporting || this.storefrontPreviewing,
            onchange: (event) => {
              this.storefrontOptions.importLastPlayed = event.target.checked;
            }
          }),
          ' Import last played date'
        ])
      ]),

      // Preview button
      !this.storefrontPreview && !this.storefrontResult && m('button', {
        disabled: !canPreview || this.storefrontPreviewing || this.storefrontImporting,
        onclick: () => isPublicMethod ? this.previewGogPublic() : this.previewGogAuth()
      }, this.storefrontPreviewing ? 'Loading...' : 'Preview Library'),

      // Import button (visible once preview is loaded)
      this.storefrontPreview && !this.storefrontImporting && !this.storefrontResult && m('div.import-actions', { style: 'margin-top: 1rem;' }, [
        m('button', {
          disabled: this.storefrontImporting || !canImport,
          onclick: () => isPublicMethod ? this.importGogPublic() : this.importGogAuth()
        }, this.storefrontImporting ? 'Importing...' : `Import ${this.storefrontPreview.total} Games`)
      ])
    ]);
  },

  // Epic-specific methods
  updateEpicAuthCode(value) {
    this.epicAuthCode = value.trim() || null;
  },

  clearEpicAuth() {
    this.epicAuthCode = null;
    this.storefrontResult = null;
    this.storefrontError = null;
    m.redraw();
  },

  async importEpic() {
    if (!this.epicAuthCode) {
      this.storefrontError = 'Please enter your Epic Games authorization code.';
      m.redraw();
      return;
    }

    this.storefrontImporting = true;
    this.storefrontError = null;
    this.storefrontResult = null;
    m.redraw();

    try {
      this.storefrontResult = await Meteor.callAsync('import.epic', this.epicAuthCode, {
        updateExisting: this.storefrontOptions.updateExisting,
        importPlaytime: this.storefrontOptions.importPlaytime
      });
      // Clear auth code after successful import (security best practice)
      this.epicAuthCode = null;

      // Clear progress after a short delay
      setTimeout(async () => {
        try {
          await Meteor.callAsync('import.clearStorefrontProgress');
        } catch (error) {
          console.error('Failed to clear progress:', error);
        }
      }, 2000);
    } catch (error) {
      this.storefrontError = error.reason || error.message || 'Import failed';
    }

    this.storefrontImporting = false;
    m.redraw();
  },

  // Amazon-specific methods
  openAmazonLogin() {
    // Generate a random 45-character code verifier for PKCE
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-._~';
    let verifier = '';
    for (let index = 0; index < 45; index++) {
      verifier += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    this.amazonCodeVerifier = verifier;

    // Create SHA-256 hash and base64url encode it for the code challenge
    const encoder = new TextEncoder();
    const data = encoder.encode(verifier);

    crypto.subtle.digest('SHA-256', data).then(hashBuffer => {
      const hashArray = new Uint8Array(hashBuffer);
      // Convert to base64url encoding
      let base64 = btoa(String.fromCharCode.apply(null, hashArray));
      const challenge = base64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

      // Generate a unique device serial (UUID without dashes, uppercase)
      const uuid = crypto.randomUUID().replace(/-/g, '').toUpperCase();
      this.amazonDeviceSerial = uuid;

      // Build client ID: serial + "#A2UMVHOX7UP4V7", then hex-encode
      const clientIdRaw = uuid + '#A2UMVHOX7UP4V7';
      let clientId = '';
      for (let i = 0; i < clientIdRaw.length; i++) {
        clientId += clientIdRaw.charCodeAt(i).toString(16).padStart(2, '0');
      }

      // Build OAuth URL matching Playnite's exact parameter order
      // Amazon's server is picky about this
      const params = [
        'openid.ns=' + encodeURIComponent('http://specs.openid.net/auth/2.0'),
        'openid.claimed_id=' + encodeURIComponent('http://specs.openid.net/auth/2.0/identifier_select'),
        'openid.identity=' + encodeURIComponent('http://specs.openid.net/auth/2.0/identifier_select'),
        'openid.mode=checkid_setup',
        'openid.oa2.scope=device_auth_access',
        'openid.ns.oa2=' + encodeURIComponent('http://www.amazon.com/ap/ext/oauth/2'),
        'openid.oa2.response_type=code',
        'openid.oa2.code_challenge_method=S256',
        'openid.oa2.client_id=' + encodeURIComponent('device:' + clientId),
        'language=en_US',
        'marketPlaceId=ATVPDKIKX0DER',
        'openid.return_to=' + encodeURIComponent('https://www.amazon.com'),
        'openid.pape.max_auth_age=0',
        'openid.assoc_handle=amzn_sonic_games_launcher',
        'pageId=amzn_sonic_games_launcher',
        'openid.oa2.code_challenge=' + encodeURIComponent(challenge)
      ];

      const oauthUrl = 'https://www.amazon.com/ap/signin?' + params.join('&');

      // Open popup window
      const width = 500;
      const height = 700;
      const left = window.screenX + (window.outerWidth - width) / 2;
      const top = window.screenY + (window.outerHeight - height) / 2;

      this.amazonLoginWindow = window.open(
        oauthUrl,
        'amazon-login',
        `width=${width},height=${height},left=${left},top=${top},menubar=no,toolbar=no,location=yes,status=no`
      );

      if (!this.amazonLoginWindow) {
        this.storefrontError = 'Could not open login popup. Please allow popups for this site.';
        m.redraw();
      }
    });
  },

  updateAmazonAuthCode(value) {
    this.amazonAuthCode = value.trim() || null;
  },

  clearAmazonAuth() {
    this.amazonAuthCode = null;
    this.amazonCodeVerifier = null;
    this.amazonDeviceSerial = null;
    if (this.amazonLoginWindow && !this.amazonLoginWindow.closed) {
      this.amazonLoginWindow.close();
    }
    this.amazonLoginWindow = null;
    this.storefrontResult = null;
    this.storefrontError = null;
    m.redraw();
  },

  async importAmazon() {
    if (!this.amazonAuthCode || !this.amazonCodeVerifier || !this.amazonDeviceSerial) {
      this.storefrontError = 'Please log in to Amazon first to get the authorization code.';
      m.redraw();
      return;
    }

    this.storefrontImporting = true;
    this.storefrontError = null;
    this.storefrontResult = null;
    m.redraw();

    try {
      this.storefrontResult = await Meteor.callAsync('import.amazon', this.amazonAuthCode, this.amazonCodeVerifier, this.amazonDeviceSerial, {
        updateExisting: this.storefrontOptions.updateExisting
      });
      // Clear auth data after successful import (security best practice)
      this.amazonAuthCode = null;
      this.amazonCodeVerifier = null;
      this.amazonDeviceSerial = null;

      // Clear progress after a short delay
      setTimeout(async () => {
        try {
          await Meteor.callAsync('import.clearStorefrontProgress');
        } catch (error) {
          console.error('Failed to clear progress:', error);
        }
      }, 2000);
    } catch (error) {
      this.storefrontError = error.reason || error.message || 'Import failed';
    }

    this.storefrontImporting = false;
    m.redraw();
  },

  renderAmazonForm() {
    const hasAuthCode = !!this.amazonAuthCode;
    const hasCodeVerifier = !!this.amazonCodeVerifier;

    return m('div.amazon-form', [
      // Instructions - before login
      !hasCodeVerifier && m('div.amazon-instructions', { style: 'margin-bottom: 1rem;' }, [
        m('h4', 'Import from Amazon Games'),
        m('p', { style: 'margin-bottom: 0.5rem;' },
          'Click the button below to open the Amazon login window.'
        )
      ]),

      // Login button - generates code verifier and opens popup
      !hasAuthCode && m('button', {
        disabled: this.storefrontImporting,
        onclick: () => this.openAmazonLogin(),
        style: 'margin-bottom: 1rem;'
      }, 'Open Amazon Login'),

      // Instructions - after login window opens
      hasCodeVerifier && !hasAuthCode && m('div.amazon-instructions', { style: 'margin-bottom: 1rem;' }, [
        m('h4', 'Capture the Authorization Code'),
        m('p', { style: 'margin-bottom: 0.5rem; color: var(--muted-color); font-size: 0.9em;' },
          'In the popup window that just opened, follow these steps:'
        ),
        m('ol', { style: 'margin: 0.5rem 0; padding-left: 1.5rem; font-size: 0.95em;' }, [
          m('li', [
            'In the ',
            m('strong', 'popup window'),
            ', open Developer Tools: ',
            m('kbd', { style: 'font-size: 0.85em;' }, 'F12'),
            ' (Windows) or ',
            m('kbd', { style: 'font-size: 0.85em;' }, 'Cmd+Option+I'),
            ' (Mac)'
          ]),
          m('li', [
            'Go to the ',
            m('strong', 'Network'),
            ' tab and check ',
            m('strong', '"Preserve log"')
          ]),
          m('li', 'Log in to your Amazon account'),
          m('li', [
            'After redirect, in the Network tab look for a request to ',
            m('code', 'amazon.com'),
            ' containing ',
            m('code', 'openid.oa2.authorization_code')
          ]),
          m('li', 'Copy that code value and paste it below')
        ])
      ]),

      // Auth code input
      hasCodeVerifier && !hasAuthCode && m('div.form-group', { style: 'margin-bottom: 1rem;' }, [
        m('label', { for: 'amazon-auth-code' }, 'Authorization Code'),
        m('input', {
          type: 'text',
          id: 'amazon-auth-code',
          placeholder: 'Paste openid.oa2.authorization_code value here...',
          value: this.amazonAuthCode || '',
          disabled: this.storefrontImporting,
          oninput: (event) => this.updateAmazonAuthCode(event.target.value)
        })
      ]),

      // Auth code status
      hasAuthCode && m('div.auth-status', { style: 'margin-bottom: 1rem;' }, [
        m('span', { style: 'color: var(--ins-color);' }, 'Authorization code provided'),
        ' ',
        m('button.outline.secondary', {
          style: 'padding: 0.25rem 0.5rem; font-size: 0.85em;',
          onclick: () => this.clearAmazonAuth()
        }, 'Clear')
      ]),

      // Security notice
      m('div.privacy-notice', { style: 'margin-bottom: 1rem;' }, [
        m('strong', 'Security Note: '),
        'Your authorization code is only used once to fetch your library and is never stored. It will be cleared after import.'
      ]),

      // Import options
      m('fieldset', [
        m('legend', 'Import Options'),
        m('label', [
          m('input', {
            type: 'checkbox',
            checked: this.storefrontOptions.updateExisting,
            disabled: this.storefrontImporting,
            onchange: (event) => {
              this.storefrontOptions.updateExisting = event.target.checked;
            }
          }),
          ' Update existing games (merge platforms and storefronts)'
        ])
      ]),

      // Import button
      !this.storefrontResult && m('button', {
        disabled: !hasAuthCode || this.storefrontImporting,
        onclick: () => this.importAmazon()
      }, this.storefrontImporting ? 'Importing...' : 'Import from Amazon')
    ]);
  },

  // Oculus-specific methods
  updateOculusAccessToken(value) {
    this.oculusAccessToken = value.trim() || null;
  },

  setOculusPlatform(platform) {
    this.oculusPlatform = platform;
  },

  clearOculusAuth() {
    this.oculusAccessToken = null;
    this.storefrontResult = null;
    this.storefrontError = null;
    m.redraw();
  },

  async importOculus() {
    if (!this.oculusAccessToken) {
      this.storefrontError = 'Please enter your Oculus access token.';
      m.redraw();
      return;
    }

    this.storefrontImporting = true;
    this.storefrontError = null;
    this.storefrontResult = null;
    m.redraw();

    try {
      this.storefrontResult = await Meteor.callAsync('import.oculus', this.oculusAccessToken, this.oculusPlatform, {
        updateExisting: this.storefrontOptions.updateExisting
      });
      // Clear access token after successful import (security best practice)
      this.oculusAccessToken = null;

      // Clear progress after a short delay
      setTimeout(async () => {
        try {
          await Meteor.callAsync('import.clearStorefrontProgress');
        } catch (error) {
          console.error('Failed to clear progress:', error);
        }
      }, 2000);
    } catch (error) {
      this.storefrontError = error.reason || error.message || 'Import failed';
    }

    this.storefrontImporting = false;
    m.redraw();
  },

  renderOculusForm() {
    const hasAccessToken = !!this.oculusAccessToken;

    return m('div.oculus-form', [
      // Platform selector
      m('div.form-group', [
        m('label', { for: 'oculus-platform' }, 'Platform'),
        m('select', {
          id: 'oculus-platform',
          value: this.oculusPlatform,
          disabled: this.storefrontImporting,
          onchange: (event) => this.setOculusPlatform(event.target.value)
        }, [
          m('option', { value: 'quest' }, 'Meta Quest (Quest, Quest 2, Quest 3, Quest Pro)'),
          m('option', { value: 'rift' }, 'Oculus Rift / Rift S (PC VR)'),
          m('option', { value: 'go' }, 'Oculus Go')
        ])
      ]),

      // Instructions
      m('div.oculus-instructions', { style: 'margin-bottom: 1rem;' }, [
        m('h4', 'How to get your access token:'),
        m('p', { style: 'margin-bottom: 0.5rem; font-weight: bold;' }, 'Option 1: From the Oculus website'),
        m('ol', { style: 'margin: 0.5rem 0; padding-left: 1.5rem;' }, [
          m('li', [
            'Go to ',
            m('a', {
              href: 'https://secure.oculus.com/my/quest/',
              target: '_blank',
              rel: 'noopener noreferrer'
            }, 'secure.oculus.com/my/quest'),
            ' and log in'
          ]),
          m('li', 'Open Developer Tools (F12 on Windows, Cmd+Option+I on Mac)'),
          m('li', 'Go to the Application tab (Chrome) or Storage tab (Firefox)'),
          m('li', [
            'Expand Cookies and click on ',
            m('code', 'https://secure.oculus.com')
          ]),
          m('li', [
            'Find the cookie named ',
            m('code', 'oc_ac_at'),
            ' and copy the entire Value (starts with "OC")'
          ])
        ]),
        m('p', { style: 'margin: 1rem 0 0.5rem 0; font-weight: bold;' }, 'Option 2: From the Oculus desktop app'),
        m('ol', { style: 'margin: 0.5rem 0; padding-left: 1.5rem;' }, [
          m('li', 'Open the Oculus desktop app'),
          m('li', [
            'Press ',
            m('kbd', 'Ctrl+Shift+I'),
            ' to open Developer Tools'
          ]),
          m('li', [
            'Go to the Network tab and press ',
            m('kbd', 'Ctrl+R'),
            ' to refresh'
          ]),
          m('li', [
            'Filter for "',
            m('code', 'graph'),
            '", click the first result, open the Payload tab'
          ]),
          m('li', 'Scroll to find the access_token (starts with "FRL") and copy it')
        ])
      ]),

      // Access token input
      m('div.form-group', [
        m('label', { for: 'oculus-token' }, 'Access Token'),
        m('textarea', {
          id: 'oculus-token',
          rows: 3,
          placeholder: 'Paste your access token here (starts with OC or FRL)...',
          value: this.oculusAccessToken || '',
          disabled: this.storefrontImporting,
          oninput: (event) => this.updateOculusAccessToken(event.target.value)
        })
      ]),

      hasAccessToken && m('div.auth-status', { style: 'margin-bottom: 1rem;' }, [
        m('span', { style: 'color: var(--ins-color);' }, 'Access token provided'),
        ' ',
        m('button.outline.secondary', {
          style: 'padding: 0.25rem 0.5rem; font-size: 0.85em;',
          onclick: () => this.clearOculusAuth()
        }, 'Clear')
      ]),

      // Security notice
      m('div.privacy-notice', { style: 'margin-bottom: 1rem;' }, [
        m('strong', 'Security Note: '),
        'Your access token is only used once to fetch your library and is never stored. It will be cleared after import.'
      ]),

      // Import options
      m('fieldset', [
        m('legend', 'Import Options'),
        m('label', [
          m('input', {
            type: 'checkbox',
            checked: this.storefrontOptions.updateExisting,
            disabled: this.storefrontImporting,
            onchange: (event) => {
              this.storefrontOptions.updateExisting = event.target.checked;
            }
          }),
          ' Update existing games (merge platforms and storefronts)'
        ])
      ]),

      // Import button (no preview step - token is single-use)
      !this.storefrontResult && m('button', {
        disabled: !hasAccessToken || this.storefrontImporting,
        onclick: () => this.importOculus()
      }, this.storefrontImporting ? 'Importing...' : 'Import from Oculus')
    ]);
  },

  // EA-specific methods
  updateEaBearerToken(value) {
    this.eaBearerToken = value.trim() || null;
  },

  clearEaAuth() {
    this.eaBearerToken = null;
    this.storefrontResult = null;
    this.storefrontError = null;
    m.redraw();
  },

  async importEa() {
    if (!this.eaBearerToken) {
      this.storefrontError = 'Please enter your EA bearer token.';
      m.redraw();
      return;
    }

    this.storefrontImporting = true;
    this.storefrontError = null;
    this.storefrontResult = null;
    m.redraw();

    try {
      this.storefrontResult = await Meteor.callAsync('import.ea', this.eaBearerToken, {
        updateExisting: this.storefrontOptions.updateExisting,
        importPlaytime: this.storefrontOptions.importPlaytime
      });
      // Clear bearer token after successful import (security best practice)
      this.eaBearerToken = null;

      // Clear progress after a short delay
      setTimeout(async () => {
        try {
          await Meteor.callAsync('import.clearStorefrontProgress');
        } catch (error) {
          console.error('Failed to clear progress:', error);
        }
      }, 2000);
    } catch (error) {
      this.storefrontError = error.reason || error.message || 'Import failed';
    }

    this.storefrontImporting = false;
    m.redraw();
  },

  renderEaForm() {
    const hasBearerToken = !!this.eaBearerToken;

    return m('div.ea-form', [
      // Instructions
      m('div.ea-instructions', { style: 'margin-bottom: 1rem;' }, [
        m('h4', 'How to get your access token:'),
        m('ol', { style: 'margin: 0.5rem 0; padding-left: 1.5rem;' }, [
          m('li', [
            'Log in to your EA account at ',
            m('a', {
              href: 'https://www.ea.com/login',
              target: '_blank',
              rel: 'noopener noreferrer'
            }, 'ea.com/login')
          ]),
          m('li', [
            'Then open ',
            m('a', {
              href: 'https://accounts.ea.com/connect/auth?client_id=ORIGIN_JS_SDK&response_type=token&redirect_uri=nucleus:rest&prompt=none',
              target: '_blank',
              rel: 'noopener noreferrer'
            }, 'this link'),
            ' — it will show JSON with an ',
            m('code', 'access_token'),
            ' field. Copy that value (a long string of letters and numbers)'
          ])
        ]),
        m('small', { style: 'color: var(--muted-color);' },
          'If the link shows an error, make sure you are logged in at ea.com first.'
        )
      ]),

      // Bearer token input
      m('div.form-group', [
        m('label', { for: 'ea-token' }, 'Access Token'),
        m('textarea', {
          id: 'ea-token',
          rows: 3,
          placeholder: 'Paste your access_token value here...',
          value: this.eaBearerToken || '',
          disabled: this.storefrontImporting,
          oninput: (event) => this.updateEaBearerToken(event.target.value)
        })
      ]),

      hasBearerToken && m('div.auth-status', { style: 'margin-bottom: 1rem;' }, [
        m('span', { style: 'color: var(--ins-color);' }, 'Access token provided'),
        ' ',
        m('button.outline.secondary', {
          style: 'padding: 0.25rem 0.5rem; font-size: 0.85em;',
          onclick: () => this.clearEaAuth()
        }, 'Clear')
      ]),

      // Security notice
      m('div.privacy-notice', { style: 'margin-bottom: 1rem;' }, [
        m('strong', 'Security Note: '),
        'Your access token is only used once to fetch your game library and is never stored. It will be cleared after import.'
      ]),

      // Import options
      m('fieldset', [
        m('legend', 'Import Options'),
        m('label', [
          m('input', {
            type: 'checkbox',
            checked: this.storefrontOptions.updateExisting,
            disabled: this.storefrontImporting,
            onchange: (event) => {
              this.storefrontOptions.updateExisting = event.target.checked;
            }
          }),
          ' Update existing games (merge platforms and storefronts)'
        ]),
        m('label', [
          m('input', {
            type: 'checkbox',
            checked: this.storefrontOptions.importPlaytime,
            disabled: this.storefrontImporting,
            onchange: (event) => {
              this.storefrontOptions.importPlaytime = event.target.checked;
            }
          }),
          ' Import playtime hours'
        ])
      ]),

      // Import button (no preview step - token is single-use)
      !this.storefrontResult && m('button', {
        disabled: !hasBearerToken || this.storefrontImporting,
        onclick: () => this.importEa()
      }, this.storefrontImporting ? 'Importing...' : 'Import from EA App')
    ]);
  },

  // Xbox-specific methods
  updateXboxAuthCode(value) {
    const trimmed = value.trim();
    // Accept either a raw code or a full callback URL containing ?code=
    if (trimmed.includes('code=')) {
      try {
        const url = new URL(trimmed);
        const code = url.searchParams.get('code');
        this.xboxAuthCode = code || trimmed;
      } catch (error) {
        // Not a valid URL, use as-is
        this.xboxAuthCode = trimmed || null;
      }
    } else {
      this.xboxAuthCode = trimmed || null;
    }
  },

  clearXboxAuth() {
    this.xboxAuthCode = null;
    this.storefrontResult = null;
    this.storefrontError = null;
    m.redraw();
  },

  async importXbox() {
    if (!this.xboxAuthCode) {
      this.storefrontError = 'Please enter your Microsoft authorization code.';
      m.redraw();
      return;
    }

    this.storefrontImporting = true;
    this.storefrontError = null;
    this.storefrontResult = null;
    m.redraw();

    try {
      this.storefrontResult = await Meteor.callAsync('import.xbox', this.xboxAuthCode, {
        updateExisting: this.storefrontOptions.updateExisting,
        importPlaytime: this.storefrontOptions.importPlaytime
      });
      // Clear auth code after successful import (security best practice)
      this.xboxAuthCode = null;

      // Clear progress after a short delay
      setTimeout(async () => {
        try {
          await Meteor.callAsync('import.clearStorefrontProgress');
        } catch (error) {
          console.error('Failed to clear progress:', error);
        }
      }, 2000);
    } catch (error) {
      this.storefrontError = error.reason || error.message || 'Import failed';
    }

    this.storefrontImporting = false;
    m.redraw();
  },

  renderXboxForm() {
    const hasAuthCode = !!this.xboxAuthCode;

    return m('div.xbox-form', [
      // Instructions
      m('div.xbox-instructions', { style: 'margin-bottom: 1rem;' }, [
        m('h4', 'How to get your authorization code:'),
        m('ol', { style: 'margin: 0.5rem 0; padding-left: 1.5rem;' }, [
          m('li', [
            'Click this link to open Microsoft login: ',
            m('a', {
              href: 'https://login.live.com/oauth20_authorize.srf?client_id=388ea51c-0b25-4029-aae2-17df49d23905&response_type=code&approval_prompt=auto&scope=Xboxlive.signin+Xboxlive.offline_access&redirect_uri=http%3A%2F%2Flocalhost%3A8080%2Fauth%2Fcallback',
              target: '_blank',
              rel: 'noopener noreferrer'
            }, 'Get Authorization Code')
          ]),
          m('li', 'Log in to your Microsoft account if prompted'),
          m('li', [
            'After login, the page will show a "can\'t reach this page" error — ',
            m('strong', 'this is expected')
          ]),
          m('li', [
            'Copy the ',
            m('strong', 'entire URL'),
            ' from the address bar and paste it below (the code will be extracted automatically)'
          ])
        ])
      ]),

      // Auth code input
      m('div.form-group', [
        m('label', { for: 'xbox-auth-code' }, 'Authorization Code'),
        m('input', {
          type: 'text',
          id: 'xbox-auth-code',
          placeholder: 'Paste the full URL or authorization code here...',
          value: this.xboxAuthCode || '',
          disabled: this.storefrontImporting,
          oninput: (event) => this.updateXboxAuthCode(event.target.value)
        }),
        m('small', 'You can paste the full URL — the code will be extracted automatically.')
      ]),

      hasAuthCode && m('div.auth-status', { style: 'margin-bottom: 1rem;' }, [
        m('span', { style: 'color: var(--ins-color);' }, 'Authorization code provided'),
        ' ',
        m('button.outline.secondary', {
          style: 'padding: 0.25rem 0.5rem; font-size: 0.85em;',
          onclick: () => this.clearXboxAuth()
        }, 'Clear')
      ]),

      // Security notice
      m('div.privacy-notice', { style: 'margin-bottom: 1rem;' }, [
        m('strong', 'Security Note: '),
        'Your authorization code is only used once to fetch your game library and is never stored. All tokens are discarded after import.'
      ]),

      // Import options
      m('fieldset', [
        m('legend', 'Import Options'),
        m('label', [
          m('input', {
            type: 'checkbox',
            checked: this.storefrontOptions.updateExisting,
            disabled: this.storefrontImporting,
            onchange: (event) => {
              this.storefrontOptions.updateExisting = event.target.checked;
            }
          }),
          ' Update existing games (merge platforms and storefronts)'
        ]),
        m('label', [
          m('input', {
            type: 'checkbox',
            checked: this.storefrontOptions.importPlaytime,
            disabled: this.storefrontImporting,
            onchange: (event) => {
              this.storefrontOptions.importPlaytime = event.target.checked;
            }
          }),
          ' Import playtime hours'
        ])
      ]),

      // Import button (no preview step - auth codes are single-use)
      !this.storefrontResult && m('button', {
        disabled: !hasAuthCode || this.storefrontImporting,
        onclick: () => this.importXbox()
      }, this.storefrontImporting ? 'Importing...' : 'Import from Xbox')
    ]);
  },

  // Ubisoft-specific methods
  updateUbisoftEmail(value) {
    this.ubisoftEmail = value;
  },

  updateUbisoftPassword(value) {
    this.ubisoftPassword = value;
  },

  updateUbisoftTwoFactorCode(value) {
    this.ubisoftTwoFactorCode = value;
  },

  clearUbisoftAuth() {
    this.ubisoftEmail = '';
    this.ubisoftPassword = '';
    this.ubisoftTwoFactorTicket = null;
    this.ubisoftTwoFactorCode = '';
    this.ubisoftNeeds2FA = false;
    this.storefrontResult = null;
    this.storefrontError = null;
    m.redraw();
  },

  async importUbisoft() {
    if (!this.ubisoftEmail.trim() || !this.ubisoftPassword) {
      this.storefrontError = 'Email and password are required.';
      m.redraw();
      return;
    }

    this.storefrontImporting = true;
    this.storefrontError = null;
    this.storefrontResult = null;
    m.redraw();

    try {
      this.storefrontResult = await Meteor.callAsync('import.ubisoft', this.ubisoftEmail, this.ubisoftPassword, {
        updateExisting: this.storefrontOptions.updateExisting
      });
      // Clear credentials after successful import
      this.ubisoftEmail = '';
      this.ubisoftPassword = '';

      // Clear progress after a short delay
      setTimeout(async () => {
        try {
          await Meteor.callAsync('import.clearStorefrontProgress');
        } catch (error) {
          console.error('Failed to clear progress:', error);
        }
      }, 2000);
    } catch (error) {
      if (error.error === 'auth-2fa-required') {
        // 2FA required - store ticket and show 2FA input
        this.ubisoftTwoFactorTicket = error.details;
        this.ubisoftNeeds2FA = true;
        // Clear password from memory
        this.ubisoftPassword = '';
      } else {
        this.storefrontError = error.reason || error.message || 'Import failed';
      }
    }

    this.storefrontImporting = false;
    m.redraw();
  },

  async importUbisoft2FA() {
    if (!this.ubisoftTwoFactorTicket || !this.ubisoftTwoFactorCode.trim()) {
      this.storefrontError = 'Please enter the verification code.';
      m.redraw();
      return;
    }

    this.storefrontImporting = true;
    this.storefrontError = null;
    this.storefrontResult = null;
    m.redraw();

    try {
      this.storefrontResult = await Meteor.callAsync('import.ubisoft2fa', this.ubisoftTwoFactorTicket, this.ubisoftTwoFactorCode, {
        updateExisting: this.storefrontOptions.updateExisting
      });
      // Clear all Ubisoft state after successful import
      this.ubisoftEmail = '';
      this.ubisoftPassword = '';
      this.ubisoftTwoFactorTicket = null;
      this.ubisoftTwoFactorCode = '';
      this.ubisoftNeeds2FA = false;

      // Clear progress after a short delay
      setTimeout(async () => {
        try {
          await Meteor.callAsync('import.clearStorefrontProgress');
        } catch (error) {
          console.error('Failed to clear progress:', error);
        }
      }, 2000);
    } catch (error) {
      this.storefrontError = error.reason || error.message || 'Import failed';
    }

    this.storefrontImporting = false;
    m.redraw();
  },

  renderUbisoftForm() {
    const hasCredentials = this.ubisoftEmail.trim().length > 0 && this.ubisoftPassword.length > 0;
    const hasCode = this.ubisoftTwoFactorCode.trim().length > 0;

    return m('div.ubisoft-form', [
      // Security notice
      m('div.privacy-notice', { style: 'margin-bottom: 1rem;' }, [
        m('strong', 'Security Note: '),
        'Your credentials are sent directly to Ubisoft for authentication and are never stored. They are discarded immediately after use.'
      ]),

      // Email input
      m('div.form-group', [
        m('label', { for: 'ubisoft-email' }, 'Ubisoft Account Email'),
        m('input', {
          type: 'email',
          id: 'ubisoft-email',
          placeholder: 'your@email.com',
          value: this.ubisoftEmail,
          disabled: this.storefrontImporting || this.ubisoftNeeds2FA,
          autocomplete: 'off',
          oninput: (event) => this.updateUbisoftEmail(event.target.value)
        })
      ]),

      // Password input
      m('div.form-group', [
        m('label', { for: 'ubisoft-password' }, 'Password'),
        m('input', {
          type: 'password',
          id: 'ubisoft-password',
          placeholder: 'Enter your password',
          value: this.ubisoftPassword,
          disabled: this.storefrontImporting || this.ubisoftNeeds2FA,
          autocomplete: 'off',
          oninput: (event) => this.updateUbisoftPassword(event.target.value)
        })
      ]),

      // 2FA code input (only shown when 2FA is required)
      this.ubisoftNeeds2FA && m('div.ubisoft-2fa', [
        m('div.auth-status', { style: 'margin-bottom: 1rem; color: var(--ins-color);' },
          'Two-factor authentication required. Enter the code from your authenticator app or SMS.'
        ),
        m('div.form-group', [
          m('label', { for: 'ubisoft-2fa-code' }, 'Verification Code'),
          m('input', {
            type: 'text',
            id: 'ubisoft-2fa-code',
            placeholder: 'Enter 6-digit code',
            value: this.ubisoftTwoFactorCode,
            disabled: this.storefrontImporting,
            autocomplete: 'off',
            oninput: (event) => this.updateUbisoftTwoFactorCode(event.target.value)
          })
        ])
      ]),

      // Import options
      m('fieldset', [
        m('legend', 'Import Options'),
        m('label', [
          m('input', {
            type: 'checkbox',
            checked: this.storefrontOptions.updateExisting,
            disabled: this.storefrontImporting,
            onchange: (event) => {
              this.storefrontOptions.updateExisting = event.target.checked;
            }
          }),
          ' Update existing games (merge platforms and storefronts)'
        ])
      ]),

      // Action buttons
      !this.storefrontResult && !this.ubisoftNeeds2FA && m('button', {
        disabled: !hasCredentials || this.storefrontImporting,
        onclick: () => this.importUbisoft()
      }, this.storefrontImporting ? 'Authenticating...' : 'Import from Ubisoft Connect'),

      !this.storefrontResult && this.ubisoftNeeds2FA && m('div.ubisoft-2fa-actions', [
        m('button', {
          disabled: !hasCode || this.storefrontImporting,
          onclick: () => this.importUbisoft2FA()
        }, this.storefrontImporting ? 'Verifying...' : 'Verify & Import'),
        ' ',
        m('button.outline.secondary', {
          disabled: this.storefrontImporting,
          onclick: () => this.clearUbisoftAuth()
        }, 'Cancel')
      ])
    ]);
  },

  renderEpicForm() {
    const hasAuthCode = !!this.epicAuthCode;

    return m('div.epic-form', [
      // Instructions
      m('div.epic-instructions', { style: 'margin-bottom: 1rem;' }, [
        m('h4', 'How to get your authorization code:'),
        m('ol', { style: 'margin: 0.5rem 0; padding-left: 1.5rem;' }, [
          m('li', [
            'Click this link to open Epic Games login: ',
            m('a', {
              href: 'https://www.epicgames.com/id/login?redirectUrl=https%3A%2F%2Fwww.epicgames.com%2Fid%2Fapi%2Fredirect%3FclientId%3D34a02cf8f4414e29b15921876da36f9a%26responseType%3Dcode',
              target: '_blank',
              rel: 'noopener noreferrer'
            }, 'Get Authorization Code')
          ]),
          m('li', 'Log in to your Epic Games account if prompted'),
          m('li', 'You will see a page with JSON containing your authorization code'),
          m('li', 'Copy the value next to "authorizationCode" (without quotes)')
        ])
      ]),

      // Auth code input
      m('div.form-group', [
        m('label', { for: 'epic-auth-code' }, 'Authorization Code'),
        m('input', {
          type: 'text',
          id: 'epic-auth-code',
          placeholder: 'Paste your authorization code here...',
          value: this.epicAuthCode || '',
          disabled: this.storefrontImporting,
          oninput: (event) => this.updateEpicAuthCode(event.target.value)
        }),
        m('small', 'The code looks like a long string of letters and numbers.')
      ]),

      hasAuthCode && m('div.auth-status', { style: 'margin-bottom: 1rem;' }, [
        m('span', { style: 'color: var(--ins-color);' }, 'Authorization code provided'),
        ' ',
        m('button.outline.secondary', {
          style: 'padding: 0.25rem 0.5rem; font-size: 0.85em;',
          onclick: () => this.clearEpicAuth()
        }, 'Clear')
      ]),

      // Security notice
      m('div.privacy-notice', { style: 'margin-bottom: 1rem;' }, [
        m('strong', 'Security Note: '),
        'Your authorization code is only used once to fetch your library and is never stored. It will be cleared after import.'
      ]),

      // Import options
      m('fieldset', [
        m('legend', 'Import Options'),
        m('label', [
          m('input', {
            type: 'checkbox',
            checked: this.storefrontOptions.updateExisting,
            disabled: this.storefrontImporting,
            onchange: (event) => {
              this.storefrontOptions.updateExisting = event.target.checked;
            }
          }),
          ' Update existing games (merge platforms and storefronts)'
        ]),
        m('label', [
          m('input', {
            type: 'checkbox',
            checked: this.storefrontOptions.importPlaytime,
            disabled: this.storefrontImporting,
            onchange: (event) => {
              this.storefrontOptions.importPlaytime = event.target.checked;
            }
          }),
          ' Import playtime hours'
        ])
      ]),

      // Import button (no preview step - auth codes are single-use)
      !this.storefrontResult && m('button', {
        disabled: !hasAuthCode || this.storefrontImporting,
        onclick: () => this.importEpic()
      }, this.storefrontImporting ? 'Importing...' : 'Import from Epic')
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
