'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState, type ReactElement, type ReactNode } from 'react';
import { useMsal } from '@azure/msal-react';
import {
  ChevronRight,
  Bell,
  Moon,
  Globe,
  Shield,
  Info,
  HelpCircle,
  LogOut,
  User,
  AlertTriangle,
  CheckCircle,
} from 'lucide-react';
import { AuthGuard } from '@/components/auth-guard';
import { useTheme } from '@/hooks/use-theme';

function Toggle({ checked, onChange }: { checked: boolean; onChange: () => void }): ReactElement {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      onClick={onChange}
      className={`relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors focus:outline-none ${
        checked ? 'bg-accent' : 'bg-border'
      }`}
    >
      <span
        className={`inline-block h-4 w-4 transform rounded-full bg-accent-foreground shadow transition-transform ${
          checked ? 'translate-x-6' : 'translate-x-1'
        }`}
      />
    </button>
  );
}

function AccordionRow({
  icon: Icon,
  label,
  preview,
  danger,
  children,
}: {
  icon: typeof User;
  label: string;
  preview?: string;
  danger?: boolean;
  children: ReactNode;
}): ReactElement {
  const [open, setOpen] = useState(false);

  return (
    <div>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center justify-between p-4 text-left"
      >
        <div className="flex items-center gap-3">
          <div className={`rounded-sm p-2 ${danger ? 'bg-destructive/10' : 'bg-muted'}`}>
            <Icon className={`size-5 ${danger ? 'text-destructive' : 'text-accent'}`} />
          </div>
          <div>
            <p
              className={`font-semibold text-sm ${danger ? 'text-destructive' : 'text-foreground'}`}
            >
              {label}
            </p>
            {preview && !open && <p className="text-xs text-muted-foreground mt-0.5">{preview}</p>}
          </div>
        </div>
        <ChevronRight
          className={`size-4 text-muted-foreground transition-transform duration-200 ${
            open ? 'rotate-90' : ''
          }`}
        />
      </button>

      {open && <div className="border-t border-border bg-muted/50 px-4 pb-4 pt-3">{children}</div>}
    </div>
  );
}

function SectionLabel({ children }: { children: string }): ReactElement {
  return (
    <p className="px-1 pb-1 pt-5 text-xs font-bold uppercase tracking-widest text-muted-foreground">
      {children}
    </p>
  );
}

function SettingsContent(): ReactElement {
  const { instance, accounts } = useMsal();
  const router = useRouter();
  const account = accounts[0];
  const { isDark, toggle: toggleDark } = useTheme();

  const [language, setLanguage] = useState<'en' | 'fr' | 'es'>('en');

  const handleSignOut = async () => {
    try {
      await instance.logoutRedirect();
    } catch {
      // swallowed
    }
  };

  return (
    <main className="min-h-screen bg-muted">
      <header className="flex items-center gap-3 bg-primary px-4 py-3 text-primary-foreground">
        <button
          type="button"
          onClick={() => router.back()}
          className="rounded-sm p-1.5 hover:bg-primary-foreground/10 transition-colors"
          aria-label="Go back"
        >
          <ChevronRight className="size-5 rotate-180" />
        </button>
        <span className="text-sm font-extrabold uppercase tracking-wide">Settings</span>
      </header>

      <div className="mx-auto max-w-lg px-4 pb-12">
        {/* Account card */}
        <div className="mt-6 flex items-center gap-4 rounded-sm border border-border bg-card p-4 shadow-card">
          <div className="flex h-14 w-14 items-center justify-center rounded-full bg-accent text-xl font-extrabold text-accent-foreground">
            {account?.name?.charAt(0)?.toUpperCase() ?? 'U'}
          </div>
          <div>
            <p className="text-base font-bold text-foreground">{account?.name ?? 'Operator'}</p>
            <p className="text-sm text-muted-foreground">{account?.username ?? ''}</p>
            <span className="mt-1 inline-block rounded-sm bg-muted px-2 py-0.5 text-xs font-semibold text-muted-foreground">
              Operator
            </span>
          </div>
        </div>

        {/* Notifications */}
        <SectionLabel>Notifications</SectionLabel>
        <div className="overflow-hidden rounded-sm border border-border bg-card shadow-card divide-y divide-border">
          <AccordionRow icon={Bell} label="Inspection Alerts" preview="Auto — Email and Teams">
            <div className="flex items-start gap-3 py-2">
              <CheckCircle className="mt-0.5 size-4 shrink-0 text-accent" />
              <p className="text-sm text-muted-foreground leading-relaxed">
                Sent automatically by email and to the equipment's Teams channel. This is configured
                for the whole site, not per person.
              </p>
            </div>
          </AccordionRow>

          <AccordionRow
            icon={AlertTriangle}
            label="Failure Notifications"
            preview="Auto — submitted to chair holder"
          >
            <div className="flex items-start gap-3 py-2">
              <CheckCircle className="mt-0.5 size-4 shrink-0 text-accent" />
              <p className="text-sm text-muted-foreground leading-relaxed">
                Failed inspections are automatically submitted to the chair holder. No additional
                configuration required.
              </p>
            </div>
          </AccordionRow>
        </div>

        {/* Preferences */}
        <SectionLabel>Preferences</SectionLabel>
        <div className="overflow-hidden rounded-sm border border-border bg-card shadow-card divide-y divide-border">
          <AccordionRow icon={Moon} label="Dark Mode" preview={isDark ? 'On' : 'Off'}>
            <div className="flex items-center justify-between py-2">
              <div>
                <p className="text-sm font-medium text-foreground">Dark theme</p>
                <p className="text-xs text-muted-foreground">Reduces eye strain in low light</p>
              </div>
              <Toggle checked={isDark} onChange={toggleDark} />
            </div>
          </AccordionRow>

          <AccordionRow
            icon={Globe}
            label="Language"
            preview={{ en: 'English', fr: 'Français', es: 'Español' }[language]}
          >
            <div className="divide-y divide-border">
              {(['en', 'fr', 'es'] as const).map((code) => (
                <button
                  key={code}
                  type="button"
                  onClick={() => setLanguage(code)}
                  className="flex w-full items-center justify-between py-2.5 text-left"
                >
                  <span className="text-sm font-medium text-foreground">
                    {{ en: 'English', fr: 'Français', es: 'Español' }[code]}
                  </span>
                  {language === code && <span className="text-xs font-bold text-accent">✓</span>}
                </button>
              ))}
            </div>
          </AccordionRow>
        </div>

        {/* Security */}
        <SectionLabel>Security</SectionLabel>
        <div className="overflow-hidden rounded-sm border border-border bg-card shadow-card">
          <AccordionRow icon={Shield} label="Privacy Policy">
            <p className="text-sm text-muted-foreground leading-relaxed">
              MAT-Inspect collects inspection records, operator IDs, and equipment photos as
              required by Alberta OHS s.257. Voice clips are processed on SAIT infrastructure only
              and are never sent to external services.
            </p>
            <Link href="/" className="mt-3 block text-xs font-bold text-accent">
              View full policy →
            </Link>
          </AccordionRow>
        </div>

        {/* About */}
        <SectionLabel>About</SectionLabel>
        <div className="overflow-hidden rounded-sm border border-border bg-card shadow-card divide-y divide-border">
          <AccordionRow icon={Info} label="App Version" preview="1.0.0">
            <div className="space-y-1 text-sm text-muted-foreground">
              <p>
                <span className="font-semibold text-foreground">Version</span> 1.0.0
              </p>
              <p>
                <span className="font-semibold text-foreground">Build</span> 2025.07.01
              </p>
              <p>
                <span className="font-semibold text-foreground">Environment</span> Production
              </p>
            </div>
          </AccordionRow>

          <Link href="/help" className="flex items-center justify-between p-4">
            <div className="flex items-center gap-3">
              <div className="rounded-sm bg-muted p-2">
                <HelpCircle className="size-5 text-accent" />
              </div>
              <span className="text-sm font-semibold text-foreground">Help Center</span>
            </div>
            <ChevronRight className="size-4 text-muted-foreground" />
          </Link>
        </div>

        {/* Account */}
        <SectionLabel>Account</SectionLabel>
        <div className="overflow-hidden rounded-sm border border-border bg-card shadow-card">
          <button
            type="button"
            onClick={handleSignOut}
            className="flex w-full items-center gap-3 p-4 text-left"
          >
            <div className="rounded-sm bg-destructive/10 p-2">
              <LogOut className="size-5 text-destructive" />
            </div>
            <span className="font-semibold text-sm text-destructive">Sign Out</span>
          </button>
        </div>
      </div>
    </main>
  );
}

export default function SettingsPage(): ReactElement {
  return (
    <AuthGuard>
      <SettingsContent />
    </AuthGuard>
  );
}
