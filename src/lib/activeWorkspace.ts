const KEY = 'kalue:workspace:active';

export function getActiveWorkspaceId(): string | null {
  if (typeof window === 'undefined') return null;
  const v = window.localStorage.getItem(KEY);
  return v && v.length > 0 ? v : null;
}

export function setActiveWorkspaceId(workspaceId: string): void {
  if (typeof window === 'undefined') return;
  window.localStorage.setItem(KEY, workspaceId);
}

export function clearActiveWorkspaceId(): void {
  if (typeof window === 'undefined') return;
  window.localStorage.removeItem(KEY);
}
