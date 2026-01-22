import { Mongo } from 'meteor/mongo';

export const UsedNonces = new Mongo.Collection('usedNonces');

// Schema documentation:
// {
//   _id: String,      // The nonce value (used as _id for uniqueness)
//   createdAt: Date   // When the nonce was used (TTL index expires after 10 minutes)
// }
//
// TTL index is created in migration 6_create_used_nonces_ttl_index.js
