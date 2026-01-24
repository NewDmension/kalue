import Link from 'next/link';

export default function HomePage() {
  return (
    <div style={{ padding: 24, fontFamily: 'ui-sans-serif, system-ui' }}>
      <h1 style={{ fontSize: 24, fontWeight: 800 }}>HOME / (root) IS RENDERING</h1>
      <p>Si ves esto, estás en src/app/page.tsx</p>
      <ul style={{ marginTop: 12 }}>
        <li>
          <Link href="/auth">Ir a /auth</Link>
        </li>
        <li>
          <Link href="/app">Ir a /app</Link>
        </li>
        <li>
          <Link href="/__debug">Ir a /__debug</Link>
        </li>
      </ul>
    </div>
  );
}
