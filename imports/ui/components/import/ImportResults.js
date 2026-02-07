import m from 'mithril';

export const ImportResults = {
  view(vnode) {
    const { result } = vnode.attrs;

    if (!result) {
      return null;
    }

    const importedGames = result.games
      ? result.games.filter(g => g.action === 'imported' || g.action === 'inserted')
      : [];
    const updatedGames = result.games
      ? result.games.filter(g => g.action === 'updated')
      : [];
    const skippedGames = result.games
      ? result.games.filter(g => g.action === 'skipped')
      : [];

    return m('div.import-results', [
      m('div.import-results-summary', {
        class: result.errors.length > 0 ? 'has-errors' : ''
      }, [
        m('strong', 'Import Complete!'),
        m('p', [
          `Imported: ${result.imported} games`,
          result.updated > 0 ? `, Updated: ${result.updated}` : '',
          `, Skipped: ${result.skipped}`
        ])
      ]),
      importedGames.length > 0 &&
        m('div.import-imported', [
          m('details', [
            m('summary', `${importedGames.length} games imported`),
            m('ul', [
              importedGames.map((game, index) => m('li', { key: index },
                game.matchedName && game.matchedName !== game.name
                  ? `${game.name} → ${game.matchedName}`
                  : game.name
              ))
            ])
          ])
        ]),
      updatedGames.length > 0 &&
        m('div.import-updated', [
          m('details', { open: true }, [
            m('summary', `${result.updated} games updated`),
            m('ul', [
              updatedGames.map((game, index) => m('li', { key: index },
                game.matchedName && game.matchedName !== game.name
                  ? `${game.name} → ${game.matchedName}`
                  : game.name
              ))
            ])
          ])
        ]),
      skippedGames.length > 0 &&
        m('div.import-skipped', [
          m('details', [
            m('summary', `${result.skipped} games skipped`),
            m('ul', [
              skippedGames.map((game, index) => m('li', { key: index },
                `${game.name}${game.reason ? ` - ${game.reason}` : ''}`
              ))
            ])
          ])
        ]),
      result.errors.length > 0 && m('div.import-errors', [
        m('details', { open: true }, [
          m('summary', `${result.errors.length} errors`),
          m('ul', [
            result.errors.map((error, index) =>
              m('li', { key: index },
                error.row
                  ? `Row ${error.row}: ${error.name} - ${error.error}`
                  : `${error.name}: ${error.error}`
              )
            )
          ])
        ])
      ])
    ]);
  }
};
