# Private installation guide

All example values are placeholders. Store live credentials in **Apps Script → Project Settings → Script properties**, not in the public repository.

## Required properties

| Key | Description |
| --- | --- |
| `NOTION_TOKEN` | Private Notion integration secret |
| `CUSTOMERS_DATA_SOURCE_ID` | Customers data source ID |
| `DOGS_DATA_SOURCE_ID` | Dog Profile data source ID |
| `BOOKINGS_DATA_SOURCE_ID` | Booking History data source ID |
| `FORM_SHEET_NAME` | Form responses tab, e.g. `Form Responses 1` |
| `DRY_RUN` | Intake safety flag; start with `true` |
| `TBL_ROVER_CALENDAR_ID` | Rover subscription calendar ID accessible to the executing account |
| `TBL_DIRECT_CALENDAR_ID` | Separate direct-booking calendar ID, or `primary` when appropriate |

**Do not commit any actual property values.** `.env.example` is a documentation aid only; the scripts read Google Apps Script Script Properties.

## Notion schema overview

Customers: `Name` (title), `Phone` (phone_number), `Communication Preference` (select), and Pet relation.

Dog Profile: `Name` (title), `Dog Parent(s)` (relation), `Intake Status`, and structured rich-text care fields. Refer to `src/Code.js` for the precise question/property mapping.

Booking History: `Name` (title), `🐶 Dog Profile` (relation), `Drop-off`/`Pick-up` (date), `Service Type` (select), `Booking Status` (status), `Calendar Event Key` (rich text/Text), and `Booking Source` (select: `Rover`, `Direct`). Optional `Rover Reviewed` (select with `N/A`) supports direct-booking exclusion from Rover-specific reviews.

## Trigger order

For a new deployment, first run `testConnection()` and `dryRunLatest()`; verify dry-run outputs. Then run `calendarDryRun()` and inspect owner/pet matching. If using auto-create, establish historical baseline with `baselineCalendarBookings()` before any automatic writes; after verifying source calendars and the baseline, run `installCalendarAutoSyncTrigger()` then `checkCalendarAutoSyncTrigger()`. `installCalendarMonitorTrigger()` separately installs hourly read-only reporting.

To stop automatic writes immediately, run `disableCalendarAutoSync()`.

Do **not** commit the hidden `_Customer Aliases`, `_Calendar Sync Registry`, `_Calendar Sync Dry Run`, or `_Intake Sync Log` sheets. Their contents are private operational records.

See `docs/ROLLOUT.md` before production use.
