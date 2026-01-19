# Repository Guidelines

## Project Structure & Module Organization
This repository is currently empty. When adding code, keep the layout simple and predictable. Suggested baseline:

- `src/` for application source code
- `tests/` for automated tests
- `docs/` for design notes or runbooks
- `scripts/` for local tooling (e.g., data fetchers, maintenance tasks)

If you adopt a different structure, document it here and keep it consistent across modules.

## Build, Test, and Development Commands
No build, test, or run commands are defined yet. When you add tooling, list the exact commands and what they do. Example format:

- `make build` — compile the project
- `npm test` — run the test suite
- `python -m app` — start the service locally

## Coding Style & Naming Conventions
Define style rules as soon as the first code is added. Recommended defaults:

- Indentation: 2 spaces for JS/TS or 4 spaces for Python (choose one and stick to it).
- Naming: `snake_case` for files in Python, `kebab-case` for scripts, `PascalCase` for classes.
- Formatting: adopt a formatter (e.g., `black`, `prettier`, `gofmt`) and run it before commits.

## Testing Guidelines
No testing framework is configured yet. When tests are added, document:

- Framework (e.g., `pytest`, `jest`, `go test`)
- Test locations (e.g., `tests/`, `src/**/__tests__/`)
- Naming conventions (e.g., `test_*.py`, `*.spec.ts`)

## Commit & Pull Request Guidelines
There is no Git history available in this workspace. Until conventions are established, use clear, descriptive messages (e.g., "Add polling scheduler", "Fix outage parsing").

For pull requests:

- Describe the change and link any relevant issue or ticket.
- Include reproduction or test steps.
- Add screenshots or logs if the change affects user-visible behavior.

## Configuration & Secrets
If this project will consume APIs or external services, keep credentials out of source control. Use environment variables and document required keys in a `README.md` or `.env.example`.
