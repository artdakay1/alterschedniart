# AlterSched Ni Art — System Overview & Architecture Report

> **Generated:** October 2026  
> **Platform:** Consolidated College of Tacurong (CCTC) — College of Computer Studies (CCS)  
> **Repository:** `alterschedniart`  
> **Status:** Production-Ready & Cleaned

---

## 1. Executive Summary

**AlterSched** is an enterprise-grade academic timetabling and schedule alteration management system designed specifically for the College of Computer Studies at Consolidated College of Tacurong (CCTC). 

The platform automates the generation, conflict checking, publishing, and real-time alteration of semester class schedules. It combines a pure TypeScript rule-based **Conflict Engine**, an **AI Automated Timetable Generator** (leveraging Google Gemini with heuristic fallback), and a **Real-Time Alteration Workflow** with role-based access control and public QR-accessible views.

---

## 2. Technology Stack & Key Libraries

| Layer | Technology / Library | Description |
| :--- | :--- | :--- |
| **Framework** | **Next.js 16.3.6 (App Router)** | Modern server-first React 19 architecture with streaming and Turbopack. |
| **Language** | **TypeScript (Strict Mode)** | End-to-end typed contracts across database, API routes, and UI components. |
| **Database & Auth** | **Supabase (PostgreSQL 15+)** | Cloud database with Row-Level Security (RLS), custom triggers, and Auth. |
| **AI Integration** | **Google Gemini (`@google/genai`)** | AI timetable generation guided by strict institutional constraints. |
| **Validation** | **Zod v3** | Strict schema validation for AI payloads and API inputs. |
| **UI & Styling** | **Vanilla CSS + CSS Modules** | Bespoke design system with CCTC/CCS brand identity, dark mode & glassmorphism. |
| **Icons** | **Lucide React** | Lightweight, clean iconography for operational dashboards. |
| **Testing** | **Node.js Native Test Runner** | 37 tests covering hard/soft rules, grid validation, and alteration gates. |

---

## 3. System Architecture & Directory Structure

```
d:/alterschedniart/
├── public/                       # Static public assets (CCTC & CCS logos, icons)
│   └── images/                   # altersched-logo.png, ccs-logo.png, cctc-logo.png
├── src/
│   ├── app/                      # Next.js 16 App Router hierarchy
│   │   ├── (auth)/               # Login & authentication routes
│   │   ├── (dashboard)/          # Role-based dashboard redirector
│   │   ├── actions/              # Server Actions for profile & account management
│   │   ├── admin/                # Administrator management portals
│   │   │   ├── academic-years/   # Term & semester cycle configuration
│   │   │   ├── alterations/      # Alteration approvals & conflict audit
│   │   │   ├── curricula/        # Curriculum & course mapping
│   │   │   ├── departments/      # College department settings
│   │   │   ├── instructors/      # Faculty roster & availability management
│   │   │   ├── rooms/            # Room directory, capacities & equipment
│   │   │   ├── sections/         # Student cohorts & block sections
│   │   │   ├── subjects/         # Course directory & BSIT Major categorization
│   │   │   └── users/            # System user accounts & role provisioning
│   │   ├── instructor/           # Faculty portal: timetable, availability, alteration requests
│   │   ├── s/                    # Public / QR schedule viewing portal
│   │   ├── scheduler/            # Timetable workbench, AI generation & publish gates
│   │   └── api/                  # REST endpoints for conflict preview, publish, and AI
│   ├── components/               # Reusable UI components (Modals, Tables, Forms, Grids)
│   ├── data/                     # Curriculum and subject category configurations
│   ├── lib/
│   │   ├── academic/             # Curriculum connectors & year-level utilities
│   │   ├── ai/                   # Gemini AI prompt engine, policies & heuristic fallback
│   │   ├── alterations/          # Alteration lifecycle, conflict preview & approvals
│   │   ├── conflict-engine/      # 10 Hard rules, 4 Soft rules, timetable grid engine
│   │   ├── publish/              # Pre-publish conflict validation gate
│   │   └── supabase/             # Server/client/admin Supabase database clients
│   ├── proxy.ts                  # Next.js 16 Edge proxy for session refreshes and route guards
│   └── types/                    # Shared database and business entity TypeScript types
├── supabase/
│   └── migrations/               # PostgreSQL DDL migrations, RLS policies & triggers
└── scripts/                      # Automated verification and seeding scripts
```

---

## 4. Database Schema & Data Models

The database runs on PostgreSQL via Supabase, with Row Level Security (RLS) enforcing strict tenant isolation:

1. **`profiles`**: User records linked to Supabase Auth (`admin`, `scheduler`, `instructor`).
2. **`academic_years` & `semesters`**: Academic calendar terms (tracks `is_active` term).
3. **`departments` & `curricula`**: Departmental structures and specific curriculum revisions.
4. **`courses` / `subjects`**: Subject catalog (code, title, lecture/lab contact hours, units, category: `BSIT Major` vs `Non-BSIT / Minor`).
5. **`year_levels` & `sections`**: Student year levels (1st–4th year) and sections (e.g. `BSIT 1-A`, `BSIT 3-B`).
6. **`rooms`**: Facilities tagged with type (`lecture`, `laboratory`, `unspecified`), capacity, and equipment tags.
7. **`instructors`**: Faculty members with employment status (`full-time`, `part-time`), maximum load units, preferred rooms, and weekly available time windows.
8. **`class_offerings`**: Bridge between sections, subjects, assigned instructors, and terms.
9. **`timetable_entries`**: Scheduled time slots with `day_of_week`, `start_time`, `end_time`, `room_id`, `instructor_id`, `offering_id`, and status (`draft`, `published`).
10. **`alteration_requests`**: Faculty-submitted adjustments (makeup classes, room changes, time swaps) tracked through states (`pending`, `approved`, `rejected`, `cancelled`).
11. **`notifications`**: In-app alerts for alteration outcomes and schedule updates.

---

## 5. Conflict Engine & CCTC Scheduling Policies

The Conflict Engine (`src/lib/conflict-engine/`) guarantees zero-conflict timetables through two levels of scrutiny:

### 5.1 Canonical Timetable Grid
- **Canonical Start Times**: Every entry must start at: `8:00 AM`, `9:30 AM`, `11:00 AM`, `1:00 PM`, `2:30 PM`, `4:00 PM`, `5:30 PM`, or `7:00 PM`.
- **Operating Days**: Monday through Saturday. Sunday sessions are strictly disallowed. All days (including Saturday) strictly observe the standard 1.5-hour slot grid.
- **Lunch Break Protection**: No session may span across `12:30 PM – 1:00 PM`. A 3-hour laboratory crossing midday must be split into two distinct periods (e.g., morning lecture + afternoon lab).

### 5.2 Hard Rules (Violations Block Publishing & Alterations)
1. **`double_booked_instructor`**: An instructor cannot be assigned to more than one session at the same time.
2. **`double_booked_room`**: A physical room cannot host multiple classes simultaneously (*exempts subjects with unspecified room requirements / `room_id: null`*).
3. **`double_booked_section`**: A student cohort section cannot have overlapping classes.
4. **`room_capacity_exceeded`**: Section student count cannot exceed room capacity.
5. **`outside_availability`**: Sessions cannot be scheduled outside an instructor's declared availability.
6. **`missing_room_equipment`**: Specialized classes (e.g. programming labs) must be assigned to rooms with matching equipment.
7. **`duplicate_subject_in_block`**: A section cannot have the same subject assigned multiple times in a semester.
8. **`incomplete_hours`**: Scheduled duration must match curriculum requirements.
9. **`invalid_time_slot`**: Sessions must align to the canonical start times and 1.5h duration multiples.
10. **`spans_lunch_break`**: Rejects any entry spanning across the 12:30 PM – 1:00 PM window.

### 5.3 Soft Rules (Advisories for Schedulers)
1. **`irregular_day_pairing`**: Standard lectures should follow Monday/Wednesday or Tuesday/Thursday pairings. (Friday, Saturday, capstone, and labs are exempt).
2. **`lab_room_underused`**: Flags when a general lecture without computer needs occupies a computer laboratory.
3. **`heavy_load_day`**: Advises when an instructor exceeds 6 hours of teaching on a single day.
4. **`unqualified_instructor`**: Advises when an instructor is assigned to a subject outside their primary qualification.

---

## 6. AI Timetable Generator & Heuristic Fallback

Located in `src/lib/ai/draft-pipeline.ts`:
- **Prompt Engineering**: Encapsulates CCTC scheduling policies, offering lists, room directories, instructor availability, and day-pairing rules into a structured Gemini prompt.
- **Structured Output**: Validated against strict Zod schema; entries missing rooms are safely preserved if the course does not mandate a specific room.
- **Quota & Error Resilience**: If the Gemini API hits rate limits (`429`) or network timeouts, the generator automatically switches to a deterministic **Constraint-Satisfaction Heuristic Solver**, ensuring the scheduler can always generate a complete timetable draft.
- **Smart Splitting**: Automatically places 3-contact-hour lectures across balanced MW / TTH 1.5-hour pairs and schedules continuous lab blocks on appropriate days.

---

## 7. Subject Categorization (CCTC Class-Program Standard)

Following CCTC's `Class-Program-for-BSIT-2627.pdf` curriculum standard:
- **BSIT Major Subjects**: Programming languages, Object-Oriented Programming, Data Structures & Algorithms, Database Systems, Web Systems & Technologies, Networking, Systems Integration, Capstone Projects, and Platform Technologies.
- **Non-BSIT / Minor Subjects**: General Education (Ethics, Art Appreciation, Purposive Communication, Living in the IT Era, Technopreneurship, Physical Education, NSTP).
- **Room Allocation Rule**: Minor / Non-BSIT subjects are automatically routed to standard lecture rooms or left as unspecified room requirements, preserving computer laboratories exclusively for BSIT technical hands-on courses.

---

## 8. Summary of Recent Cleanups & Optimization

During the latest codebase analysis, the following code cleanups and enhancements were completed:

1. **Dead Assets Removal**:
   - Removed unused default Next.js SVGs from `public/` (`file.svg`, `globe.svg`, `next.svg`, `vercel.svg`, `window.svg`).
   - Verified active branding assets in `public/images/` (`altersched-logo.png`, `ccs-logo.png`, `cctc-logo.png`).
2. **Redundant Database Queries Removed**:
   - Cleaned up redundant `class_offerings` queries in `src/lib/publish/publish-gate.ts` and `src/lib/alterations/preview.ts` where joined timetable records already contained offering data.
3. **Unused Imports & Types Cleaned**:
   - Cleaned unused imports in `src/lib/ai/types.ts` (`RoomInfo`, `InstructorInfo`).
   - Removed unused import in `src/lib/alterations/alteration-service.ts` (`AlterationPreviewResult`).
   - Cleaned duplicate import in `src/lib/conflict-engine/index.ts` (`MAX_DAILY_HOURS`).
   - Cleaned unused imports and fixed variable destructuring in `src/lib/ai/draft-pipeline.ts` (`created_by_ai: _`).
4. **Component & Action Robustness**:
   - Updated `src/components/DataTable.tsx` to properly render optional `title` and `description` headers.
   - Enhanced `src/app/admin/subjects/SubjectsClient.tsx` with safe optional chaining on subject category lookups.
5. **Conflict Engine Room Availability Fix**:
   - Updated room conflict detection so that subjects with `room_id === null` or unspecified facility requirements are not falsely flagged with room availability conflicts.
6. **Test & Build Verification**:
   - **Test Suite**: 37 unit tests across 17 suites passing with 100% success rate.
   - **Phase Verification**: Phase 4 validation script passes with 0 hard violations.
   - **Next.js Production Build**: Compiles cleanly with Turbopack and zero TypeScript errors.

---

## 9. Operational Guides for Roles

- **Admin**: Has full access to manage faculty, rooms, curricula, user accounts, and final approvals for schedule alterations.
- **Scheduler**: Has access to the Timetable Workbench, AI Draft Generator, Conflict Inspector, and the Pre-Publish Validation Gate.
- **Instructor**: Views their personalized schedule, submits alteration requests (with instant conflict preview), and sets their availability preferences.
- **Student / Public**: Can access real-time published timetables via section or room QR codes without requiring login credentials (`/s/[code]`).
