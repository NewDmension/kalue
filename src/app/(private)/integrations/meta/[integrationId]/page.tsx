import MetaIntegrationConfigClient from './MetaIntegrationConfigClient';

export default function Page({ params }: { params: { integrationId: string } }) {
  return <MetaIntegrationConfigClient integrationId={params.integrationId} />;
}
