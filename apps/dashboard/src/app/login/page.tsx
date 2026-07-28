'use client';

import { Suspense, useEffect } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useIsAuthenticated, useMsal } from '@azure/msal-react';
import { InteractionStatus } from '@azure/msal-browser';
import { getRolesFromAccount, hasAllowedRole } from '@mat-inspect/shared-auth';
import { ALLOWED_ROLES, hasOperationalRole, loginRequest, resolveLandingPath } from '@/lib/auth';
import { sanitizeRedirectPath } from '@/lib/safe-redirect';

function LoginContent() {
  const { instance, accounts, inProgress } = useMsal();
  const isAuthenticated = useIsAuthenticated();
  const router = useRouter();
  const searchParams = useSearchParams();
  // Clicking while MSAL is still restoring the cached session (Startup) or processing a
  // just-completed Entra redirect (HandleRedirect) throws BrowserAuthError:
  // interaction_in_progress, which the catch below swallows silently, so the button would look
  // dead (DEV-128). Disable it instead of letting that click happen.
  const msalInitializing =
    inProgress === InteractionStatus.Startup || inProgress === InteractionStatus.HandleRedirect;

  useEffect(() => {
    if (!isAuthenticated) return;
    const activeAccount = accounts[0] ?? null;
    if (hasAllowedRole(activeAccount, ALLOWED_ROLES)) {
      const roles = getRolesFromAccount(activeAccount);
      // AuthGuard sends unauthenticated deep links here as ?redirect=<path> (DEV-128); honor it
      // so a supervisor lands back where they asked to go. Only for an operational role: there
      // is no central permission matrix to check an arbitrary redirect target against (CLAUDE.md
      // section 8), and an auditor's one legitimate destination is already known, so a bookmarked
      // ?redirect=/dashboard must not send an auditor into a page its own AuthGuard will reject
      // (DEV-112 follow-up: that dead-ended at /unauthorized).
      const requestedPath = hasOperationalRole(roles)
        ? sanitizeRedirectPath(searchParams.get('redirect'))
        : null;
      router.replace(requestedPath ?? resolveLandingPath(roles));
    } else {
      router.replace('/unauthorized');
    }
  }, [isAuthenticated, accounts, router, searchParams]);

  const handleSignIn = async () => {
    try {
      // Redirect, not popup: iOS runs every browser on WebKit and blocks or drops the
      // popup-to-opener handshake, so loginPopup silently fails on iPhone. Matches the PWA.
      // MsalProvider processes the redirect response; consumers read accounts[0], so no
      // setActiveAccount is needed here.
      await instance.loginRedirect(loginRequest);
    } catch {
      // Redirect failed to start; stay on login page.
    }
  };

  return (
    <main className="flex min-h-screen items-center justify-center bg-gray-50">
      <div className="w-full max-w-sm rounded-lg bg-white p-8 shadow">
        <h1 className="mb-1 text-2xl font-semibold text-gray-900">MAT-Inspect</h1>
        <p className="mb-6 text-sm text-gray-500">Manager Dashboard</p>
        <button
          onClick={handleSignIn}
          disabled={msalInitializing}
          className="flex w-full items-center justify-center gap-3 rounded-md border border-gray-300 bg-white px-4 py-2.5 text-sm font-medium text-gray-700 shadow-sm hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:cursor-not-allowed disabled:opacity-50"
        >
          <MicrosoftLogo />
          Sign in with Microsoft
        </button>
      </div>
    </main>
  );
}

export default function LoginPage() {
  return (
    <Suspense fallback={null}>
      <LoginContent />
    </Suspense>
  );
}

const MicrosoftLogo = () => (
  <svg
    width="20"
    height="20"
    viewBox="0 0 21 21"
    xmlns="http://www.w3.org/2000/svg"
    aria-hidden="true"
  >
    <rect x="1" y="1" width="9" height="9" fill="#f25022" />
    <rect x="11" y="1" width="9" height="9" fill="#7fba00" />
    <rect x="1" y="11" width="9" height="9" fill="#00a4ef" />
    <rect x="11" y="11" width="9" height="9" fill="#ffb900" />
  </svg>
);
