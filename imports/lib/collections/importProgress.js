import { Mongo } from 'meteor/mongo';

export const ImportProgress = new Mongo.Collection('importProgress');

export async function clearProgress(userId, type) {
  if (!type) {
    throw new Error('clearProgress requires a type');
  }
  await ImportProgress.removeAsync({ userId, type });
}
