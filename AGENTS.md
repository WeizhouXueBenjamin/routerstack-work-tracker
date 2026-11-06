# Development instructions for coding assistants

Project: RouterStack Work Tracker. Language: write user-facing guidance/docs in Chinese, preserve English technical identifiers in code.

Priorities: **data integrity > predictable Excel compatibility > ease of entry > styling**.

- Treat uploaded/saved user XLSX as the only authority for actual jobs, dates, invoice IDs, pay, and payment status. Never invent data.
- One job = one invoice ID. A day can have multiple jobs and invoices.
- Estimated / App Displayed / actual bank transfers / confirmed carryover are four different concepts. Never merge them into one number.
- Lunch is a numeric number of hours (blank 0); AH starts at an editable config value. Calculation assumptions remain unverified until user confirms.
- The XLSX data contract is in `docs/architecture.md`. Never reorder sheets or columns without migration + tests.
- Keep the app offline-first; use no API, tracking, remote storage, auto-upload, or mandatory internet dependencies unless approved.
- No real user financial data in the repository. Keep tests synthetic.
- Always run `npm run check` and a browser add → save → reopen → carryover test after changes to parsing/export logic.
- Never assume silent auto-save to XLSX; be clear that work is unsaved until explicit save/download.
- Prefer focused changes over a wholesale rewrite or new framework.
