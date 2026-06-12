# MAT-Inspect

Pre-use inspection system for SAIT's MAT (Manufacturing, Automation, Transportation) School.
Capstone project, Team Meridian, Summer 2026.

## Quick Start

Prerequisites: Docker Desktop, Node 22 LTS, Git.

```bash
git clone https://github.com/Stephen-C-Noh/mat-inspect.git
cd mat-inspect
cp .env.example .env
docker compose up
```

Open http://localhost:3000 for the operator PWA.
Open http://localhost:3001 for the manager dashboard.

### Running one app locally (without Docker)

The Docker stack runs everything together. To iterate on a single app, run
`npm run dev` from that app's folder. Local dev ports:

| App       | Local dev port |
| --------- | -------------- |
| core-api  | 3000           |
| dashboard | 3001           |
| pwa       | 3002           |

The PWA uses 3002 locally because core-api holds 3000 and the dashboard holds 3001. These local ports differ from the Docker host ports above, where the PWA
is on 3000 and core-api sits behind Caddy with no host port. When the PWA gets
MSAL login (DEV-26), add `http://localhost:3002` as a redirect URI on the app
registration.

## New Teammate? Read These in Order

1. [CONTRIBUTING.md](docs/CONTRIBUTING.md) - Git workflow
2. [CODING_STANDARDS.md](docs/CODING_STANDARDS.md) - Code style
3. [AI_USAGE_GUIDE.md](docs/AI_USAGE_GUIDE.md) - AI tools policy
4. [ARCHITECTURE.md](docs/ARCHITECTURE.md) - System design
5. [PRD.md](docs/PRD.md) - What we are building and why
6. [FRS.md](docs/FRS.md) - Feature specifications
7. [API_REFERENCE.md](docs/API_REFERENCE.md) - Endpoint reference

## Team

5 students, see CODEOWNERS for area ownership.

## Contributors

| Name           | GitHub    |
| -------------- | --------- |
| Adan Hernandez | @4d4n-HDZ |

## Sponsor

SAIT School of Manufacturing, Automation, and Transportation.

## License

MIT
Setup tested
