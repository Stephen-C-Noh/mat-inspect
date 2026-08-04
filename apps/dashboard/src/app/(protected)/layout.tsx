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
        {/* Lets keyboard users jump past the header nav, which repeats on every page, straight
            to the page content. Each page's <main id="main-content" tabIndex={-1}> is the
            landing target so focus actually moves there, not just the scroll position. */}
        <a
          href="#main-content"
          className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-50 focus:rounded-md focus:bg-background focus:px-4 focus:py-2 focus:text-sm focus:font-semibold focus:text-foreground focus:shadow-card focus:outline-none focus:ring-2 focus:ring-ring"
        >
          Skip to main content
        </a>
        <TopBar />
        {children}
      </ActivityProvider>
    </AuthGuard>
  );
}
