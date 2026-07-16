import Link from 'next/link';
import type { ReactElement } from 'react';

export const DashboardNav = (): ReactElement => {
  return (
    <header className="flex items-center gap-6 bg-primary px-6 py-3 text-primary-foreground">
      <span className="text-sm font-extrabold uppercase tracking-wide">MAT-Inspect</span>
      <nav className="flex gap-4 text-sm font-semibold">
        <Link href="/dashboard" className="hover:opacity-80">
          Dashboard
        </Link>
        <Link href="/defects" className="hover:opacity-80">
          Defects
        </Link>
      </nav>
    </header>
  );
};
