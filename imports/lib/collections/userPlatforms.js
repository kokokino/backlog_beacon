import { Mongo } from 'meteor/mongo';

// Client-only collection for receiving aggregated platform data from publication
export const UserPlatforms = new Mongo.Collection('userPlatforms');
