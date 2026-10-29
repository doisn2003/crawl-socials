import type { BrowserProfile } from '../../domain/browser-profile.js';
export interface BrowserProfiles {
  list(): Promise<BrowserProfile[]>;
  get(id: string): Promise<BrowserProfile>;
  create(label: string, platform?: 'facebook' | 'threads'): Promise<BrowserProfile>;
}
