'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useIsAuthenticated, useMsal } from '@azure/msal-react';
import { hasAllowedRole } from '@mat-inspect/shared-auth';
import { ALLOWED_ROLES, loginRequest } from '@/lib/msal-config';

export default function LoginPage() {
  const { instance, accounts } = useMsal();
  const isAuthenticated = useIsAuthenticated();
  const router = useRouter();

  useEffect(() => {
    if (!isAuthenticated) return;
    if (hasAllowedRole(accounts[0] ?? null, ALLOWED_ROLES)) {
      router.replace('/');
    } else {
      router.replace('/unauthorized');
    }
  }, [isAuthenticated, accounts, router]);

  const handleSignIn = async () => {
    try {
      const result = await instance.loginPopup(loginRequest);
      instance.setActiveAccount(result.account);
    } catch {
      // User cancelled or popup blocked; stay on login page.
    }
  };

  return (
    <main
      style={{
        display: 'flex',
        minHeight: '100vh',
        alignItems: 'center',
        justifyContent: 'center',
        background: '#f9fafb',
      }}
    >
      <div
        style={{
          width: '100%',
          maxWidth: '384px',
          borderRadius: '8px',
          background: 'white',
          padding: '2rem',
          boxShadow: '0 2px 8px rgba(0,0,0,0.1)',
        }}
      >
        <h1
          style={{ fontSize: '1.5rem', fontWeight: 600, color: '#111827', marginBottom: '0.25rem' }}
        >
          MAT-Inspect
        </h1>
        <p style={{ fontSize: '0.875rem', color: '#6b7280', marginBottom: '1.5rem' }}>
          Operator App
        </p>
        <button
          onClick={handleSignIn}
          style={{
            display: 'flex',
            width: '100%',
            alignItems: 'center',
            justifyContent: 'center',
            gap: '0.75rem',
            borderRadius: '6px',
            border: '1px solid #d1d5db',
            background: 'white',
            padding: '0.625rem 1rem',
            fontSize: '0.875rem',
            fontWeight: 500,
            color: '#374151',
            cursor: 'pointer',
          }}
        >
          <MicrosoftLogo />
          Sign in with Microsoft
        </button>
      </div>
    </main>
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
