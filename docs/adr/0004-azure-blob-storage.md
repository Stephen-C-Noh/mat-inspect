# ADR 0004: Azure Blob Storage for Object Storage

Date: 2026-06-01
Status: Accepted

## Context

The original architecture specified MinIO as the object storage layer for photos, voice
clips, and generated PDF exports. MinIO is S3-compatible and self-hosted.

The project is moving all production infrastructure to Azure. Running a MinIO container
in production alongside Azure-managed services adds operational surface that SAIT IT
would need to maintain. Azure Blob Storage is an Azure-native managed service that SAIT
IT already operates as part of their tenant; no additional containers are required.

Nothing in the Media Service has been built yet, so there is no migration burden. The
decision is a starting-point choice, not a swap.

## Decision

Use Azure Blob Storage for all object storage: photos, voice clips, and PDF exports.

- **Dev and dev-staging (mini-PC):** Azurite (`mcr.microsoft.com/azure-storage/azurite`),
  Microsoft's official Azure Storage emulator, runs as a Docker Compose service. The same
  `@azure/storage-blob` SDK connects to Azurite with the well-known development
  connection string. No Azure account is required for local development.
- **Production (Azure VM):** Real Azure Blob Storage. One storage account with three
  containers: `mat-inspect-media`, `mat-inspect-voice`, `mat-inspect-reports`. Connection
  string sourced from the Azure portal and stored as a Docker secret or environment
  variable.

The Media Service uses `@azure/storage-blob` and `@azure/identity`. The AWS SDK is never
installed. SAS tokens (Shared Access Signatures) replace S3 presigned URLs; the concept
is identical, the API differs.

In production, the Azure VM is assigned a managed identity with Storage Blob Data
Contributor on the storage account. `DefaultAzureCredential` picks this up automatically;
no credentials in environment variables are needed for the VM-to-Blob path.

Server-side encryption (SSE) is enabled by default on all Azure Blob Storage accounts.
No explicit SSE configuration is required.

## Consequences

Positive: SAIT IT inherits a system using a managed Azure service they already operate;
no MinIO container to run or upgrade in production; SSE on by default; managed identity
eliminates storage credentials on the VM; Azurite in Docker Compose keeps dev
self-contained and free.

Negative: Azure Blob Storage is not S3-compatible, so the Media Service must use
`@azure/storage-blob` rather than the AWS S3 client; SAS token generation differs from
presigned URL generation (same concept, different SDK calls); Azurite must be in the
Docker Compose file for dev, adding one more container.

## Alternatives Considered

MinIO (original architecture): self-hosted, S3-compatible. Rejected because it adds a
container SAIT IT must operate; inconsistent with the move to Azure-managed services.

Azure Data Lake Storage Gen2: adds hierarchical namespace for analytics workloads. Not
needed at this scale; standard Blob Storage is sufficient.
