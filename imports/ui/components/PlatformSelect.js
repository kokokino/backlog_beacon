import m from 'mithril';

// Common platforms for suggestions
const COMMON_PLATFORMS = [
  // Current Gen Consoles
  { id: 'PlayStation 5', name: 'PlayStation 5', category: 'console' },
  { id: 'Xbox Series X|S', name: 'Xbox Series X|S', category: 'console' },
  { id: 'Nintendo Switch', name: 'Nintendo Switch', category: 'console' },
  
  // Previous Gen Consoles
  { id: 'PlayStation 4', name: 'PlayStation 4', category: 'console' },
  { id: 'Xbox One', name: 'Xbox One', category: 'console' },
  { id: 'Wii U', name: 'Wii U', category: 'console' },
  { id: 'Nintendo 3DS', name: 'Nintendo 3DS', category: 'console' },
  { id: 'PlayStation Vita', name: 'PlayStation Vita', category: 'console' },
  
  // Classic Consoles
  { id: 'PlayStation 3', name: 'PlayStation 3', category: 'classic' },
  { id: 'Xbox 360', name: 'Xbox 360', category: 'classic' },
  { id: 'Wii', name: 'Wii', category: 'classic' },
  { id: 'PlayStation 2', name: 'PlayStation 2', category: 'classic' },
  { id: 'PlayStation', name: 'PlayStation', category: 'classic' },
  { id: 'Nintendo 64', name: 'Nintendo 64', category: 'classic' },
  { id: 'Super Nintendo', name: 'Super Nintendo', category: 'classic' },
  { id: 'NES', name: 'NES', category: 'classic' },
  { id: 'Sega Genesis', name: 'Sega Genesis', category: 'classic' },
  { id: 'Sega Dreamcast', name: 'Sega Dreamcast', category: 'classic' },
  
  // PC
  { id: 'PC', name: 'PC', category: 'pc' },
  { id: 'macOS', name: 'macOS', category: 'pc' },
  { id: 'Linux', name: 'Linux', category: 'pc' },
  
  // Mobile
  { id: 'iOS', name: 'iOS', category: 'mobile' },
  { id: 'Android', name: 'Android', category: 'mobile' },
  
  // VR
  { id: 'Meta Quest', name: 'Meta Quest', category: 'vr' },
  { id: 'PlayStation VR', name: 'PlayStation VR', category: 'vr' },
  { id: 'PlayStation VR2', name: 'PlayStation VR2', category: 'vr' },
  { id: 'SteamVR', name: 'SteamVR', category: 'vr' }
];

const PLATFORM_CATEGORIES = [
  { id: 'console', name: 'Current & Recent Consoles' },
  { id: 'classic', name: 'Classic Consoles' },
  { id: 'pc', name: 'PC' },
  { id: 'mobile', name: 'Mobile' },
  { id: 'vr', name: 'VR' }
];

// Multi-select platform component with chips and dropdown
export const PlatformSelect = {
  oninit(vnode) {
    this.isOpen = false;
    this.customInput = '';
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
  },
  
  onremove(vnode) {
    document.removeEventListener('click', this.handleClickOutside);
  },
  
  togglePlatform(vnode, platform) {
    const { value = [], onChange, disabled } = vnode.attrs;
    
    if (disabled) {
      return;
    }
    
    const normalizedPlatform = platform.trim();
    if (!normalizedPlatform) {
      return;
    }
    
    const existingIndex = value.findIndex(p => p.toLowerCase() === normalizedPlatform.toLowerCase());
    
    let newValue;
    if (existingIndex >= 0) {
      newValue = value.filter((_, index) => index !== existingIndex);
    } else {
      newValue = [...value, normalizedPlatform];
    }
    
    if (onChange) {
      onChange(newValue);
    }
  },
  
  removePlatform(vnode, platform, event) {
    event.stopPropagation();
    const { value = [], onChange, disabled } = vnode.attrs;
    
    if (disabled) {
      return;
    }
    
    const newValue = value.filter(p => p.toLowerCase() !== platform.toLowerCase());
    
    if (onChange) {
      onChange(newValue);
    }
  },
  
  addCustomPlatform(vnode) {
    const { value = [], onChange, disabled } = vnode.attrs;
    
    if (disabled) {
      return;
    }
    
    const platform = this.customInput.trim();
    if (!platform) {
      return;
    }
    
    // Check if already exists
    if (value.some(p => p.toLowerCase() === platform.toLowerCase())) {
      this.customInput = '';
      return;
    }
    
    const newValue = [...value, platform];
    
    if (onChange) {
      onChange(newValue);
    }
    
    this.customInput = '';
  },
  
  isPlatformSelected(vnode, platform) {
    const { value = [] } = vnode.attrs;
    return value.some(p => p.toLowerCase() === platform.toLowerCase());
  },
  
  getPlatformsByCategory() {
    const grouped = {};
    
    for (const category of PLATFORM_CATEGORIES) {
      const platforms = COMMON_PLATFORMS.filter(p => p.category === category.id);
      if (platforms.length > 0) {
        grouped[category.id] = {
          name: category.name,
          platforms: platforms
        };
      }
    }
    
    return grouped;
  },
  
  view(vnode) {
    const { value = [], disabled = false, label = 'Platforms', gamePlatforms = [] } = vnode.attrs;
    const groupedPlatforms = this.getPlatformsByCategory();
    
    // Show game-specific platforms at the top if available
    const hasGamePlatforms = gamePlatforms.length > 0;
    
    return m('div.platform-select', { class: disabled ? 'disabled' : '' }, [
      label && m('label.platform-label', label),
      
      m('div.platform-input-container', {
        onclick: () => {
          if (!disabled) {
            this.isOpen = !this.isOpen;
          }
        }
      }, [
        // Selected chips
        m('div.platform-chips', [
          value.length === 0 && m('span.platform-placeholder', 'Click to select platforms...'),
          
          value.map(platform => 
            m('span.platform-chip', {
              key: platform
            }, [
              platform,
              !disabled && m('button.chip-remove', {
                type: 'button',
                onclick: (event) => this.removePlatform(vnode, platform, event),
                'aria-label': 'Remove'
              }, '×')
            ])
          ),
          
          // Dropdown toggle
          m('span.platform-toggle', {
            class: this.isOpen ? 'open' : ''
          }, '▼')
        ])
      ]),
      
      // Dropdown
      this.isOpen && m('div.platform-dropdown', [
        // Custom platform input
        m('div.custom-platform-input', [
          m('input[type=text]', {
            placeholder: 'Type custom platform...',
            value: this.customInput,
            onclick: (event) => event.stopPropagation(),
            oninput: (event) => {
              this.customInput = event.target.value;
            },
            onkeydown: (event) => {
              if (event.key === 'Enter') {
                event.preventDefault();
                this.addCustomPlatform(vnode);
              }
            }
          }),
          m('button.add-custom-btn', {
            type: 'button',
            onclick: (event) => {
              event.stopPropagation();
              this.addCustomPlatform(vnode);
            },
            disabled: !this.customInput.trim()
          }, '+')
        ]),
        
        // Game-specific platforms (if available)
        hasGamePlatforms && m('div.platform-category', [
          m('div.category-header', 'From This Game'),
          gamePlatforms.map(platform =>
            m('label.platform-option', {
              key: `game-${platform}`,
              class: this.isPlatformSelected(vnode, platform) ? 'selected' : ''
            }, [
              m('input[type=checkbox]', {
                checked: this.isPlatformSelected(vnode, platform),
                disabled: disabled,
                onchange: () => this.togglePlatform(vnode, platform)
              }),
              m('span.option-name', platform)
            ])
          )
        ]),
        
        // Common platforms by category
        Object.entries(groupedPlatforms).map(([categoryId, category]) =>
          m('div.platform-category', { key: categoryId }, [
            m('div.category-header', category.name),
            category.platforms.map(platform =>
              m('label.platform-option', {
                key: platform.id,
                class: this.isPlatformSelected(vnode, platform.id) ? 'selected' : ''
              }, [
                m('input[type=checkbox]', {
                  checked: this.isPlatformSelected(vnode, platform.id),
                  disabled: disabled,
                  onchange: () => this.togglePlatform(vnode, platform.id)
                }),
                m('span.option-name', platform.name)
              ])
            )
          ])
        )
      ])
    ]);
  }
};
