# Client Meeting: First Discovery Session

**Purpose:** Lock down everything needed to start Sprint 1 with confidence
**Duration:** 90 minutes (with 10-minute buffer)
**Sponsor side:** MAT School representative, possibly safety officer, possibly SAIT IT contact
**Team side:** All 5 students if possible; minimum the tech lead + one other
**Bring:** Laptop with the PRD, notepad, this document, list of equipment from the brief

**Send ahead of meeting (24 to 48 hours before):**

- One-page project summary (vision, scope, timeline)
- This list of questions, so the sponsor can prepare answers in advance
- Request a sample of completed paper inspection sheets (one per equipment class)

---

## 0. Pre-Meeting Prep (Day Before)

- [ ] Re-read the project brief and the PRD
- [ ] Print this document; bring a paper copy in case laptops are awkward in the meeting room
- [ ] Confirm meeting attendees, location, parking
- [ ] Identify which student will take notes (rotate; not the tech lead)
- [ ] Set up a shared notes doc (Google Doc or Markdown file) and link in advance
- [ ] Prepare elevator pitch: 60 seconds explaining what the system does

---

## 1. Confirmations (5 minutes)

Start by restating what the team understood from the brief. Sponsor confirms, corrects, or adds.

- [ ] Confirm: 10 pieces of equipment in scope, broken down as: 4 overhead cranes, 2 trucks, 1 electric pallet jack, 3 forklifts. **Q: Is this still accurate as of today?**
- [ ] Confirm: Main Campus only, no satellite locations (Aero Centre, Pt. Trotter) for MVP.
- [ ] Confirm: 6 to 7 Lab Techs as primary users.
- [ ] Confirm: Capstone deliverable due August 15, 2026.
- [ ] **Q: Who is the sponsor's primary decision-maker for scope changes during the project?**
- [ ] **Q: Who is the project champion (advocates for this internally at SAIT)?**

---

## 2. Equipment Deep Dive (15 minutes)

Goal: leave with enough to build the equipment registry seed data.

- [ ] **Q: Can we get make, model, serial number, and current location for each of the 10 machines?** If not available in this meeting, schedule a 30-minute walkaround in the shop within 1 week.
- [ ] **Q: Do you currently have unique asset tags for each machine? If yes, what format? If no, can we assign our own (proposed format: `MAT-{TYPE}-{NNN}`, e.g., `MAT-FL-001`)?**
- [ ] **Q: Are inspection items different for each individual machine (per-asset), or are they the same for all machines of a class (e.g., all forklifts use the same checklist)?** This determines whether we need 10 templates or 4.
- [ ] **Q: Do you have the existing paper checklist for each equipment class? Can we get photos or copies today?**
- [ ] **Q: How often do these checklists change? When were they last updated? Who has authority to update them?**
- [ ] **Q: Are there equipment items used seasonally or only by certain courses? Any that might be added in the next 12 months?**
- [ ] **Q: Where should we place the QR code stickers? Are there any "no sticker" zones (operator controls, hot surfaces, etc.)? Who applies them, the team or facilities staff?**
- [ ] **Q: Are there any pieces of equipment we should NOT include in the system (e.g., decommissioned, rarely-used, or owned by other departments)?**

---

## 3. People and Roles (15 minutes)

Goal: leave with a user provisioning plan.

- [ ] **Q: Exact headcount of Lab Techs today? Names and SAIT email addresses?**
- [ ] **Q: For each Lab Tech, which equipment classes are they currently certified to operate? Are certifications tracked on paper or in a system?**
- [ ] **Q: How are certifications renewed? Annual? Course completion? Who issues them?**
- [ ] **Q: How many shifts per day, and what hours? Do shifts overlap? Are there weekend shifts?**
- [ ] **Q: Who are the Supervisors? Count, names, emails. How do they map to Lab Techs (one supervisor per team? per shift?)**
- [ ] **Q: Who is the Manager role? Operations Manager? Department head?**
- [ ] **Q: Who at SAIT IT will inherit and maintain this system after handover?** This person should attend at least one demo and review the operations runbook.
- [ ] **Q: For Auditor accounts (Alberta OHS inspectors), do you want us to pre-provision a generic auditor account, or wait until an audit is scheduled?**

---

## 4. Current State (15 minutes)

Goal: understand the paper workflow we are replacing.

- [ ] **Q: Walk us through a typical pre-use inspection today, from start to finish. Where does the operator get the paper? Where do they return it? Who reviews it?**
- [ ] **Q: What percentage of inspections are completed in practice? Be honest; we will not judge.**
- [ ] **Q: What happens today when a Lab Tech finds a problem during inspection?**
  - Who do they tell? In person? Phone? Email?
  - Who decides if the equipment can be used or must be locked out?
  - How is "do not use" communicated to the next operator?
- [ ] **Q: Average time from defect found to defect resolved?**
- [ ] **Q: Who actually does repairs? Internal maintenance? External contractor? Both?**
- [ ] **Q: Where are completed paper inspection sheets stored? For how long? Who has retrieved them in the past 12 months?**
- [ ] **Q: Has there been an inspection-related incident or near miss in the past 2 years?** (Sensitive question; ask gently. Sets expectations for the safety value of the project.)
- [ ] **Q: Can we have 2 to 4 weeks of recent paper inspection sheets to study patterns and edge cases?**

---

## 5. Compliance and Audit (10 minutes)

Goal: confirm regulatory anchors and identify any SAIT-specific requirements.

- [ ] **Q: Has the MAT School been audited by Alberta OHS in the past 5 years? When was the most recent inspection or visit?**
- [ ] **Q: What specifically did the auditor review? Records, walkaround, interviews? Any findings or recommendations?**
- [ ] **Q: Are there internal SAIT safety audits or reviews separate from external OHS?**
- [ ] **Q: Does SAIT have a document retention policy above and beyond what OHS requires? Standard is 5 years; we propose 7. Acceptable?**
- [ ] **Q: Privacy concerns: are operators comfortable with voice clips being recorded for transcription? Any restrictions on photos of the equipment that might include identifiable people in the background?**
- [ ] **Q: Who is the SAIT FOIP officer? Can we get a copy of the FOIP review checklist for new systems handling employee data?**
- [ ] **Q: Is there an internal SAIT process for security review of new web applications? Penetration testing requirements?**

---

## 6. Hosting and IT (10 minutes)

**This section is critical.** Without IT decisions, Sprint 4 migration cannot happen.

- [ ] **Q: Has SAIT IT been engaged about this project yet? If not, can the sponsor set up an introduction within 1 week?**
- [ ] **Q: What is the typical timeline for SAIT IT to provision a new VM or cloud resource? Days? Weeks? Months?**
- [ ] **Q: Does SAIT use Microsoft 365 / Entra ID for staff authentication? Are Lab Techs SAIT employees (with Entra accounts), contractors (without), or students (with student accounts)?**
- [ ] **Q: Can we get an Azure VM under SAIT's institutional tenancy? Specs we need: 8 GB RAM, 2 vCPU, 64 GB SSD, Ubuntu 24.04 LTS. Estimated cost CAD $80 to $120 per month.**
- [ ] **Q: If Azure is not available, is a campus VM with the same specs an option? Lead time?**
- [ ] **Q: Network: is there reliable WiFi in the MAT lab where Lab Techs will use the system? Coverage in all bays?** **This is a hard requirement.** The PWA assumes connectivity is generally available. If significant dead zones exist, the offline scope must be upgraded, which is roughly 3 to 5 days of additional work. Confirm: signal strength in each of the 10 equipment locations. If unconfirmed, schedule a 30-minute WiFi survey during the equipment walkaround.
- [ ] **Q: Do Lab Techs have SAIT-issued phones, tablets, or personal devices? Will they be using their personal phones for QR scanning?**
- [ ] **Q: For dev staging during the first 9 weeks, the team plans to use a team-owned mini-PC accessed via Tailscale. No SAIT data on it. Acceptable?**

---

## 7. Operations and Rollout (10 minutes)

Goal: lock the pilot and production rollout dates.

- [ ] **Q: Pilot week is currently planned for July 27 to August 2. Any conflicts with the school calendar, course schedules, or staff vacations?**
- [ ] **Q: Production rollout planned for August 3 to August 9. Any conflicts?**
- [ ] **Q: When during the school day is best for training sessions? Beginning of shift? Lunch? End of shift?**
- [ ] **Q: Lab Tech training: 30-minute session per shift is planned. Acceptable, or does this need to be longer? Shorter?**
- [ ] **Q: Supervisor training: 1-hour session planned. Manager: 1-hour. Acceptable?**
- [ ] **Q: During cutover from paper to digital, we plan to keep paper as a 3-day fallback. Acceptable, or does the sponsor want longer or shorter parallel-run period?**
- [ ] **Q: Can the sponsor identify 2 to 3 Lab Techs who would be willing to act as "power users" during the pilot, providing rapid feedback?**
- [ ] **Schedule the equipment walkaround** within 1 week of this meeting. Combine three goals into one 60- to 90-minute visit:
  1. Collect make / model / serial / location for each of the 10 machines
  2. WiFi signal survey at each equipment location (use a phone WiFi analyzer app)
  3. **Whisper acoustic test:** record 10 to 15 second voice clips at typical operator-to-equipment distance, with typical background noise (compressor running, equipment idling). The team transcribes these with `small.en` afterward and computes word error rate. If WER exceeds 20 percent, escalation options are documented in ARCHITECTURE Section 9.

---

## 8. Project Cadence and Communication (5 minutes)

- [ ] **Q: Sprint demos are end of every 2 weeks (and weekly for the last 3 weeks). Preferred day and time?**
- [ ] **Q: Preferred channel for ongoing communication: email, Microsoft Teams, in-person, mix?**
- [ ] **Q: Sponsor availability over the 13 weeks: any vacations, travel, conferences we should know about?**
- [ ] **Q: Decision-making: if we need a scope or schedule change, who has authority to approve? Is it the same person as the sponsor, or different?**
- [ ] **Q: Escalation path: if we are blocked on something the sponsor cannot resolve (e.g., SAIT IT delay), who can help unblock?**

---

## 9. Out of Scope Confirmation (5 minutes)

Confirm what we are NOT building, to manage expectations early.

- [ ] **Confirm:** Satellite campus locations are out of scope.
- [ ] **Confirm:** Equipment classes beyond the four (overhead crane, truck, electric pallet jack, forklift) are out of scope.
- [ ] **Confirm:** Native iOS or Android apps are out of scope; the PWA covers mobile use.
- [ ] **Confirm:** Integration with existing maintenance management or asset management systems is out of scope.
- [ ] **Confirm:** Predictive maintenance, equipment telemetry, and 3D visualization are out of scope.
- [ ] **Q: Are there other things the sponsor was hoping for that they have not mentioned? Better to surface and defer now than negotiate in Sprint 5.**

---

## 10. Sponsor's Questions for Us (5 minutes)

Open floor. Common questions to be ready for:

- "How much will this cost SAIT to maintain after handover?" (Answer: hosting cost only, software is free)
- "What if your team graduates and the system breaks?" (Answer: comprehensive handover docs; SAIT IT owns it; the Docker stack is restartable from Git)
- "What if Alberta OHS changes their rules?" (Answer: checklist templates are admin-editable; structural changes would need a follow-on project)
- "Can other schools at SAIT use this?" (Answer: yes in v2; in scope for the capstone is MAT only)
- "How accurate is the AI transcription?" (Answer: 90 to 95 percent in quiet conditions; operator always reviews and edits)

---

## 11. Action Items and Next Steps (5 minutes)

Close the meeting by writing these out together in the shared notes doc.

- [ ] List of decisions confirmed today
- [ ] List of open items with named owners and deadlines
- [ ] Date and format of next meeting (recommended: short 30-min check-in at end of Sprint 0, then sprint demos thereafter)
- [ ] Deliverables expected from the sponsor before next meeting (e.g., equipment list, paper checklist samples, SAIT IT contact)
- [ ] Deliverables we owe the sponsor (e.g., revised PRD if scope changed; meeting notes within 24 hours)

---

## Post-Meeting Tasks (Within 48 Hours)

- [ ] Send meeting notes to all attendees for confirmation
- [ ] Update PRD with any scope changes; commit to repo with a "post-client-meeting-1" tag
- [ ] Create issues in GitHub for each open question with a named owner
- [ ] Schedule the equipment walkaround if needed
- [ ] Forward SAIT IT contact to the team and schedule a follow-up with them
- [ ] Send a thank-you note to the sponsor

---

## Red Flags to Watch For

If you hear any of these during the meeting, flag them politely and follow up before Sprint 1:

- **"We don't actually have a fixed list of equipment yet."** → Project scope is unstable; need a hard list by end of Week 1.
- **"SAIT IT has not been engaged."** → Start the engagement immediately; this is the critical path for Sprint 4.
- **"The Lab Techs are not SAIT employees; they are contractors."** → Affects authentication strategy (contractors do not have SAIT Entra ID accounts; would require a separate identity solution). Confirmed resolved: lab techs are SAIT staff and have SAIT accounts. Entra ID is the auth provider.
- **"We were hoping you could also integrate with our existing system X."** → Scope creep; defer to v2 unless trivial.
- **"Inspections are currently done by whoever is around, not necessarily by certified operators."** → Real compliance gap; not your team's fault, but be clear that the system will enforce certification.
- **"We don't really track defects today; problems just get fixed when someone notices."** → No baseline for the defect workflow; you will design the canonical process.

These are not project killers, but each one shifts the plan. Update the architecture document accordingly.

---

**End of agenda.**
