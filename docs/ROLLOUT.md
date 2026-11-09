# Production rollout checklist

**Do not treat unit tests as a completed live integration test.**

- [ ] Confirm the private Apps Script account can read the intended Rover and Direct calendars.
- [ ] Verify the true full-day vs timed event semantics on representative, non-sensitive bookings.
- [ ] Confirm the private Notion integration can read all three data sources and inspect the actual schema.
- [ ] Reconcile existing bookings or establish and inspect a safe historical baseline before auto-create is enabled.
- [ ] Confirm that 0 existing Notion pages receive accidental writes on first dry run.
- [ ] Verify a controlled, synthetic new booking creates exactly one Notion page.
- [ ] Run again and verify that the same event creates zero additional pages.
- [ ] Confirm a request, unknown owner, unrelated personal event, duplicate event, and ambiguous same-name pet do not auto-create.
- [ ] Review `_Calendar Sync Registry` entries with `REVIEW` or `WRITE_UNCERTAIN`.
- [ ] Confirm `disableCalendarAutoSync()` removes the write trigger and leaves the read-only monitor intact.
- [ ] Keep GitHub and production Apps Script bindings separate; copy production settings only in the private Script Properties UI.
