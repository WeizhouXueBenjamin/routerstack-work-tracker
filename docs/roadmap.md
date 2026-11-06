# Roadmap (proposed, not implemented)

## v0.2.x — stabilise the current Tool

- [x] Extract the V2 single-file HTML into source, styles, vendor and embedded blank template
- [x] Add CI and unit checks for the existing calculation and template agreement
- [x] Document Work Log / Config schema and privacy boundaries
- [ ] Add a reproducible browser test in CI for add → save → reopen → carryover
- [ ] Improve unsaved changes warning and reliable filename/version handling

## Future, only after confirming requirements

- [ ] Confirm RouterStack's actual minimum-hours, after-hours and lunch allocation rules
- [ ] Introduce explicit workbook schema versions and migrations for genuine format changes
- [ ] Consider optional simplified import/export summary for Tim
- [ ] Consider GitHub Pages deployment only with explicit approval and a privacy review

**Non-goals:** automated assumptions about which invoice was paid from a bank total; syncing actual user invoices to GitHub; premature database/backend adoption.
