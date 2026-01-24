// src/app/page.tsx
export default function HomePage() {
  return (
    <main style={{ minHeight: '100vh', display: 'grid', placeItems: 'center' }}>
      <div
        style={{
          padding: 24,
          borderRadius: 16,
          border: '1px solid rgba(255,255,255,0.15)',
          background: 'rgba(255,255,255,0.06)',
          color: 'white',
          fontFamily: 'system-ui, -apple-system, Segoe UI, Roboto, sans-serif',
          maxWidth: 720,
          width: '92%',
        }}
      >
        <h1 style={{ margin: 0, fontSize: 28 }}>HOME OK</h1>
        <p style={{ marginTop: 8, opacity: 0.75 }}>
          Si ves esto en producción, el enrutado funciona. Si sigue 404, el problema es de
          despliegue/config, no de LoginClient.
        </p>
      </div>
    </main>
  );
}
