import m from 'mithril';
import { STATUS_LABELS } from '../../lib/collections/collectionItems.js';

export const CollectionFilters = {
  view(vnode) {
    const { 
      filters, 
      platforms = [], 
      onFilterChange,
      onClearFilters 
    } = vnode.attrs;
    
    const hasActiveFilters = filters.status || filters.platform || filters.favorite || filters.search;
    
    return m('div.collection-filters', [
      m('div.filter-row', [
        m('input[type=search]', {
          placeholder: 'Search your collection...',
          value: filters.search || '',
          oninput(event) {
            onFilterChange({ ...filters, search: event.target.value });
          }
        }),
        
        m('select', {
          value: filters.status || '',
          onchange(event) {
            onFilterChange({ ...filters, status: event.target.value || null });
          }
        }, [
          m('option', { value: '' }, 'All Statuses'),
          ...Object.entries(STATUS_LABELS).map(([value, label]) =>
            m('option', { value }, label)
          )
        ]),
        
        m('select', {
          value: filters.platform || '',
          onchange(event) {
            onFilterChange({ ...filters, platform: event.target.value || null });
          }
        }, [
          m('option', { value: '' }, 'All Platforms'),
          ...platforms.map(platform =>
            m('option', { value: platform }, platform)
          )
        ]),

        m('select.sort-select', {
          value: filters.sort || 'name-asc',
          onchange(event) {
            onFilterChange({ ...filters, sort: event.target.value });
          }
        }, [
          m('option', { value: 'name-asc' }, 'Name (A-Z)'),
          m('option', { value: 'name-desc' }, 'Name (Z-A)'),
          m('option', { value: 'date-desc' }, 'Recently Added'),
          m('option', { value: 'date-asc' }, 'Oldest Added')
        ]),

        m('label.favorites-toggle', [
          m('input[type=checkbox]', {
            checked: filters.favorite || false,
            onchange(event) {
              onFilterChange({ ...filters, favorite: event.target.checked || null });
            }
          }),
          ' Favorites only'
        ])
      ]),
      
      hasActiveFilters && m('div.filter-actions', [
        m('button.outline.secondary.small', {
          onclick: onClearFilters
        }, 'Clear Filters')
      ])
    ]);
  }
};
