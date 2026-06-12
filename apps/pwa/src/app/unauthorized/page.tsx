export default function UnauthorizedPage() {
  return (
    <main
      style={{
        display: 'flex',
        minHeight: '100vh',
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      <div style={{ textAlign: 'center' }}>
        <h1 style={{ fontSize: '1.5rem', fontWeight: 600, color: '#111827' }}>Access Denied</h1>
        <p style={{ color: '#6b7280', marginTop: '0.5rem' }}>
          You do not have the Operator role required to use this app.
        </p>
      </div>
    </main>
  );
}
