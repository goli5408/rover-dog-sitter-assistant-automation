# The Barking Lot — Pet Care Automation

A privacy-conscious sample repository for automating a boutique pet-sitting operation with **Google Forms, Google Sheets, Google Calendar, Google Apps Script, and Notion**.

> **Public-code edition.** This repository contains source code, setup instructions, and fabricated test fixtures only. It deliberately contains no real customer or pet profiles, responses, calendar identifiers, private subscription URLs, Notion tokens, Notion database IDs, or actual event history.

## Features

| Workflow | Source | Destination | Behavior |
| --- | --- | --- | --- |
| Pet care intake (v0.4) | Google Form responses | Notion Customer / Dog Profile | Structured field matching, conflict review, dry-run support |
| Booking monitor (v0.7) | Rover subscription calendar + direct calendar | Private Google Sheets report | Hourly, read-only preview of match outcomes |
| Booking creation (v0.7) | New eligible calendar event | Notion Booking History | Baseline protection, unique owner/pet matching, guarded automatic create |

Both calendars use the naming convention `Dog Name / Owner Name: Service Type`. The booking source is the **calendar**, not just the text in the event description. Direct bookings may have times; Rover iCal entries can be all-day events (with exclusive end-date semantics). Calendar entries do not prove payment or completion.

## Architecture

```text
Google Form ----> Responses Sheet ----> Intake Code.js ----> Notion Customer & Dog Profile

Rover iCal ------\
                 +----> CalendarSync.js ----> Notion Booking History (eligible new records)
Direct Calendar -/                |
                                  +----> Private dry-run & registry tabs

CalendarTriggerMonitor.js: hourly monitor only
CalendarTriggerAuto.js: gated hourly booking creation
```

## Getting started (development)

Requirements: Node.js 20+.

```sh
npm test
npm run privacy:check
npm run verify
```

No credentials are needed for the local unit tests. Fictional sample data is in [`tests/fixtures/sample-data.json`](tests/fixtures/sample-data.json).

To generate the Apps Script files:

```sh
npm run build
```

This creates a local `dist/` folder. **Do not add `.clasp.json`, real Script Properties, exported Sheets, diagnostic logs, or any private data to Git.**

## Google Apps Script setup (separate, private environment)

1. Create a Google Form response Sheet and open its spreadsheet-bound Apps Script project.
2. Copy the generated files from `dist/` into the corresponding Apps Script files, or configure `clasp` locally using a **private** `.clasp.json` created from `.clasp.json.example`.
3. Configure the private script properties described in [`docs/SETUP.md`](docs/SETUP.md). Never put their values in GitHub, GitHub Actions logs, or source files.
4. Create the required Notion data source schemas and grant the private Notion integration access.
5. Test intake and Calendar Dry Run first. For a **new installation**, do not enable automatic writes until baseline, registry, and the first controlled write have been validated against your own Notion workspace.
6. Only after that, install the appropriate trigger with the existing install functions. Apps Script time-based triggers do **not** require a Web App deployment.

**Important:** Installing this open-source example does not affect any existing Apps Script deployment. The project's currently active time-driven triggers are managed in that private Apps Script account, not from this repository.

## Safe-write strategy and limitations

- The baseline marks calendar events already present before auto-create was enabled. It is not a migration tool and does not retroactively link existing Notion booking pages.
- A `Calendar Event Key` (calendar ID plus event ID) is stored in Notion for created bookings.
- The registry marks uncertain writes for manual verification rather than retrying them blindly.
- New bookings start with the conservative status `Inquiry`, even if the calendar item appears confirmed.
- The project does not update or delete existing Notion bookings, automatically change canceled status, or calculate earnings.
- Booking matching is conservative: identical dog names, abbreviated owner names, overlapping stays, and uncertain requests can require review.
- Provider metadata, especially imported iCal timestamps, may differ from editable Calendar events. Test against your own calendar before using production data.
- This sample does not contain end-to-end integration tests of a live Notion create; unit tests and syntax checks alone are not proof of production correctness.

## Privacy & publication checklist

See [`docs/SECURITY.md`](docs/SECURITY.md). Run `npm run privacy:check` before publishing. This is a heuristic pre-commit scan, not a comprehensive secret scanner. Inspect **all Git commits and tags**, not merely the latest files, before making any repository public.

## Repository contents

- `src/Code.js` — intake automation
- `src/CalendarSync.js` — booking dry run / baseline / safe-write logic
- `src/CalendarTriggerMonitor.js` — monitoring trigger installer
- `src/CalendarTriggerAuto.js` — auto-sync trigger installer and emergency disable
- `tests/` — fabricated test cases and fixtures
- `scripts/` — local build and privacy checks
- `docs/` — setup, security, architecture and rollout
- `.github/workflows/ci.yml` — test and privacy checks on PRs and pushes

## License

MIT. This project is an illustrative workflow, not an officially maintained Rover, Notion, or Google integration.
