import { createHash, randomUUID } from 'node:crypto';
import { BlobServiceClient, type ContainerClient } from '@azure/storage-blob';
import type { PhotoContentType } from '@mat-inspect/shared-schemas';
import { config } from './config.js';

// Azure Blob Storage access for photo evidence (ADR 0004). @azure/storage-blob talks to Azurite
// in dev and dev-staging and to a real Azure Blob account in production with no code change; only
// AZURE_STORAGE_CONNECTION_STRING differs. The AWS S3 client is never used here (ADR 0004).

// The container client is created once and reused. The wrapping promise is cached so
// createIfNotExists runs a single time per process even under concurrent first uploads.
let containerClientPromise: Promise<ContainerClient> | undefined;

const initContainerClient = async (): Promise<ContainerClient> => {
  const cfg = config();
  const service = BlobServiceClient.fromConnectionString(cfg.azureStorageConnectionString);
  const container = service.getContainerClient(cfg.blobContainer);
  // Idempotent. Dev (Azurite) starts with no containers; production containers are
  // pre-provisioned (ADR 0004), where this is a no-op. Doing it here keeps dev self-contained
  // without a separate provisioning step.
  await container.createIfNotExists();
  return container;
};

// Ensures the container exists and the storage backend is reachable. Called at boot so a
// misconfigured or unreachable storage account fails the container startup rather than the first
// operator upload (mirrors audit's startup chain check).
export const ensureContainer = async (): Promise<void> => {
  await getContainerClient();
};

const getContainerClient = (): Promise<ContainerClient> => {
  containerClientPromise ??= initContainerClient();
  return containerClientPromise;
};

// The stored-photo reference returned to the caller. photoId is the value the PWA later puts in
// InspectionResponse.photo_ids (ADR 0023, DEV-104); blobName equals photoId, so the id alone
// locates the object inside the container.
export type StoredPhoto = {
  photoId: string;
  container: string;
  blobName: string;
  contentType: PhotoContentType;
  size: number;
  sha256: string;
};

// Uploads an already-validated image buffer and returns its reference. The caller is responsible
// for size and content-type validation before this point; storePhoto trusts contentType because
// the route derives it from byte sniffing, not the client header.
export const storePhoto = async (
  data: Buffer,
  contentType: PhotoContentType,
): Promise<StoredPhoto> => {
  const photoId = randomUUID();
  // blobName == photoId gives a 1:1 mapping so the returned id fully resolves the blob. The
  // content type lives in the blob's HTTP headers, so the name needs no file extension.
  const blobName = photoId;
  const sha256 = createHash('sha256').update(data).digest('hex');

  const container = await getContainerClient();
  const blockBlob = container.getBlockBlobClient(blobName);
  await blockBlob.uploadData(data, {
    blobHTTPHeaders: { blobContentType: contentType },
    // Integrity and retention metadata. Server-side encryption is on by default (ADR 0004), and
    // the 7-year retention (ARCHITECTURE.md 4) is enforced by a container lifecycle policy, not
    // per-blob. Recording the content hash and ingest time gives the report/audit export path a
    // value to verify the blob against later. Metadata keys must be lowercase and hyphen-free.
    metadata: { contenthash: sha256, uploadedat: new Date().toISOString() },
  });

  return {
    photoId,
    container: container.containerName,
    blobName,
    contentType,
    size: data.length,
    sha256,
  };
};

// Test-only: drops the cached container client so a test can point at a fresh Azurite container.
export const resetBlobClientForTest = (): void => {
  containerClientPromise = undefined;
};
