import m from 'mithril';
import { STATUS_LABELS } from '../../lib/collections/collectionItems.js';

// SVG placeholder for games without covers
const noCoverSvg = 'data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSIzMDAiIGhlaWdodD0iNDAwIiB2aWV3Qm94PSIwIDAgMzAwIDQwMCI+CiAgPHJlY3Qgd2lkdGg9IjMwMCIgaGVpZ2h0PSI0MDAiIGZpbGw9IiNmMGYwZjAiLz4KICA8dGV4dCB4PSIxNTAiIHk9IjIwMCIgdGV4dC1hbmNob3I9Im1pZGRsZSIgZmlsbD0iI2FhYSIgZm9udC1mYW1pbHk9IkFyaWFsLCBzYW5zLXNlcmlmIiBmb250LXNpemU9IjE2Ij5ObyBDb3ZlcjwvdGV4dD4KPC9zdmc+';

// Helper to get all available cover sources for a game
function getGameCoverSources(game) {
  if (!game) {
    return { localCoverUrl: null, igdbCoverUrl: null, noCoverSvg };
  }

  // Build local cover URL if available
  const localCoverUrl = game.localCoverUrl || null;

  // Build IGDB cover URL from available fields
  let igdbCoverUrl = null;
  if (game.coverImageId) {
    igdbCoverUrl = `https://images.igdb.com/igdb/image/upload/t_cover_big/${game.coverImageId}.jpg`;
  } else if (game.igdbCoverUrl) {
    igdbCoverUrl = game.igdbCoverUrl;
  } else if (game.coverUrl) {
    igdbCoverUrl = game.coverUrl;
  }

  return { localCoverUrl, igdbCoverUrl, noCoverSvg };
}

export const GameCard = {
  view(vnode) {
    const { game, collectionItem, onAddToCollection, onUpdateItem, onRemoveItem, showActions = true } = vnode.attrs;
    
    if (!game) {
      return m('article.game-card', m('p', 'Game not found'));
    }

    // Get all cover sources for cascading fallback
    const coverSources = getGameCoverSources(game);
    const { localCoverUrl, igdbCoverUrl } = coverSources;

    // Determine initial cover URL and source
    let initialCoverUrl;
    let initialSource;
    if (localCoverUrl) {
      initialCoverUrl = localCoverUrl;
      initialSource = 'local';
    } else if (igdbCoverUrl) {
      initialCoverUrl = igdbCoverUrl;
      initialSource = 'igdb';
    } else {
      initialCoverUrl = noCoverSvg;
      initialSource = 'placeholder';
    }
    
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
    
    // Get platforms from collection item (support both old and new format)
    const getItemPlatforms = (item) => {
      if (item.platforms && item.platforms.length > 0) {
        return item.platforms;
      }
      if (item.platform) {
        return [item.platform];
      }
      return [];
    };
    
    return m('article.game-card', [
      m('div.game-cover', {
        class: collectionItem && onUpdateItem ? 'clickable' : '',
        onclick: collectionItem && onUpdateItem ? () => onUpdateItem(collectionItem) : null
      }, [
        m('img', {
          src: initialCoverUrl,
          alt: game.title || game.name,
          loading: 'lazy',
          'data-cover-source': initialSource,
          onerror(event) {
            const img = event.target;
            const currentSource = img.dataset.coverSource;

            if (currentSource === 'local' && igdbCoverUrl) {
              // Local failed, try IGDB
              img.dataset.coverSource = 'igdb';
              img.src = igdbCoverUrl;
            } else {
              // IGDB failed or no IGDB available, use placeholder
              img.dataset.coverSource = 'placeholder';
              img.src = noCoverSvg;
            }
          },
          onload(event) {
            const img = event.target;
            if (img.dataset.coverSource === 'local') {
              // Local cover loaded successfully, show the badge
              const badge = img.parentElement.querySelector('.local-cover-badge');
              if (badge) {
                badge.classList.remove('hidden');
              }
            }
          }
        }),
        // Badge is hidden initially; shown by onload if local cover loads successfully
        localCoverUrl && m('span.local-cover-badge.hidden', { title: 'Cached locally' }, '💾')
      ]),
      
      m('div.game-info', [
        m('h4.game-title', game.title || game.name),
        
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
          
          (() => {
            const platforms = getItemPlatforms(collectionItem);
            if (platforms.length > 0) {
              return m('p.item-platform', [
                m('small', `Platform${platforms.length > 1 ? 's' : ''}: ${platforms.join(', ')}`)
              ]);
            }
            return null;
          })()
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
