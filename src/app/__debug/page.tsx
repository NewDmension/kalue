export default function DebugPage() {
  const now = new Date().toISOString();
  return (
    <div style={{ padding: 24, fontFamily: 'ui-sans-serif, system-ui' }}>
      <h1 style={{ fontSize: 24, fontWeight: 800 }}>DEBUG ROUTE OK</h1>
      <p>Timestamp: {now}</p>
      <p>Path: /__debug</p>
    </div>
  );
}
