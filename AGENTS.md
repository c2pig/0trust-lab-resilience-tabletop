# Agent & Contributor Instructions (`0trust-lab-resilience-tabletop`)

## Two-Way Architecture Diagram Sync (Global <-> Local)

This repository powers **Lab 9 (`Chaos & Cyber Resilience Tabletop Simulator` — `/resilience-tabletop`)** on [`0trust.dev`](https://github.com/c2pig/0trust.dev/blob/main/docs/ECOSYSTEM_MAP.md), hosted at `https://resilience-tabletop.lab.0trust.dev`.

Whenever you modify code, edge functions, or infrastructure under `src/`, `functions/`, `infra/`, or `.github/workflows/`:
1. **Local Sync**: Update [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) and [`docs/diagrams/resilience_tabletop_architecture.svg`](docs/diagrams/resilience_tabletop_architecture.svg) in the same Pull Request (enforced by [`.github/workflows/diagram-check.yml`](.github/workflows/diagram-check.yml)).
2. **Global Sync**: If public contracts (`lab.manifest.json`, `seats`, `apiEndpoints`, `kvPrefixes`), R2 Object Lock invariants, or 2-of-2 break-glass interfaces change, also update `docs/labs/resilience-tabletop.md`, `docs/diagrams/resilience_tabletop_architecture.svg`, and `src/contracts/labManifest.ts` in [`c2pig/0trust.dev`](https://github.com/c2pig/0trust.dev).
