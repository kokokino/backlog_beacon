import { Meteor } from 'meteor/meteor';
import { S3Client } from '@aws-sdk/client-s3';

let s3Client = null;
let storageConfig = null;

export function initStorageClient() {
  const settings = Meteor.settings.private?.storage;
  storageConfig = settings || { type: 'local' };

  if (storageConfig.type === 'b2' && storageConfig.b2) {
    const { applicationKeyId, applicationKey, region } = storageConfig.b2;

    if (!applicationKeyId || !applicationKey || !region) {
      console.error('Storage: B2 configuration incomplete - missing required fields');
      console.log('Storage: Falling back to local filesystem');
      storageConfig = { type: 'local' };
      return;
    }

    s3Client = new S3Client({
      endpoint: `https://s3.${region}.backblazeb2.com`,
      region: region,
      credentials: {
        accessKeyId: applicationKeyId,
        secretAccessKey: applicationKey
      },
      forcePathStyle: false
    });
    console.log('Storage: Initialized B2 client');
  } else {
    console.log('Storage: Using local filesystem');
  }
}

export function isUsingB2() {
  return storageConfig?.type === 'b2';
}

export function getS3Client() {
  return s3Client;
}

export function getStorageConfig() {
  return storageConfig;
}

// Check if a URL belongs to B2 storage
export function isB2Url(url) {
  return url && url.includes('.backblazeb2.com/');
}

// Check if a URL is a local cover URL
export function isLocalUrl(url) {
  return url && (url.startsWith('/cdn/') || url.startsWith('/cfs/'));
}
