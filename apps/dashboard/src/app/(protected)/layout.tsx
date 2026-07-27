import { AuthGuard } from '@/components/auth-guard';
import { ActivityProvider } from '@/components/activity-provider';
import { TopBar } from '@/components/ui/top-bar';

// ActivityProvider sits inside AuthGuard so the poll only starts once a signed-in manager is
// looking at a real page, and wraps the whole protected area so the feed keeps running while they
// move between Dashboard, Fleet and Defects (ADR 0026).
export default function ProtectedLayout({ children }: { children: React.ReactNode }) {
  return (
    <AuthGuard>
      <ActivityProvider>
        <TopBar />
        {children}
      </ActivityProvider>
    </AuthGuard>
  );
}
