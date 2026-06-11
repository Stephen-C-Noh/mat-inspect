import { AuthGuard } from '@/components/auth-guard';

export default function Home() {
  return (
    <AuthGuard>
      <main style={{ padding: '2rem' }}>
        <h1>MAT-Inspect Operator App</h1>
      </main>
    </AuthGuard>
  );
}
