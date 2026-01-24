// src/app/not-found.tsx
export default function NotFound() {
  return (
    <main style={{ minHeight: '100vh', display: 'grid', placeItems: 'center', color: 'white' }}>
      <div style={{ padding: 24, borderRadius: 16, border: '1px solid rgba(255,255,255,0.15)' }}>
        <h1 style={{ margin: 0 }}>NOT FOUND (Next)</h1>
        <p style={{ marginTop: 8, opacity: 0.75 }}>
          Si ves esta pantalla, significa que Next sí está sirviendo rutas.
        </p>
      </div>
    </main>
  );
}
