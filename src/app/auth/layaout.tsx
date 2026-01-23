export default function AuthLayout(props: { children: React.ReactNode }) {
  return (
    <div className="min-h-[calc(100vh-0px)] flex items-center justify-center px-4 py-10">
      {/* Fondo suave tipo tu admin */}
      <div className="pointer-events-none fixed inset-0 -z-10">
        <div className="absolute inset-0 bg-[radial-gradient(900px_500px_at_30%_20%,rgba(99,102,241,0.14),transparent_60%)]" />
        <div className="absolute inset-0 bg-[radial-gradient(900px_500px_at_80%_70%,rgba(16,185,129,0.12),transparent_60%)]" />
      </div>

      {props.children}
    </div>
  );
}
