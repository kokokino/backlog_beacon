import { Meteor } from 'meteor/meteor';
import { refreshStaleGames } from '../igdb/gameCache.js';
import { isConfigured } from '../igdb/client.js';

// Refresh stale game data periodically
// This runs every 24 hours

let refreshInterval = null;

function startGameRefreshJob() {
  if (!isConfigured()) {
    console.log('IGDB not configured, skipping game refresh job');
    return;
  }
  
  // Run immediately on startup (after a short delay)
  Meteor.setTimeout(async () => {
    console.log('Running initial game data refresh...');
    try {
      const result = await refreshStaleGames();
      console.log(`Game refresh complete: ${result.refreshed}/${result.total} games updated`);
    } catch (error) {
      console.error('Game refresh failed:', error);
    }
  }, 10000); // Wait 10 seconds after startup
  
  // Then run every 24 hours
  const TWENTY_FOUR_HOURS = 24 * 60 * 60 * 1000;
  
  refreshInterval = Meteor.setInterval(async () => {
    console.log('Running scheduled game data refresh...');
    try {
      const result = await refreshStaleGames();
      console.log(`Game refresh complete: ${result.refreshed}/${result.total} games updated`);
    } catch (error) {
      console.error('Game refresh failed:', error);
    }
  }, TWENTY_FOUR_HOURS);
}

function stopGameRefreshJob() {
  if (refreshInterval) {
    Meteor.clearInterval(refreshInterval);
    refreshInterval = null;
  }
}

// Start the job on server startup
Meteor.startup(() => {
  startGameRefreshJob();
});

export { startGameRefreshJob, stopGameRefreshJob };
