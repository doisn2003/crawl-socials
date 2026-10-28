// Narrow driver interface allows deterministic injection without pretending mocks prove CDP behavior.
export interface ObserverTarget {
  readonly id: number;
  isDestroyed(): boolean;
  debuggerAttached(): boolean;
  devToolsOpened(): boolean;
  attachDebugger(): void;
  detachDebugger(): void;
  command(method: string, params: Record<string, unknown>): Promise<unknown>;
  onMessage(callback: (method: string, params: unknown, childSession: boolean) => void): () => void;
  onDetach(callback: () => void): () => void;
  onDestroyed(callback: () => void): () => void;
  onNavigation(callback: () => void): () => void;
  onDevTools(callback: () => void): () => void;
}
