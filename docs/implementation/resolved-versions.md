# Resolved technology versions

Resolved on 2026-07-19 from official release documentation and stable registry
tags. No beta, canary or release-candidate package is used.

| Component             |     Version | Reason                                                       |
| --------------------- | ----------: | ------------------------------------------------------------ |
| Node.js               | 24.18.0 LTS | Current supported 24.x LTS pin; package accepts local 24.16+ |
| pnpm                  |     11.15.0 | Stable package manager with committed lockfile               |
| Next.js               |     16.2.10 | Stable App Router release; supports Node 20.9+               |
| React / React DOM     |      19.2.7 | Stable version paired with Next.js 16                        |
| TypeScript            |       5.9.3 | Stable strict compiler                                       |
| Supabase JS           |     2.110.7 | Current stable JS client                                     |
| Supabase SSR          |      0.12.3 | Current stable cookie-aware server package                   |
| Supabase CLI          |     2.109.1 | Stable local tooling; requires Docker-compatible runtime     |
| React Aria Components |      1.19.0 | Stable accessible interaction primitives                     |
| Tailwind CSS          |       4.3.3 | Stable styling baseline                                      |
| Vitest                |      4.1.10 | Stable Node 24-compatible unit runner                        |
| Playwright            |      1.61.1 | Stable browser runner                                        |
| axe-core Playwright   |      4.12.1 | Automated WCAG rule integration                              |
| PostCSS override      |      8.5.10 | Patched resolution for GHSA-qx2v-qp2m-jg93                   |

The lockfile is the reproducibility source of truth. Re-check the compatibility
matrix before upgrading any major version.
