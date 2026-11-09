# Privacy and security

This public example **must not** include real owners, dogs, bookings, care questionnaires, allergies, contact details, personal calendar events, API keys, authentication tokens, Notion page/data-source identifiers, Google Sheet IDs, private iCal URLs, or script deployment bindings.

The scripts use `PropertiesService.getScriptProperties()` for credentials and data source IDs. They intentionally avoid logging raw API response bodies containing customer data. Hidden Sheets and real Event Keys are operationally sensitive even though they are not OAuth secrets.

Safe files: source, README, documentation, `.env.example`, `.clasp.json.example`, synthetic tests. Unsafe files: `.clasp.json`, real Script Properties exports, Google Sheets exports, screenshots, screenshots of customer chats, raw Apps Script logs, and any private `.csv` data.

### Before publishing

1. Run `npm run verify` and inspect output.
2. Review staged files with `git diff --cached --name-only` and `git diff --cached`.
3. Check Git history and tags with an established secret scanner such as Gitleaks; `.gitignore` does **not** erase secrets already committed.
4. If a real secret was ever checked into a repository, revoke/rotate the secret and remove the affected Git history before public publication.
5. Keep real Customer Alias and Registry sheets out of the repository, including screenshots and test fixtures.

`npm run privacy:check` is a heuristic check, not a security audit. Public GitHub Actions should not be configured with production Notion secrets or calendars.
