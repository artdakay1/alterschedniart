// src/lib/ai/scheduling-policy.ts
// Canonical CCTC institutional scheduling policy for AlterSched AI generation.
// This policy is included verbatim in every prompt sent to Gemini Flash.

export const SCHEDULING_POLICY_TEXT = `
=== CCTC SCHEDULING POLICY ===
- All entries must start at one of these times: 8:00, 9:30, 11:00, 1:00, 2:30, 4:00, 5:30, 7:00. Applies every day, including Saturday — no separate Saturday grid.
- No entry may span 12:30 PM–1:00 PM. If a lab needs 3 contact hours crossing that window, split it into two separate entries for the same offering.
- Lecture-type sessions should run on either the Mon/Wed pair or the Tue/Thu pair — never a mixed pairing. Friday and Saturday are reserved for labs, electives, capstone, and online cohorts.
- When possible, keep one instructor's sections in the same room across a day.
- Subjects that are general education or non-programming (e.g. Art Appreciation, Ethics, Living in the IT Era, Technopreneurship, Operating System) should use a Lecture Room, not a computer laboratory, regardless of year level.
==============================
`.trim();

