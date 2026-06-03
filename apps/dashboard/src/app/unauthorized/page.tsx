import Link from 'next/link';

export default function UnauthorizedPage() {
  return (
    <main className="flex min-h-screen items-center justify-center bg-gray-50">
      <div className="w-full max-w-sm rounded-lg bg-white p-8 shadow text-center">
        <p className="mb-1 text-4xl font-bold text-gray-300">403</p>
        <h1 className="mb-3 text-xl font-semibold text-gray-900">Access Denied</h1>
        <p className="mb-6 text-sm text-gray-600">
          Your account does not have access to this dashboard. Only Manager and Admin roles are
          permitted. Contact your SAIT administrator to request access.
        </p>
        <Link href="/login" className="text-sm text-blue-600 hover:underline">
          Sign in with a different account
        </Link>
      </div>
    </main>
  );
}
