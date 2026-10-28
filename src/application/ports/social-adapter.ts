import type {
  AccessCheck, AdapterAccessContext, AdapterCapabilities, AdapterCheckpoint,
  AdapterPage, AdapterRequest, AdapterResult, PermalinkCheck,
} from '../../domain/adapter-contracts.js';

export interface SocialAdapter {
  readonly capabilities: AdapterCapabilities;
  initialize(): Promise<AdapterResult<void>>;
  checkAccess(context: AdapterAccessContext): Promise<AdapterResult<AccessCheck>>;
  discoverSources(request: AdapterRequest): Promise<AdapterResult<AdapterPage>>;
  searchPosts(request: AdapterRequest): Promise<AdapterResult<AdapterPage>>;
  fetchBatch(request: AdapterRequest, checkpoint: AdapterCheckpoint): Promise<AdapterResult<AdapterPage>>;
  verifyPermalink(url: string, context: AdapterAccessContext): Promise<AdapterResult<PermalinkCheck>>;
  stop(): Promise<void>;
}
