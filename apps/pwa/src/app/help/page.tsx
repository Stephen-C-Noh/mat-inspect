'use client';

import { useRouter } from 'next/navigation';
import { useState, type ReactElement, type ReactNode } from 'react';
import { ChevronRight, BookOpen, Mail, ChevronDown } from 'lucide-react';
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

function ContactCard({
  icon: Icon,
  title,
  subtitle,
}: {
  icon: typeof Mail;
  title: string;
  subtitle: string;
}): ReactElement {
  return (
    <div className="flex items-center gap-3 p-4">
      <div className="rounded-sm bg-muted p-2">
        <Icon className="size-5 text-accent" />
      </div>
      <div>
        <p className="text-sm font-semibold text-foreground">{title}</p>
        <p className="text-xs text-muted-foreground">{subtitle}</p>
      </div>
      <ChevronRight className="ml-auto size-4 text-muted-foreground" />
    </div>
  );
}

function HelpContent(): ReactElement {
  const router = useRouter();

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
        <span className="text-sm font-extrabold uppercase tracking-wide">Help Center</span>
      </header>

      <div className="mx-auto max-w-lg px-4 pb-12">
        {/* FAQ */}
        <SectionLabel>Frequently Asked Questions</SectionLabel>
        <div className="overflow-hidden rounded-sm border border-border bg-card shadow-card">
          <FaqItem question="How do I start an inspection?">
            Scan the QR code on the equipment using the Scan tab on the home screen. The app will
            load the correct checklist for that piece of equipment automatically.
          </FaqItem>
          <FaqItem question="What happens if I fail an item?">
            Failed items are flagged at the end of the checklist. You must document each failure
            with notes before submitting. The supervisor is notified automatically once the
            inspection is submitted.
          </FaqItem>
          <FaqItem question="Why can I not submit the inspection?">
            All checklist items must be answered before submission is allowed. Scroll through the
            checklist to find any unanswered items highlighted in orange.
          </FaqItem>
          <FaqItem question="What does FAIL BLOCKING mean?">
            A blocking failure means the equipment must be taken out of service immediately. The
            equipment status is set to OUT OF SERVICE and the supervisor is notified. Do not operate
            the equipment until a return-to-service inspection is completed.
          </FaqItem>
          <FaqItem question="How do I add a photo to a defect?">
            On the Document Failures screen, tap the photo placeholder below a failure card. Your
            device camera or gallery will open so you can attach an image.
          </FaqItem>
        </div>

        {/* Documentation */}
        <SectionLabel>Documentation</SectionLabel>
        <div className="overflow-hidden rounded-sm border border-border bg-card shadow-card divide-y divide-border">
          <button type="button" className="w-full text-left">
            <ContactCard
              icon={BookOpen}
              title="Operator User Guide"
              subtitle="Step-by-step inspection walkthrough"
            />
          </button>
          <button type="button" className="w-full text-left">
            <ContactCard
              icon={BookOpen}
              title="Alberta OHS Requirements"
              subtitle="s.257 pre-use inspection obligations"
            />
          </button>
        </div>

        {/* Contact */}
        <SectionLabel>Contact</SectionLabel>
        <div className="overflow-hidden rounded-sm border border-border bg-card shadow-card divide-y divide-border">
          <button type="button" className="w-full text-left">
            <ContactCard
              icon={Mail}
              title="Contact Support"
              subtitle="supervisor email / phone number"
            />
          </button>
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
