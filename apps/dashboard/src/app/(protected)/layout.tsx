import { AuthGuard } from '@/components/auth-guard';
import { TopBar } from '@/components/ui/top-bar';

export default function ProtectedLayout({ children }: { children: React.ReactNode }) {
  return (
    <AuthGuard>
      <TopBar />
      {children}
    </AuthGuard>
  );
}
