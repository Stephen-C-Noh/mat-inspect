'use client';

import { useRouter } from 'next/navigation';
import { useState, type ReactElement, type ReactNode } from 'react';
import { ChevronRight, ChevronDown, Mail } from 'lucide-react';
import { AuthGuard } from '@/components/auth-guard';

function FaqItem({ question, children }: { question: string; children: ReactNode }): ReactElement {
  const [open, setOpen] = useState(false);

  return (
    <div className="border-b border-border last:border-0">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center justify-between px-4 py-3.5 text-left"
      >
        <span className="text-sm font-semibold text-foreground pr-4">{question}</span>
        <ChevronDown
          className={`size-4 shrink-0 text-muted-foreground transition-transform duration-200 ${open ? 'rotate-180' : ''}`}
        />
      </button>
      {open && (
        <div className="px-4 pb-4 text-sm text-muted-foreground leading-relaxed">{children}</div>
      )}
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

function HelpContent(): ReactElement {
  const router = useRouter();

  return (
    <main id="main-content" tabIndex={-1} className="min-h-screen bg-muted">
      <header className="flex items-center gap-3 bg-primary px-4 py-3 text-primary-foreground">
        <button
          type="button"
          onClick={() => router.back()}
          className="rounded-sm p-1.5 hover:bg-primary-foreground/10 transition-colors"
          aria-label="Go back"
        >
          <ChevronRight className="size-5 rotate-180" />
        </button>
        <span className="text-sm font-extrabold uppercase tracking-wide">Help Center</span>
      </header>

      <div className="mx-auto max-w-lg px-4 pb-12">
        <SectionLabel>Frequently Asked Questions</SectionLabel>
        <div className="overflow-hidden rounded-sm border border-border bg-card shadow-card">
          <FaqItem question="What do the equipment status badges mean?">
            READY means the equipment passed an inspection today and can be operated.
            AWAITING_INSPECTION means it has not yet been checked today. OUT_OF_SERVICE means a
            blocking failure took it out of service; it stays out until a return-to-service
            inspection passes.
          </FaqItem>
          <FaqItem question="How do I handle a new defect?">
            Open Defects and use Acknowledge to confirm you have seen it, then Start Repair once
            work begins. Resolve marks the repair complete.
          </FaqItem>
          <FaqItem question="How do I return equipment to service after a blocking failure?">
            Once every blocking defect on that equipment is Resolved, its row shows Approve Return
            to Service. Approving records a new inspection and clears OUT_OF_SERVICE.
          </FaqItem>
          <FaqItem question="What does the bell icon show?">
            Inspections submitted since you last dismissed the list. Dismissing a notification
            dismisses it on every device signed in as you.
          </FaqItem>
        </div>

        <SectionLabel>Contact</SectionLabel>
        <div className="overflow-hidden rounded-sm border border-border bg-card shadow-card">
          <div className="flex items-center gap-3 p-4">
            <div className="rounded-sm bg-muted p-2">
              <Mail className="size-5 text-accent" />
            </div>
            <div>
              <p className="text-sm font-semibold text-foreground">Contact Support</p>
              <p className="text-xs text-muted-foreground">supervisor email / phone number</p>
            </div>
          </div>
        </div>
      </div>
    </main>
  );
}

export default function HelpPage(): ReactElement {
  return (
    <AuthGuard>
      <HelpContent />
    </AuthGuard>
  );
}
