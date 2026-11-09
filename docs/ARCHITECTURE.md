# Architecture and matching rules

## Intake

The response spreadsheet is the entry point. Intake fields map to individual Notion care properties rather than a single free-form dump. The workflow checks for customer name/phone conflicts, dog-owner relations and repeated response processing. Conflicting identity or care records require review.

## Calendar

A single spreadsheet-bound project reads two private calendar IDs and distinguishes `Rover` vs `Direct` by membership. It parses booking titles, excludes unrelated personal events, and supports both all-day and timed events.

An all-day event's end is **exclusive** in Google Calendar; the booking's last inclusive calendar date is the day before. Timed events are rendered in `America/Los_Angeles`.

The system checks the private Customer Alias table, but only an alias that identifies the specific customer-and-dog relation can be used for matching. A weak first-name match is never sufficient for automatic creation.

## Safe automatic creation

A one-time historical baseline creates `BASELINE` records in a private registry. Every new event is re-evaluated against current Notion records. Matching event keys mean an existing event; matching same-pet dates and overlapping stays are conservatively flagged. An eligible, unambiguous new event creates one Notion Booking History page with source, date, service, pet relation, and key.

The registry uses states including `BASELINE`, `REVIEW`, `PENDING`, `CREATED`, and `WRITE_UNCERTAIN`. `WRITE_UNCERTAIN` never retries automatically. A Script Lock serializes runs. A manual safe-write command exists for controlled validation and must not be installed as a trigger.

## Known boundaries

The baseline captures events in the configured scan window and does not guarantee that all older events outside the window have been migrated. Calendar and Notion are not an atomic transaction. Automatic creation is limited to currently matched existing Dog Profiles; new profiles come from intake. Booking status and earnings are not inferred from calendar presence.
