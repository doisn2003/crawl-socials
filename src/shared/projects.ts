export interface CsdProject {
  id: string;
  name: string;
  avatar: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface ProjectWorkspaceState {
  projects: CsdProject[];
  activeProjectId: string;
  user: { id: string; username: string } | null;
  backup: {
    configured: boolean;
    status: 'LOCAL' | 'PENDING' | 'SYNCING' | 'SYNCED' | 'ERROR';
    lastSyncAt: string | null;
    error: string | null;
  };
}

export interface ProjectsApi {
  state(): Promise<ProjectWorkspaceState>;
  create(input: { name: string; avatar?: string | null }): Promise<ProjectWorkspaceState>;
  update(input: { id: string; name: string; avatar?: string | null }): Promise<ProjectWorkspaceState>;
  remove(input: { id: string }): Promise<ProjectWorkspaceState>;
  select(input: { id: string }): Promise<ProjectWorkspaceState>;
  register(input: { username: string; password: string; invite?: string }): Promise<ProjectWorkspaceState>;
  login(input: { username: string; password: string; invite?: string }): Promise<ProjectWorkspaceState>;
  logout(): Promise<ProjectWorkspaceState>;
  sync(): Promise<ProjectWorkspaceState>;
}
