# Welcome to Team Meridian

Welcome aboard. This is your day-1 to day-3 checklist. If anything is broken,
ping the chat; do not silently struggle.

## Before You Start (Windows only)

All shell commands in this guide assume a Unix shell. Windows users must use WSL2.

1. Open PowerShell as Administrator and run:
   ```
   wsl --install
   ```
2. Restart your machine. Ubuntu will be installed by default.
3. Open the Ubuntu app and complete the initial user setup.
4. Install Docker Desktop for Windows and enable WSL2 integration:
   Settings > Resources > WSL Integration > enable your Ubuntu distro.
5. From this point on, run all commands inside the Ubuntu (WSL2) terminal, not PowerShell or Command Prompt.

If WSL2 is already installed, confirm it is version 2: `wsl --list --verbose`. If any distro shows version 1, run `wsl --set-version Ubuntu 2`.

---

## Day 1 (Aim for 2 hours)

- [ ] Confirm you have GitHub access to the repo
- [ ] Confirm you can clone:
      `git clone https://github.com/Stephen-C-Noh/mat-inspect.git`
- [ ] Install prerequisites: Docker Desktop (or OrbStack on Mac), Node 22 LTS, Git
- [ ] Install gitleaks (required by pre-commit hook):
      `curl -sSfL https://raw.githubusercontent.com/gitleaks/gitleaks/main/scripts/install.sh | sh -s -- -b /usr/local/bin`
- [ ] Install ruff (required by pre-commit hook):
      `curl -LsSf https://astral.sh/ruff/install.sh | sh`
- [ ] Run the stack:
      `cp .env.example .env && docker compose up`
- [ ] Open http://localhost:3000 and confirm "Hello, MAT-Inspect" (operator PWA stub)
- [ ] Open http://localhost:3001 and confirm "Hello, MAT-Inspect" (dashboard stub)
- [ ] Check all service health endpoints return 200: - http://localhost/health (Caddy / API gateway) - http://localhost:9000/minio/health/live (MinIO)
- [ ] Read these docs in order: 1. [CONTRIBUTING.md](CONTRIBUTING.md) — Git workflow, branch naming, commit style 2. [CODING_STANDARDS.md](CODING_STANDARDS.md) — Code style and layer structure 3. [AI_USAGE_GUIDE.md](AI_USAGE_GUIDE.md) — AI tools policy 4. [ARCHITECTURE.md](ARCHITECTURE.md) — System design overview

## Day 2 (Aim for 2 hours)

- [ ] Set up Bitwarden access (Stephen will send invite link)
- [ ] Set up Tailscale access for dev staging (Stephen will send invite)
- [ ] Skim [PRD.md](PRD.md) and [FRS.md](FRS.md)
- [ ] Open your first issue in the Sprint 0 milestone; comment to claim it
- [ ] Create your first branch and open a PR (even trivial, e.g., add your name
      to a contributors section). This exercises the full workflow end to end.

## Day 3 and Beyond

- [ ] Pair with another teammate on a real feature
- [ ] Attend daily standup (15 min)
- [ ] Submit your first real feature PR

## If You Get Stuck

| Problem                 | Action                                                                                             |
| ----------------------- | -------------------------------------------------------------------------------------------------- |
| Stack does not start    | Check Docker Desktop is running; check ports 3000, 3001, 5432, 8080, 9000 are free on your machine |
| Cannot access GitHub    | Stephen (repo owner) can add you                                                                   |
| Cannot access Bitwarden | Stephen sends the invite                                                                           |
| Cannot access Tailscale | Stephen sends the invite                                                                           |
| A doc is unclear        | Ask in chat. If it took you more than 30 min to understand, the doc is wrong — update it           |
| CI is red on your PR    | Read the failed check log; fix it; do not bypass with `--no-verify`                                |
