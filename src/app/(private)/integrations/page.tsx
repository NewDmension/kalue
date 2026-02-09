import MetaIntegrationCard from '@/components/integrations/MetaIntegrationCard';

export default function IntegrationsPage() {
  const workspaceId = 'PON_AQUI_EL_WORKSPACE_ID_DEL_CONTEXT'; // lo coges de tu context real

  return (
    <div className="p-6">
      <MetaIntegrationCard workspaceId={workspaceId} />
    </div>
  );
}
