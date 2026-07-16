import { AuthGuard } from '@/components/auth-guard';
import { DashboardNav } from '@/components/dashboard-nav';

export default function ProtectedLayout({ children }: { children: React.ReactNode }) {
  return (
    <AuthGuard>
      <DashboardNav />
      {children}
    </AuthGuard>
  );
}
