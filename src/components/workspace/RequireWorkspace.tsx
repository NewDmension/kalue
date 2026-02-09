'use client';

import React, { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { supabase } from '@/lib/supabaseClient';
import { getActiveWorkspaceId, setActiveWorkspaceId } from '@/lib/activeWorkspace';

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null;
}

type Props = { children: React.ReactNode };

export default function RequireWorkspace({ children }: Props) {
  const router = useRouter();
  const [ready, setReady] = useState<boolean>(false);

  useEffect(() => {
    void (async () => {
      const { data } = await supabase.auth.getSession();
      const token = data.session?.access_token ?? null;
      if (!token) {
        setReady(true);
        return;
      }

      const res = await fetch('/api/workspaces/list', {
        method: 'GET',
        headers: { Authorization: `Bearer ${token}` },
      });

      const json: unknown = await res.json().catch(() => null);
      const workspaces = isRecord(json) && Array.isArray(json.workspaces) ? json.workspaces : [];

      if (workspaces.length === 0) {
        router.replace('/onboarding/workspace');
        return;
      }

      const current = getActiveWorkspaceId();
      if (!current) {
        const first = workspaces[0];
        if (typeof first === 'object' && first !== null && 'id' in first && typeof (first as { id: unknown }).id === 'string') {
          setActiveWorkspaceId((first as { id: string }).id);
        }
      }

      setReady(true);
    })();
  }, [router]);

  if (!ready) return null;
  return <>{children}</>;
}
