# AI Usage Guide for Team Meridian (MAT-Inspect)

This guide governs how team members use AI assistants (Claude, ChatGPT, Cursor, GitHub Copilot, and similar) on the MAT-Inspect capstone project.

Two reasons this matters:

1. **Compliance and privacy.** The system handles Alberta OHS records and SAIT institutional data subject to FOIP. Pasting the wrong thing into an external AI service is a real incident.
2. **Capstone defense.** Every team member must be able to explain any code or document they submit. If AI wrote it and you cannot explain it, you do not ship it.

This guide is not anti-AI. AI is a productivity multiplier on this project. The rules below exist so the multiplier works in your favor instead of against you.

---

## 1. Allowed AI Tools

Approved for use:

- Anthropic Claude (web, app, Claude Code)
- OpenAI ChatGPT
- GitHub Copilot (in-editor suggestions)
- Cursor / Windsurf / similar AI-first IDEs
- Codeium / Continue.dev

Not approved (require team discussion first):

- Random AI services from unknown vendors
- AI tools that train on your conversations by default (read the terms before using)
- Self-hosted models that have not been vetted

**Always check the data retention setting of the tool you use.** Default settings on most consumer AI services retain conversations. For this project, prefer settings that disable training and shorten retention where available.

---

## 2. What AI Is Good For on This Project

Use AI freely for:

- Code scaffolding: a new Fastify route, a Drizzle schema, a React component, a Dockerfile, a GitHub Actions workflow
- Boilerplate: error handling patterns, validation schemas, test setup
- Test generation: write the first cut of unit tests, then verify they actually test behavior
- Debugging: paste an error, get hypotheses, then verify
- Explaining unfamiliar code, libraries, or APIs
- SQL drafting: get a query, then run EXPLAIN and verify the plan
- Regex: get the pattern, then test it against edge cases
- UI / CSS variants: ask for three layouts, pick the one that fits
- Documentation drafts: AI writes a first draft, you edit
- Translating between styles: callback to async/await, JavaScript to TypeScript
- Commit message and PR description drafting

---

## 3. What AI Is NOT Good For

Use extreme care or avoid:

- **Architectural decisions.** AI gives plausible but generic advice. Architecture decisions on this project go in ADRs, written by humans, after team discussion.
- **Alberta OHS citations.** AI hallucinates regulatory clauses. Every OHS reference in this project (in code comments, in docs, in the SECURITY.md) must be verified against the actual source on `search-ohs-laws.alberta.ca` before it ships.
- **Security-sensitive code.** Auth flows, HMAC implementation, hash chain logic, JWT validation. AI may suggest patterns that look correct but have subtle holes. Two human reviewers minimum on these.
- **Audit Service code.** This is the legal record of inspections. Treat AI output here as a starting point only.
- **Database migrations.** High blast radius. Read the migration carefully. Run it in dev first. Always.
- **Final capstone deliverables.** The professor reads them. The sponsor reads them. AI-fluffed text reads exactly as AI-fluffed text and undermines credibility.

---

## 4. Hard Prohibitions

These are not guidelines. These are rules.

**Never paste into any AI tool:**

- Real SAIT credentials, API keys, JWT secrets, database passwords
- `.env` file contents (even "redacted" ones)
- Real Lab Tech names, emails, employee IDs
- Real inspection data captured during the Sprint 5 pilot or production use
- Real voice clips from inspections (audio is biometric PII under FOIP)
- Real photos that contain identifiable people
- SAIT internal documents that the sponsor or campus IT shared with the team

**Never commit AI-generated code without reading every line.** If you accept an AI suggestion you do not understand, you are now on the hook to maintain code you cannot explain. Read it, understand it, then commit.

**Never use AI to invent OHS regulatory text.** If you need a citation, look it up. The actual source is at `search-ohs-laws.alberta.ca/legislation/occupational-health-and-safety-code/`. AI hallucinations of clause numbers and language will not survive sponsor or auditor review.

**Never auto-approve AI suggestions in code review.** Read the diff. If the diff is too large to read, the PR is too large.

---

## 5. Privacy and FOIP

The MAT-Inspect system processes SAIT institutional data covered by Alberta's Freedom of Information and Protection of Privacy Act (FOIP).

External AI services (Claude, ChatGPT, Copilot cloud) are third parties that may store, log, and process whatever you send them. From a FOIP perspective, sending SAIT data to an external AI is a disclosure to a third party.

Rules:

- Synthetic data only when asking AI for help with database or logic problems
- Anonymize before pasting (replace real names with `User1`, real asset tags with `EQ-001`)
- The voice transcription AI Service in this project runs on-prem; external AI services do not see voice clips
- When in doubt about whether something is FOIP-protected, do not paste it. Ask the team lead.

---

## 6. Code Review When AI Was Used

If a PR contains substantial AI-generated code:

1. **Author** declares it in the PR description: "Sections X and Y were drafted with AI assistance."
2. **Reviewer** reads with extra skepticism for:
   - API or library calls that do not exist (hallucinated method names)
   - Outdated library versions or deprecated patterns
   - Missing error handling
   - Comments that describe what the code "should" do but the code does something different
   - Silently caught exceptions
   - String concatenation in SQL (parameterize)
   - Manual JSON parsing where Zod should be used
   - Hardcoded values that should be config
3. **Author** must be able to explain any line the reviewer asks about. If the answer is "the AI wrote it, I'm not sure", the PR is not ready.

---

## 7. Commits and PR Descriptions

- Commit messages: written by humans, in the project's conventional commit style.
- PR descriptions: humans write them. AI can draft, you edit. The PR description is your professional record; it should reflect your understanding, not the AI's.
- Do not include AI-generated changelog noise ("This PR introduces a comprehensive solution that leverages..."). Plain, factual sentences. Subject-verb-object. See the team writing style in CONTRIBUTING.md.

---

## 8. Time Management with AI

Common failure mode: spend 45 minutes re-prompting AI until it gives an answer that looks right, when 10 minutes of reading the actual docs would have solved the problem definitively.

Heuristics:

- If you have re-prompted AI more than 3 times on the same issue, stop. Read the documentation directly.
- If AI keeps suggesting variants of a solution that does not work, the problem is probably outside what AI knows about. Read the source. Or ask a teammate.
- For Drizzle ORM, Fastify, MSAL / Microsoft identity platform (Entra ID): read the official docs. AI often has stale or fabricated knowledge of these.
- For Whisper: the faster-whisper README is short. Read it.

When you are stuck for more than 30 minutes, post in the team chat before continuing to argue with the AI.

---

## 9. Academic Integrity

SAIT capstone programs may have specific rules on AI use. Each team member is responsible for:

- Reading SAIT's academic integrity policy on AI as of Spring 2026
- Asking the capstone instructor directly about AI use expectations for this course
- Disclosing AI use in the final capstone deliverables if required
- Maintaining the ability to defend any code or document in the submission

If the instructor sets stricter rules than this guide, the instructor's rules win.

---

## 10. What to Do When AI Is Wrong About This Project

AI tools have a training cutoff. They will sometimes be confidently wrong about:

- Library versions (Next.js, Fastify, Drizzle release frequently)
- Alberta OHS specifics
- This project's specific architecture decisions

When you catch AI being wrong:

- Do not just re-prompt. Correct the AI in context (or paste the relevant section of `CLAUDE.md` into the chat) so the rest of the session is grounded.
- If the error is systemic (AI keeps using an outdated pattern), update `CLAUDE.md` in the repo so the next teammate gets the corrected context.

---

## 11. Project AI Briefing File

The repo root contains `CLAUDE.md`. This file is the project briefing for AI tools. Paste it (or its relevant section) into:

- Claude chat sessions when starting work on a new feature
- Cursor (it auto-loads as project context if placed in the repo root)
- ChatGPT custom instructions for project-specific sessions
- Any other AI tool you use

Update `CLAUDE.md` when you learn that AI consistently gets something wrong about this project. It is a living file, version-controlled, reviewed in PRs like any other code.

---

## 12. Quick Self-Check Before Pasting Into AI

Before you hit send on a paste into Claude or ChatGPT, ask:

- Does this contain a real credential, key, or secret?
- Does this contain personal information of any SAIT employee or student?
- Does this contain SAIT internal data the sponsor shared with us?
- If a screenshot of this conversation showed up in a FOIP audit, would I be uncomfortable?

If any answer is yes or maybe, do not paste. Anonymize first, or ask the team lead.

---

**End of guide.** Questions or proposed changes: open a PR against this file.
