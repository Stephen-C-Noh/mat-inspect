# MAT-Inspect

Pre-use inspection system for SAIT's MAT (Manufacturing, Automation, Transportation) School.
Capstone project, Team Meridian, Summer 2026.

## Quick Start

Prerequisites: Docker Desktop, Node 22 LTS, Git.

```bash
git clone https://github.com/Stephen-C-Noh/mat-inspect.git
cd mat-inspect
```

Get a real `.env` file from Stephen (`.env.example` alone will not boot;
core-api and the audit service refuse to start with blank or placeholder
Entra, Application Insights, or audit-token values). Then see
[docs/QUICKSTART.md](docs/QUICKSTART.md) for bring-up order, the DB
migrate/seed step, and the difference between running the full Docker stack
and iterating on one app with `npm run dev`.

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
