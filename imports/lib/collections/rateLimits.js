import { Mongo } from 'meteor/mongo';

export const RateLimits = new Mongo.Collection('rateLimits');

// Schema documentation:
// {
//   _id: String,        // Rate limit key (e.g., 'igdb', 'userId:methodName')
//   count: Number,      // Number of requests in current window
//   windowStart: Number // Timestamp (ms) when current window started
// }
