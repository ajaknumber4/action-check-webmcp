# Third-party notices

This project uses the following locally bundled fonts through Fontsource packages:

| Font | Package | Licence and copyright notice |
|---|---|---|
| Barlow Condensed | `@fontsource/barlow-condensed` | [SIL Open Font License 1.1](./docs/licenses/barlow-condensed-OFL-1.1.txt) |
| IBM Plex Mono | `@fontsource/ibm-plex-mono` | [SIL Open Font License 1.1](./docs/licenses/ibm-plex-mono-OFL-1.1.txt) |
| Source Sans 3 | `@fontsource/source-sans-3` | [SIL Open Font License 1.1](./docs/licenses/source-sans-3-OFL-1.1.txt) |

The complete upstream copyright statements and licence text are preserved in the linked files. The project does not modify or rename these fonts.

The repository currently contains seven binary visual assets:

- `docs/design/action-assurance-lab-concept.png`, `docs/design/workbench-awaiting-approval-concept.png`, and `docs/design/workbench-receipt-ready-concept.png` were generated specifically for this project with OpenAI's image-generation tool.
- `docs/screenshots/action-assurance-duplicate-proof.jpg`, `docs/screenshots/action-assurance-false-success-mobile.jpg`, and `docs/screenshots/workbench-receipt-ready.png` were captured directly from this project's local synthetic interface.
- `docs/screenshots/external-staging-refund-proof.png` was captured directly from the integrated local app-to-Worker synthetic proof.
- `docs/screenshots/action-check-live-discovery.jpg`, `docs/screenshots/action-check-live-approval.jpg`, and `docs/screenshots/action-check-live-proof.jpg` were captured directly from the deployed Action Check synthetic release.

A metadata and visual review on 2026-08-31 found no populated EXIF, IPTC, or XMP fields and no third-party logo, person, customer record, or real provider data in those seven files. The external-staging capture is current local QA evidence; all submission media must still be recaptured from the deployed release.

JavaScript package names and resolved versions are recorded in `package-lock.json`. Their upstream licence files remain available in their installed packages. This notice does not replace the terms of those licences.
