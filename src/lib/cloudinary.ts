import { v2 as cloudinary } from 'cloudinary';
import { Readable } from 'stream';
import logger from './logger';

if (!process.env.CLOUDINARY_CLOUD_NAME || !process.env.CLOUDINARY_API_KEY || !process.env.CLOUDINARY_API_SECRET) {
  logger.warn('[cloudinary] WARNING: CLOUDINARY_CLOUD_NAME / CLOUDINARY_API_KEY / CLOUDINARY_API_SECRET env vars are not set. Image uploads will fail.');
}

cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
});

export async function uploadImageBuffer(
  buffer: Buffer,
  folder: string
): Promise<{ url: string; publicId: string }> {
  return new Promise((resolve, reject) => {
    const stream = cloudinary.uploader.upload_stream(
      { folder, resource_type: 'image' },
      (error, result) => {
        if (error || !result) return reject(error ?? new Error('Cloudinary upload failed'));
        resolve({ url: result.secure_url, publicId: result.public_id });
      }
    );
    Readable.from(buffer).pipe(stream);
  });
}

export interface BulletinImageUpload {
  publicId: string;
  url: string;
  thumbnailUrl: string;
  width: number;
  height: number;
  bytes: number;
  format: string;
}

export async function uploadBulletinImage(buffer: Buffer): Promise<BulletinImageUpload> {
  const uploaded = await new Promise<{
    publicId: string;
    width: number;
    height: number;
    bytes: number;
    format: string;
  }>((resolve, reject) => {
    const stream = cloudinary.uploader.upload_stream(
      {
        folder: 'nexium-bulletin',
        resource_type: 'image',
        unique_filename: true,
        overwrite: false,
      },
      (error, result) => {
        if (error || !result) return reject(error ?? new Error('Cloudinary upload failed'));
        resolve({
          publicId: result.public_id,
          width: result.width,
          height: result.height,
          bytes: result.bytes,
          format: result.format,
        });
      },
    );
    Readable.from(buffer).pipe(stream);
  });

  return {
    ...uploaded,
    url: cloudinary.url(uploaded.publicId, {
      secure: true,
      transformation: [
        { width: 1600, crop: 'limit' },
        { quality: 'auto:good', fetch_format: 'auto' },
      ],
    }),
    thumbnailUrl: cloudinary.url(uploaded.publicId, {
      secure: true,
      transformation: [
        { width: 480, height: 320, crop: 'fill', gravity: 'auto' },
        { quality: 'auto:eco', fetch_format: 'auto' },
      ],
    }),
  };
}

export async function destroyImage(publicId: string): Promise<void> {
  try {
    await cloudinary.uploader.destroy(publicId, { resource_type: 'image' });
  } catch (err) {
    logger.warn(`[cloudinary] failed to destroy ${publicId}:`, { error: err });
  }
}

export default cloudinary;
