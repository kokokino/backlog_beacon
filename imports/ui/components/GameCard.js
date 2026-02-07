import m from 'mithril';
import { STATUS_LABELS } from '../../lib/collections/collectionItems.js';
import { getCoverSources, noCoverSvg } from '../lib/coverUrls.js';

export const GameCard = {
  view(vnode) {
    const { game, collectionItem, onAddToCollection, onUpdateItem, onRemoveItem, showActions = true } = vnode.attrs;
    
    if (!game && !collectionItem) {
      return m('article.game-card', m('p', 'Game not found'));
    }

    // Handle case where game is not in IGDB but collection item exists
    const displayName = game?.title || 'Unknown Game';

    // Check if this is a custom game (has ownerId)
    const isCustomGame = game?.ownerId;

    // Get all cover sources for cascading fallback
    const coverSources = getCoverSources(game);
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
          alt: displayName,
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
        localCoverUrl && m('span.local-cover-badge.hidden', { title: 'Cached locally' }, '\uD83D\uDCBE'),
        // Custom game badge
        isCustomGame && m('span.custom-game-badge', { title: 'Custom game' }, 'Custom')
      ]),
      
      m('div.game-info', [
        m('h4.game-title', displayName),

        game?.releaseYear && m('p.game-year', game.releaseYear),

        game?.platforms && game.platforms.length > 0 && m('p.game-platforms', [
          m('small', game.platforms.slice(0, 3).join(', ')),
          game.platforms.length > 3 && m('small', ` +${game.platforms.length - 3} more`)
        ]),

        game?.genres && game.genres.length > 0 && m('p.game-genres', [
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
            if (confirm(`Remove "${displayName}" from your collection?`)) {
              onRemoveItem(collectionItem._id);
            }
          }
        }, 'Remove')
      ])
    ]);
  }
};
