export default function Page({ params }: { params: Record<string, string | undefined> }) {
  return (
    <div style={{ padding: 24, color: 'white' }}>
      <h1>✅ ROUTE REAL meta/[integrationId]</h1>
      <pre>{JSON.stringify(params, null, 2)}</pre>
    </div>
  );
}
