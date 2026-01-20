import { Meteor } from 'meteor/meteor';
import { ImportProgress } from '../../imports/lib/collections/importProgress.js';

Meteor.publish('importProgress', function() {
  if (!this.userId) {
    return this.ready();
  }
  
  return ImportProgress.find({ userId: this.userId });
});
