# Welcome to Team Meridian (Version 1)

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
- [ ] Install Node dependencies (required for local dev tools and pre-commit hooks):
      `npm install`
- [ ] Copy the environment file and start the stack:
      `cp .env.example .env && docker compose up`
- [ ] Open http://localhost:3000 and confirm "Hello, MAT-Inspect" (operator PWA stub)
- [ ] Open http://localhost:3001 and confirm "Hello, MAT-Inspect" (dashboard stub)
- [ ] Check service health endpoints return 200: - http://localhost:3000/health (PWA stub) - http://localhost:3001/health (dashboard stub, routed via host port 3001). For object storage, confirm the Azurite blob endpoint is reachable at http://localhost:10000 (Azurite has no /health route; a response, even 400, means it is up).
      Note: Caddy binds to the hostname `mat-inspect.staging`, not `localhost`.
      To test through Caddy, add `127.0.0.1 mat-inspect.staging` to `/etc/hosts`
      and trust Caddy's local CA certificate (`caddy trust` after `docker compose up`).
- [ ] Read these docs in order: 1. [CONTRIBUTING.md](CONTRIBUTING.md) — Git workflow, branch naming, commit style 2. [CODING_STANDARDS.md](CODING_STANDARDS.md) — Code style and layer structure 3. [AI_USAGE_GUIDE.md](AI_USAGE_GUIDE.md) — AI tools policy 4. [ARCHITECTURE.md](ARCHITECTURE.md) — System design overview

## Day 2 (Aim for 2 hours)

- [ ] Get the `.env` file from Stephen directly (in person or secure message); place it at the repo root
- [ ] Set up Tailscale access for dev staging (Stephen will send invite)
- [ ] Skim [PRD.md](PRD.md) and [FRS.md](FRS.md)
- [ ] Open your first ticket on the [Jira board](https://edu-team-asxyfk1n.atlassian.net/jira/software/projects/DEV/boards/1); Go to the Backlog tab, comment to claim it
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
| Missing .env file       | Ask Stephen for it directly                                                                        |
| Cannot access Tailscale | Stephen sends the invite                                                                           |
| A doc is unclear        | Ask in chat. If it took you more than 30 min to understand, the doc is wrong — update it           |
| CI is red on your PR    | Read the failed check log; fix it; do not bypass with `--no-verify`                                |
