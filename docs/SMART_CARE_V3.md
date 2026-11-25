# Smart Care Card v3 — phase 1

## What is implemented

- `docs/v3.html`: mobile-friendly **demo-only** Today's Pets selector using two fictional entries; date, pet, and care type auto-fill into a PNG card. Meals, Water, Pee, Poop, Activities and notes are entered manually.
- `src/ToolkitReadOnly.js`: private, read-only Apps Script function `toolkitTodayPetsReadOnly(date)` that queries Booking History and Dog Profile in Notion. It filters on exact approved booking statuses and requires a single matching dog relation.

## Not yet connected / not production-ready

The public GitHub Pages demo does **not** access your Notion workspace or Rover bookings. Do not place Notion API credentials, private Google script deployment URLs, owner names, medical notes, or live profile data in GitHub source, public page output, or browser local storage.

The read-only adapter is **source code only** until copied into your private Apps Script environment and tested. Its status allowlist (`Confirmed`, `In Progress`, `Checked In`, `Active`) is a provisional mapping that must be checked against real Notion `Booking Status` options before enabling live reads. Existing created records often begin as `Inquiry`; these are deliberately excluded. Date inclusion rules assume pickup day counts as a care day and need confirmation for all-day Rover events.

## Required before genuine live sync

1. Confirm the real Booking Status values and Notion relation property `🐶 Dog Profile`, `Drop-off`, `Pick-up`, and `Service Type`.
2. Run the read-only function privately in Apps Script with a **test date**; confirm returned matches without logging client records.
3. Choose an **authenticated** backend for the phone: e.g. Google account-gated Apps Script/Cloud Run behind identity-aware authentication, or a separate trusted private operator dashboard. A public anonymous Apps Script `doGet` endpoint is NOT acceptable.
4. Add access control, minimum returned fields, caching safeguards, error handling and audit trail before exposing any live patient/customer data. GitHub Pages remains static; no credentials in the browser.
5. Keep daily care observations unfilled by default. Generating a card never means a care activity occurred.

## Why this is separate

The current production Toolkit lives at `docs/index.html`; this demo is at `docs/v3.html`, avoiding changes to the operational page. Existing Google Apps Script intake and calendar trigger modules have not been modified.
