import { Meteor } from 'meteor/meteor';
import { Random } from 'meteor/random';
import { check, Match } from 'meteor/check';
import sharp from 'sharp';
import { Games } from '../../imports/lib/collections/games.js';
import { CollectionItems } from '../../imports/lib/collections/collectionItems.js';
import { checkDistributedRateLimit } from '../lib/distributedRateLimit.js';
import { isUsingB2 } from '../covers/storageClient.js';
import { uploadToB2, deleteFromB2, extractKeyFromB2Url } from '../covers/b2Storage.js';
import { GameCovers } from '../covers/coversCollection.js';
import fs from 'fs';
import path from 'path';

const RATE_LIMIT_WINDOW = 1000;
const RATE_LIMIT_MAX = 10;
const MAX_TITLE_LENGTH = 512;
const MAX_COVER_SIZE = 2 * 1024 * 1024; // 2MB

async function checkRateLimit(userId, methodName) {
  const key = `method:${userId}:${methodName}`;
  const result = await checkDistributedRateLimit(key, RATE_LIMIT_MAX, RATE_LIMIT_WINDOW);

  if (!result.allowed) {
    throw new Meteor.Error('rate-limited', 'Too many requests. Please slow down.');
  }

  return true;
}

function validateTitle(title) {
  if (!title || typeof title !== 'string') {
    throw new Meteor.Error('invalid-title', 'Title is required');
  }

  const trimmed = title.trim();

  if (trimmed.length === 0) {
    throw new Meteor.Error('invalid-title', 'Title cannot be empty');
  }

  if (trimmed.length > MAX_TITLE_LENGTH) {
    throw new Meteor.Error('invalid-title', `Title cannot exceed ${MAX_TITLE_LENGTH} characters`);
  }

  return trimmed;
}

// Process uploaded cover image: resize to 264x352 and convert to WebP
async function processCustomCover(base64Data, gameId) {
  // Extract actual base64 data if data URL format
  let imageData = base64Data;
  if (base64Data.startsWith('data:')) {
    const matches = base64Data.match(/^data:image\/\w+;base64,(.+)$/);
    if (!matches) {
      throw new Meteor.Error('invalid-image', 'Invalid image data format');
    }
    imageData = matches[1];
  }

  const buffer = Buffer.from(imageData, 'base64');

  if (buffer.length > MAX_COVER_SIZE) {
    throw new Meteor.Error('image-too-large', `Image must be less than ${MAX_COVER_SIZE / 1024 / 1024}MB`);
  }

  // Validate image format and resize using sharp
  const processedBuffer = await sharp(buffer)
    .resize(264, 352, {
      fit: 'cover',
      position: 'center'
    })
    .webp({
      quality: 80,
      effort: 4
    })
    .toBuffer();

  const fileName = `custom_${gameId}.webp`;

  if (isUsingB2()) {
    // Upload to B2
    const key = `covers/custom/${gameId.slice(0, 2)}/${fileName}`;
    const coverUrl = await uploadToB2(processedBuffer, key, 'image/webp');
    return { localCoverUrl: coverUrl, localCoverId: null };
  } else {
    // Store locally
    const fileObj = await GameCovers.writeAsync(processedBuffer, {
      fileName: fileName,
      type: 'image/webp',
      meta: {
        gameId: gameId,
        isCustom: true,
        uploadedAt: new Date()
      }
    });

    return {
      localCoverId: fileObj._id,
      localCoverUrl: GameCovers.link(fileObj)
    };
  }
}

// Delete cover file (B2 or local)
async function deleteCustomCover(game) {
  if (!game.localCoverUrl && !game.localCoverId) {
    return;
  }

  if (isUsingB2() && game.localCoverUrl) {
    const key = extractKeyFromB2Url(game.localCoverUrl);
    if (key) {
      try {
        await deleteFromB2(key);
      } catch (error) {
        console.error('Error deleting cover from B2:', error);
      }
    }
  } else if (game.localCoverId) {
    try {
      const coverDoc = await GameCovers.findOneAsync(game.localCoverId);
      if (coverDoc) {
        await GameCovers.removeAsync(game.localCoverId);
      }
    } catch (error) {
      console.error('Error deleting local cover:', error);
    }
  }
}

Meteor.methods({
  async 'games.createCustom'(gameData) {
    check(gameData, {
      title: String,
      platforms: Match.Maybe([String]),
      releaseYear: Match.Maybe(Match.Integer),
      developer: Match.Maybe(String),
      publisher: Match.Maybe(String),
      genres: Match.Maybe([String]),
      summary: Match.Maybe(String)
    });

    if (!this.userId) {
      throw new Meteor.Error('not-authorized', 'You must be logged in');
    }

    await checkRateLimit(this.userId, 'games.createCustom');

    const title = validateTitle(gameData.title);

    const now = new Date();
    const gameDoc = {
      ownerId: this.userId,
      title: title,
      slug: title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, ''),
      platforms: gameData.platforms || [],
      releaseYear: gameData.releaseYear || null,
      developer: gameData.developer || '',
      publisher: gameData.publisher || '',
      genres: gameData.genres || [],
      summary: gameData.summary || '',
      createdAt: now,
      updatedAt: now
    };

    const gameId = await Games.insertAsync(gameDoc);

    return gameId;
  },

  async 'games.updateCustom'(gameId, updates) {
    check(gameId, String);
    check(updates, {
      title: Match.Maybe(String),
      platforms: Match.Maybe([String]),
      releaseYear: Match.Maybe(Match.OneOf(Match.Integer, null)),
      developer: Match.Maybe(String),
      publisher: Match.Maybe(String),
      genres: Match.Maybe([String]),
      summary: Match.Maybe(String)
    });

    if (!this.userId) {
      throw new Meteor.Error('not-authorized', 'You must be logged in');
    }

    await checkRateLimit(this.userId, 'games.updateCustom');

    const game = await Games.findOneAsync(gameId);

    if (!game) {
      throw new Meteor.Error('game-not-found', 'Game not found');
    }

    if (game.ownerId !== this.userId) {
      throw new Meteor.Error('not-authorized', 'You can only edit your own custom games');
    }

    const updateFields = { updatedAt: new Date() };

    if (updates.title !== undefined) {
      updateFields.title = validateTitle(updates.title);
      updateFields.slug = updateFields.title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
    }

    if (updates.platforms !== undefined) {
      updateFields.platforms = updates.platforms;
    }

    if (updates.releaseYear !== undefined) {
      updateFields.releaseYear = updates.releaseYear;
    }

    if (updates.developer !== undefined) {
      updateFields.developer = updates.developer;
    }

    if (updates.publisher !== undefined) {
      updateFields.publisher = updates.publisher;
    }

    if (updates.genres !== undefined) {
      updateFields.genres = updates.genres;
    }

    if (updates.summary !== undefined) {
      updateFields.summary = updates.summary;
    }

    await Games.updateAsync(gameId, { $set: updateFields });

    // Propagate changes to collectionItems that reference this game
    const gameUpdates = {};
    if (updateFields.title !== undefined) {
      gameUpdates['game.title'] = updateFields.title;
    }
    if (updateFields.releaseYear !== undefined) {
      gameUpdates['game.releaseYear'] = updateFields.releaseYear;
    }
    if (updateFields.genres !== undefined) {
      gameUpdates['game.genres'] = updateFields.genres;
    }

    if (Object.keys(gameUpdates).length > 0) {
      await CollectionItems.updateAsync(
        { gameId },
        { $set: gameUpdates },
        { multi: true }
      );
    }

    return true;
  },

  async 'games.deleteCustom'(gameId) {
    check(gameId, String);

    if (!this.userId) {
      throw new Meteor.Error('not-authorized', 'You must be logged in');
    }

    await checkRateLimit(this.userId, 'games.deleteCustom');

    const game = await Games.findOneAsync(gameId);

    if (!game) {
      throw new Meteor.Error('game-not-found', 'Game not found');
    }

    if (game.ownerId !== this.userId) {
      throw new Meteor.Error('not-authorized', 'You can only delete your own custom games');
    }

    // Remove from all collection items referencing this game
    await CollectionItems.removeAsync({ gameId: gameId, userId: this.userId });

    // Delete cover file if exists
    await deleteCustomCover(game);

    // Delete the game
    await Games.removeAsync(gameId);

    return true;
  },

  async 'games.uploadCustomCover'(gameId, base64Data) {
    check(gameId, String);
    check(base64Data, String);

    if (!this.userId) {
      throw new Meteor.Error('not-authorized', 'You must be logged in');
    }

    await checkRateLimit(this.userId, 'games.uploadCustomCover');

    const game = await Games.findOneAsync(gameId);

    if (!game) {
      throw new Meteor.Error('game-not-found', 'Game not found');
    }

    if (game.ownerId !== this.userId) {
      throw new Meteor.Error('not-authorized', 'You can only upload covers for your own custom games');
    }

    // Delete old cover if exists
    await deleteCustomCover(game);

    // Process and store new cover
    const coverResult = await processCustomCover(base64Data, gameId);

    // Update game with new cover reference
    await Games.updateAsync(gameId, {
      $set: {
        localCoverId: coverResult.localCoverId,
        localCoverUrl: coverResult.localCoverUrl,
        updatedAt: new Date()
      }
    });

    // Propagate localCoverUrl to collectionItems that reference this game
    await CollectionItems.updateAsync(
      { gameId },
      { $set: { 'game.localCoverUrl': coverResult.localCoverUrl } },
      { multi: true }
    );

    return coverResult.localCoverUrl;
  }
});
