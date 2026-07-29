import { randomUUID } from 'node:crypto';
import { BlobServiceClient, type ContainerClient } from '@azure/storage-blob';
import { config } from './config.js';

// Azure Blob Storage access for report exports (ADR 0004, DEV-38). Two containers on the same
// storage account: the Audit Service's own "reports" container (read+write, generated PDFs and
// CSVs) and a read-only handle on Media's "photos" container (defect evidence photos to embed in
// a PDF). Reading a sibling service's blob container is a smaller boundary crossing than a direct
// cross-service SQL query would be (ADR 0001 forbids the latter): object storage is provisioned
// once per environment (ADR 0004), and the Audit Service already needs a client against the same
// storage account for its own container. `blobName === photoId` is Media's own convention
// (services/media/src/lib/blob-storage.ts); this file relies on it to resolve a defect's
// photoIds without a second internal API.

let reportsContainerPromise: Promise<ContainerClient> | undefined;
let photosContainerPromise: Promise<ContainerClient> | undefined;

const initReportsContainer = async (): Promise<ContainerClient> => {
  const cfg = config();
  const service = BlobServiceClient.fromConnectionString(cfg.azureStorageConnectionString);
  const container = service.getContainerClient(cfg.reportsBlobContainer);
  // Idempotent, same as media's storePhoto: dev (Azurite) starts with no containers; production
  // containers are pre-provisioned (ADR 0004), where this is a no-op.
  await container.createIfNotExists();
  return container;
};

const initPhotosContainer = async (): Promise<ContainerClient> => {
  const cfg = config();
  const service = BlobServiceClient.fromConnectionString(cfg.azureStorageConnectionString);
  // No createIfNotExists: this container is Media's to own and provision. If it does not exist
  // yet (a fresh dev environment with no photos uploaded), photo fetches simply 404 per-blob,
  // which the caller already treats as "no photo available" rather than a fatal error.
  return service.getContainerClient(cfg.mediaBlobContainer);
};

const getReportsContainer = (): Promise<ContainerClient> => {
  reportsContainerPromise ??= initReportsContainer();
  return reportsContainerPromise;
};

const getPhotosContainer = (): Promise<ContainerClient> => {
  photosContainerPromise ??= initPhotosContainer();
  return photosContainerPromise;
};

// Ensures the reports container exists and the storage backend is reachable. Called at boot,
// same reasoning as media's ensureContainer: a misconfigured or unreachable storage account
// fails the container startup rather than the first export request.
export const ensureReportsContainer = async (): Promise<void> => {
  await getReportsContainer();
};

export type StoredReportFile = {
  blobName: string;
  container: string;
};

// Uploads a finished report file (PDF or CSV) and returns its blob reference. The caller has
// already computed sha256 and the detached signature (ADR 0022) before calling this; this
// function only moves bytes.
export const storeReportFile = async (
  data: Buffer,
  contentType: 'application/pdf' | 'text/csv',
): Promise<StoredReportFile> => {
  const blobName = randomUUID();
  const container = await getReportsContainer();
  const blockBlob = container.getBlockBlobClient(blobName);
  await blockBlob.uploadData(data, {
    blobHTTPHeaders: { blobContentType: contentType },
  });
  return { blobName, container: container.containerName };
};

// Fetches a finished report's bytes by blob name, for the audit service's own authenticated
// download route (DEV-113 follow-up). Replaces an earlier SAS-URL approach: a SAS pointed the
// browser directly at Azure Blob Storage, which is a real public host in production but Azurite's
// Docker-internal hostname in dev, unreachable from outside the compose network. Serving the
// bytes ourselves (same pattern as media's get-photo.ts, ADR 0020/0023) works identically in
// every environment. Returns undefined only when the blob is unexpectedly missing; the caller
// treats that as a data-consistency bug (a READY job always has a blob), not a normal 404.
export const fetchReportFile = async (blobName: string): Promise<Buffer | undefined> => {
  const container = await getReportsContainer();
  const blockBlob = container.getBlockBlobClient(blobName);
  try {
    return await blockBlob.downloadToBuffer();
  } catch {
    return undefined;
  }
};

// Fetches a defect evidence photo by id for embedding in a PDF. Returns undefined (not a throw)
// when the blob is missing, so one missing photo does not fail the whole export - the PDF shows
// a "photo unavailable" note instead.
export const fetchPhoto = async (photoId: string): Promise<Buffer | undefined> => {
  const container = await getPhotosContainer();
  const blockBlob = container.getBlockBlobClient(photoId);
  try {
    return await blockBlob.downloadToBuffer();
  } catch {
    return undefined;
  }
};

// Test-only: drops the cached container clients so a test can point at a fresh Azurite container.
export const resetBlobClientsForTest = (): void => {
  reportsContainerPromise = undefined;
  photosContainerPromise = undefined;
};
