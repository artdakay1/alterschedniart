// src/lib/ai/scheduling-policy.ts
// Canonical CCTC institutional scheduling policy for AlterSched AI generation.
// This policy is included verbatim in every prompt sent to Gemini Flash.

export const SCHEDULING_POLICY_TEXT = `
=== CCTC SCHEDULING POLICY ===
- All college entries must start at one of these EXACT 24-hour canonical times: 08:00, 09:30, 11:00, 13:00, 14:30, 16:00, 17:30, 19:00. Applies every day, including Saturday — no separate Saturday grid.
- STRICT PROHIBITION: Starting at 10:00, 12:00, 14:00, 15:00, or any off-grid time is STRICTLY FORBIDDEN and causes an instant hard rule failure.
- No entry may span 12:30 PM–1:00 PM (or 12:00 PM–1:00 PM for High School). If a lab needs 3 contact hours crossing that window, split it into two separate entries for the same offering.
- Lecture-type sessions should run on either the Mon/Wed pair (Monday and Wednesday) or the Tue/Thu pair (Tuesday and Thursday) — never a mixed pairing. Friday and Saturday are reserved for labs, electives, capstone, PE, NSTP, and online cohorts.
- PE (Physical Education / PATHFit) and NSTP (ROTC / CWTS) subjects should preferentially be placed on Saturday first, then Friday.
- When possible, keep one instructor's sections in the same room across a day.
- Subjects that are general education or non-programming (e.g. Art Appreciation, Ethics, Living in the IT Era, Technopreneurship, Operating System) should use a Lecture Room, not a computer laboratory, regardless of year level.
==============================
`.trim();

