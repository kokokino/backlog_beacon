import { PutObjectCommand, DeleteObjectCommand, HeadObjectCommand } from '@aws-sdk/client-s3';
import { Upload } from '@aws-sdk/lib-storage';
import { getS3Client, getStorageConfig } from './storageClient.js';

// Upload buffer to B2, returns public URL
export async function uploadToB2(buffer, key, contentType) {
  const s3 = getS3Client();
  const config = getStorageConfig();

  if (!s3 || !config.b2) {
    throw new Error('B2 storage not configured');
  }

  await s3.send(new PutObjectCommand({
    Bucket: config.b2.bucketName,
    Key: key,
    Body: buffer,
    ContentType: contentType
  }));

  // Return public URL
  return `https://${config.b2.bucketName}.s3.${config.b2.region}.backblazeb2.com/${key}`;
}

// Upload stream to B2 using multipart upload, returns public URL
export async function uploadStreamToB2(stream, key, contentType) {
  const s3 = getS3Client();
  const config = getStorageConfig();

  if (!s3 || !config.b2) {
    throw new Error('B2 storage not configured');
  }

  const upload = new Upload({
    client: s3,
    params: {
      Bucket: config.b2.bucketName,
      Key: key,
      Body: stream,
      ContentType: contentType
    }
  });

  await upload.done();

  // Return public URL
  return `https://${config.b2.bucketName}.s3.${config.b2.region}.backblazeb2.com/${key}`;
}

// Delete file from B2
export async function deleteFromB2(key) {
  const s3 = getS3Client();
  const config = getStorageConfig();

  if (!s3 || !config.b2) {
    throw new Error('B2 storage not configured');
  }

  await s3.send(new DeleteObjectCommand({
    Bucket: config.b2.bucketName,
    Key: key
  }));
}

// Check if file exists in B2
export async function checkB2FileExists(key) {
  const s3 = getS3Client();
  const config = getStorageConfig();

  if (!s3 || !config.b2) {
    return false;
  }

  try {
    await s3.send(new HeadObjectCommand({
      Bucket: config.b2.bucketName,
      Key: key
    }));
    return true;
  } catch (error) {
    if (error.name === 'NotFound' || error.$metadata?.httpStatusCode === 404) {
      return false;
    }
    throw error;
  }
}

// Extract key from B2 URL
export function extractKeyFromB2Url(url) {
  // URL format: https://{bucket}.s3.{region}.backblazeb2.com/{key}
  const match = url.match(/backblazeb2\.com\/(.+)$/);
  return match ? match[1] : null;
}
