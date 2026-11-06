# Architecture and data contract

## Why this shape

- **Tool**: `index.html` + `src/app.js` + `src/styles.css`; operational entry point. Only the browser edits user records.
- **Work Log**: `Work Log` sheet inside the XLSX; authoritative saved invoice/work records, one job per invoice.
- **Config**: `Config` sheet inside the XLSX; calculation assumptions and schema marker.
- The workbook's `Tool` sheet is a read-only guide/summary; do not mistake it for the HTML input form.
- **No automatic cloud synchronisation**: edits in the browser need an explicit save/download. Never assume a downloaded workbook is synced to the repo.

## Current workbook contract (v2.x)

Do not change these without coordinated read/write changes, compatibility tests, and an explicit migration plan:

- Three sheets, in order: `Tool`, `Work Log`, `Config`.
- `Work Log` headings at row 5, records at rows 6 through 305 (maximum 300 records per cycle).
- The web app currently accesses the workbook by internal XML paths (`xl/worksheets/sheet2.xml` and `sheet3.xml`). **Changing sheet order breaks the app**, even if display names are unchanged.
- Cell `Work Log!B5` must equal `Invoice ID`; `Work Log!F5` must equal `Billable (AH)`.
- Visible columns: A Date, B Invoice ID, C Time, D Lunch (h), E Rate, F Billable (AH), G Estimated, H App Displayed, I Difference, J Note.
- Helper columns K Start time, L End time, M Record kind (`Job` or `Carryover`), N Extra cost, O Confirmed balance, P Raw hours, Q Billable hours, R AH hours, S Raw AH, T Base estimate. **K:T are hidden**, not redundant; keep them intact.
- `Config!B5` minimum billable hours, `B6` AH start time as Excel day fraction, `B7` AH multiplier, `B8` difference tolerance, `B9` allocation label and `B10` version starting `2.`.
- Workbook templates live at `templates/RouterStack_Tracker_V2_Blank.xlsx` and are embedded into `src/template-data.js` for local `file://` use. Run `npm run template:sync` after editing the template, and `npm run check` before committing.

## Business assumptions (not verified against RouterStack policy)

- Lunch is numeric hours and blank means 0. It is currently deducted from regular time first.
- Estimated values are calculation results, not proof of owed sums.
- App Displayed is user-entered from the app; it is not bank payment proof.
- A positive Difference means expected > app displayed, **not** necessarily unpaid invoice.
- Carryovers require specific invoices and confirmed amounts; do not infer which invoice was omitted from a lump-sum bank transfer.
- Work on two sites on the same day should be separate entries with distinct invoice IDs.
- The app cannot automatically reconcile prior-period Excel files or use bank/account access.

## Rules for future changes

1. Preserve original user-entered records (date/time/invoice/rate/lunch/app/extra/note), and don't invent missing ID or rates.
2. Keep format stable. For any column/schema change, create a new version and a deliberate migration routine, with round-trip tests of an old saved workbook.
3. Add tests for billable/after-hours/lunch/overnight and for Invoice duplicate detection before changing finance logic.
4. Never change calculation assumptions silently. Clearly label unverified rules.
5. The repository must not contain actual records, invoice exports, screenshots of financial data, or bank details.
