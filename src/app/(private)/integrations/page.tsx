'use client';

import React, { useMemo } from 'react';
import { useSearchParams } from 'next/navigation';

import MetaIntegrationCard from '@/components/integrations/MetaIntegrationCard';

export default function IntegrationsPage() {
  const searchParams = useSearchParams();

  // MVP: permite probar pasando ?workspaceId=UUID
  const workspaceId = useMemo(() => {
    const v = searchParams.get('workspaceId');
    return typeof v === 'string' ? v : '';
  }, [searchParams]);

  return (
    <div className="p-6">
      {!workspaceId ? (
        <div className="card-glass rounded-2xl p-5 border border-white/10 bg-white/5 text-white/80">
          <div className="text-lg font-semibold text-white">Integraciones</div>
          <div className="mt-2 text-sm text-white/70">
            Falta <span className="text-white">workspaceId</span>.
            <br />
            Para probar el MVP, abre esta página con:
            <br />
            <span className="font-mono text-white/90">/integrations?workspaceId=TU_UUID</span>
          </div>
        </div>
      ) : (
        <MetaIntegrationCard workspaceId={workspaceId} />
      )}
    </div>
  );
}
