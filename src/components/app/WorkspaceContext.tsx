// src/components/app/WorkspaceContext.tsx
'use client';

import React, { createContext, useContext, useMemo } from 'react';

export type Workspace = { id: string; name: string; slug: string };

type WorkspaceContextValue = {
  activeWorkspaceId: string | null;
  activeWorkspace: Workspace | null;
  workspaces: Workspace[];
};

const WorkspaceContext = createContext<WorkspaceContextValue | null>(null);

export function WorkspaceProvider(props: {
  activeWorkspaceId: string | null;
  activeWorkspace: Workspace | null;
  workspaces: Workspace[];
  children: React.ReactNode;
}) {
  const value = useMemo<WorkspaceContextValue>(
    () => ({
      activeWorkspaceId: props.activeWorkspaceId,
      activeWorkspace: props.activeWorkspace,
      workspaces: props.workspaces,
    }),
    [props.activeWorkspaceId, props.activeWorkspace, props.workspaces],
  );

  return <WorkspaceContext.Provider value={value}>{props.children}</WorkspaceContext.Provider>;
}

export function useWorkspace(): WorkspaceContextValue {
  const ctx = useContext(WorkspaceContext);
  if (!ctx) {
    // Mejor fallar explícito para detectar usos fuera del provider
    throw new Error('useWorkspace must be used within WorkspaceProvider');
  }
  return ctx;
}
