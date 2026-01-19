import m from 'mithril';
import { STATUS_LABELS } from '../../lib/collections/collectionItems.js';

export const GameCard = {
  view(vnode) {
    const { game, collectionItem, onAddToCollection, onUpdateItem, onRemoveItem, showActions = true } = vnode.attrs;
    
    if (!game) {
      return m('article.game-card', m('p', 'Game not found'));
    }
    
    // Use an SVG placeholder with a light gray background and "No Cover" text
    const placeholderSvg = 'data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSIzMDAiIGhlaWdodD0iNDAwIiB2aWV3Qm94PSIwIDAgMzAwIDQwMCI+CiAgPHJlY3Qgd2lkdGg9IjMwMCIgaGVpZ2h0PSI0MDAiIGZpbGw9IiNmMGYwZjAiLz4KICA8dGV4dCB4PSIxNTAiIHk9IjIwMCIgdGV4dC1hbmNob3I9Im1pZGRsZSIgZmlsbD0iI2FhYSIgZm9udC1mYW1pbHk9IkFyaWFsLCBzYW5zLXNlcmlmIiBmb250LXNpemU9IjE2Ij5ObyBDb3ZlcjwvdGV4dD4KPC9zdmc+';
    const coverUrl = game.coverImageId 
      ? `/covers/${game.coverImageId}.webp`
      : game.igdbCoverUrl 
        ? game.igdbCoverUrl 
        : placeholderSvg;
    
    const renderStars = (rating) => {
      const stars = [];
      for (let index = 1; index <= 5; index++) {
        stars.push(m('span.star', { class: index <= rating ? 'filled' : '' }, '★'));
      }
      return m('span.rating-stars', stars);
    };
    
    const renderStatusBadge = (status) => {
      const badgeClass = {
        backlog: 'secondary',
        playing: 'primary',
        completed: 'success',
        abandoned: 'warning'
      }[status] || 'secondary';
      
      return m(`span.badge.${badgeClass}`, STATUS_LABELS[status] || status);
    };
    
    return m('article.game-card', [
      m('div.game-cover', [
        m('img', { 
          src: coverUrl, 
          alt: game.title,
          loading: 'lazy',
          onerror(event) {
            // If a real image fails to load, fall back to the SVG placeholder
            event.target.src = placeholderSvg;
          }
        })
      ]),
      
      m('div.game-info', [
        m('h4.game-title', game.title),
        
        game.releaseYear && m('p.game-year', game.releaseYear),
        
        game.platforms && game.platforms.length > 0 && m('p.game-platforms', [
          m('small', game.platforms.slice(0, 3).join(', ')),
          game.platforms.length > 3 && m('small', ` +${game.platforms.length - 3} more`)
        ]),
        
        game.genres && game.genres.length > 0 && m('p.game-genres', [
          m('small', game.genres.slice(0, 2).join(', '))
        ]),
        
        collectionItem && m('div.collection-info', [
          m('div.status-row', [
            renderStatusBadge(collectionItem.status),
            collectionItem.favorite && m('span.favorite-badge', '❤️'),
            collectionItem.physical && m('span.physical-badge', '📀')
          ]),
          
          collectionItem.rating && m('div.rating-row', renderStars(collectionItem.rating)),
          
          collectionItem.hoursPlayed && m('p.hours-played', [
            m('small', `${collectionItem.hoursPlayed} hours played`)
          ]),
          
          collectionItem.platform && m('p.item-platform', [
            m('small', `Platform: ${collectionItem.platform}`)
          ])
        ])
      ]),
      
      showActions && m('div.game-actions', [
        !collectionItem && onAddToCollection && m('button.outline', {
          onclick() {
            onAddToCollection(game);
          }
        }, 'Add to Collection'),
        
        collectionItem && onUpdateItem && m('button.outline.secondary', {
          onclick() {
            onUpdateItem(collectionItem);
          }
        }, 'Edit'),
        
        collectionItem && onRemoveItem && m('button.outline.contrast', {
          onclick() {
            if (confirm('Remove this game from your collection?')) {
              onRemoveItem(collectionItem._id);
            }
          }
        }, 'Remove')
      ])
    ]);
  }
};
