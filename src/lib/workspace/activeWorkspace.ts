// src/lib/workspace/activeWorkspace.ts
export const ACTIVE_WORKSPACE_KEY = 'kalue.activeWorkspaceId';

export function getActiveWorkspaceIdClient(): string | null {
  if (typeof window === 'undefined') return null;
  try {
    return window.localStorage.getItem(ACTIVE_WORKSPACE_KEY);
  } catch {
    return null;
  }
}

export function setActiveWorkspaceIdClient(id: string): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(ACTIVE_WORKSPACE_KEY, id);
  } catch {
    // ignore
  }
}
