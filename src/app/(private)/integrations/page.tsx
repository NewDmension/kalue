'use client';

import React, { useEffect, useState } from 'react';
import MetaIntegrationCard from '@/components/integrations/MetaIntegrationCard';
import { getActiveWorkspaceId } from '@/lib/activeWorkspace';

export default function IntegrationsPage() {
  const [workspaceId, setWorkspaceId] = useState<string>('');

  useEffect(() => {
    const id = getActiveWorkspaceId();
    setWorkspaceId(id ?? '');
  }, []);

  return (
    <div className="p-6">
      {!workspaceId ? (
        <div className="card-glass rounded-2xl p-5 border border-white/10 bg-white/5 text-white/80">
          <div className="text-lg font-semibold text-white">Integraciones</div>
          <div className="mt-2 text-sm text-white/70">
            No hay workspace activo. Ve a <span className="text-white">Settings → Workspaces</span> y selecciona uno.
          </div>
        </div>
      ) : (
        <MetaIntegrationCard workspaceId={workspaceId} />
      )}
    </div>
  );
}
