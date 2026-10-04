# AlterSched — Academic Scheduling System (BSIT Department)

AlterSched is an academic scheduling and resource management web application designed for a Bachelor of Science in Information Technology (BSIT) department.

This repository represents the **Phase 0 Foundation**, providing:
- Clean Next.js 16 (App Router) + TypeScript + Tailwind CSS structure
- Supabase Postgres schema with 17 departmental tables and Row Level Security (RLS) enabled across all tables
- Departmental roles: `admin`, `scheduler`, and `instructor`
- Shared login portal with account status verification (`active`, `pending`, `rejected`, `disabled`)
- Instructor self-registration with automatic `pending` status enforcement via a database trigger that rejects client role escalation
- Comprehensive database migrations, relational constraints, foreign keys, and seed data
- Next.js session management and route protection proxy

---

## Tech Stack

- **Framework**: [Next.js](https://nextjs.org/) (App Router, Turbopack, `src/` directory)
- **Language**: TypeScript (Strict mode enabled, zero `any`)
- **Styling**: Tailwind CSS
- **Backend / Database / Auth**: [Supabase](https://supabase.com/) (PostgreSQL + GoTrue Auth) via `@supabase/supabase-js` and `@supabase/ssr`
- **Validation**: [Zod](https://zod.dev/)
- **Package Manager**: `npm`
- **Database Tooling**: Supabase CLI

---

## Project Structure

```text
├── scripts/
│   └── seed-users.mjs               # Admin API script to seed auth accounts using Service Role Key
├── src/
│   ├── app/
│   │   ├── (auth)/
│   │   │   ├── layout.tsx           # Shared authentication layout
│   │   │   ├── login/page.tsx       # Shared login page (status-aware)
│   │   │   └── register/page.tsx    # Instructor registration (Zod validated)
│   │   ├── (dashboard)/
│   │   │   ├── layout.tsx           # Dashboard shell
│   │   │   └── dashboard/page.tsx   # Authenticated dashboard landing placeholder
│   │   ├── globals.css              # Global styles and Tailwind configuration
│   │   ├── layout.tsx               # Root application layout & metadata
│   │   └── page.tsx                 # Root router (redirects to /dashboard)
│   ├── components/
│   │   └── LogoutButton.tsx         # Client logout component
│   ├── lib/
│   │   ├── supabase/
│   │   │   ├── client.ts            # Client-side Supabase browser client (Anon key)
│   │   │   ├── server.ts            # Server Component & Server Action client
│   │   │   ├── middleware.ts        # Session refresh & route guard helper
│   │   │   └── admin.ts             # Server-only client (Service role key, browser-guarded)
│   │   └── validators/
│   │       └── auth.ts              # Zod validation schemas for login and registration
│   ├── types/
│   │   ├── database.ts              # Hand-crafted strict database schema types
│   │   └── index.ts                 # Exported types
│   └── proxy.ts                     # Next.js 16 Proxy (Middleware) session & route guard
├── supabase/
│   ├── config.toml                  # Supabase CLI configuration
│   ├── migrations/                  # Structured SQL migrations
│   │   ├── 20260928000001_core_types_and_helpers.sql
│   │   ├── 20260928000002_profiles_and_auth_trigger.sql
│   │   ├── 20260928000003_academic_curriculum_and_facilities.sql
│   │   ├── 20260928000004_instructors_and_constraints.sql
│   │   ├── 20260928000005_scheduling_and_offerings.sql
│   │   └── 20260928000006_requests_audit_notifications_qr.sql
│   └── seed.sql                     # Complete departmental seed data (users + academic data)
├── .env.example                     # Environment template
├── .gitignore                       # Ensures .env.local is ignored and .env.example tracked
├── package.json
└── tsconfig.json
```

---

## Database Tables & RLS Status

All 17 tables are protected by PostgreSQL **Row Level Security (RLS)**:

| Table | Purpose | RLS Status |
| :--- | :--- | :---: |
| `profiles` | User profile, role (`admin`, `scheduler`, `instructor`), and status | **Enabled** (Self-read, Admin-read/write) |
| `academic_terms` | School years, semesters, active term flag | **Enabled** (Locked down; Phase 1 policies pending) |
| `programs` | Academic programs (BSIT) | **Enabled** (Locked down; Phase 1 policies pending) |
| `blocks` | Student sections by program and year level | **Enabled** (Locked down; Phase 1 policies pending) |
| `subjects` | Subjects, unit counts, lecture/lab hour breakdown | **Enabled** (Locked down; Phase 1 policies pending) |
| `rooms` | Facilities, room types (`lecture`, `laboratory`), capacities, sharing flag | **Enabled** (Locked down; Phase 1 policies pending) |
| `instructors` | Department instructors, employment types, equipment needs | **Enabled** (Locked down; Phase 1 policies pending) |
| `instructor_qualifications` | Instructor subject teaching qualifications | **Enabled** (Locked down; Phase 1 policies pending) |
| `instructor_availability` | Weekly day/time teaching availability slots | **Enabled** (Locked down; Phase 1 policies pending) |
| `class_offerings` | Term course offerings mapped to student blocks | **Enabled** (Locked down; Phase 1 policies pending) |
| `schedule_versions` | Versioned schedule states (`draft`, `published`, `archived`) | **Enabled** (Locked down; Phase 1 policies pending) |
| `schedule_entries` | Scheduled meetings (version, offering, instructor, room, time) | **Enabled** (Locked down; Phase 1 policies pending) |
| `fixed_constraints` | External constraints (High school, Non-BSIT department blocks) | **Enabled** (Locked down; Phase 1 policies pending) |
| `alteration_requests` | Instructor schedule modification requests | **Enabled** (Locked down; Phase 1 policies pending) |
| `audit_log` | Immutable record of scheduling modifications | **Enabled** (Locked down; Phase 1 policies pending) |
| `notifications` | System notifications for schedule alterations and approvals | **Enabled** (Locked down; Phase 1 policies pending) |
| `qr_tokens` | Unguessable tokens for block schedule QR code lookups | **Enabled** (Locked down; Phase 1 policies pending) |

---

## Setup & Local Development

### 1. Prerequisites
- **Node.js**: v18.0.0 or higher (v22+ recommended)
- **npm**: v9.0.0 or higher
- **Docker Desktop**: Required if running local Supabase via the Supabase CLI (`supabase start`)

### 2. Installation
Clone the repository and install dependencies:
```bash
npm install
```

### 3. Environment Configuration
Copy `.env.example` to `.env.local`:
```bash
cp .env.example .env.local
```
Fill in the values in `.env.local`:
```env
NEXT_PUBLIC_SUPABASE_URL=http://127.0.0.1:54321
NEXT_PUBLIC_SUPABASE_ANON_KEY=your-supabase-anon-key
SUPABASE_SERVICE_ROLE_KEY=your-supabase-service-role-key
```

> **Security Note:** `SUPABASE_SERVICE_ROLE_KEY` is server-only. It is guarded and will throw a fatal error if executed in client-side code.

### 4. Database Setup & Migrations

#### Option A: Local Supabase CLI (Requires Docker)
```bash
# Start local containers (PostgreSQL, Auth, Storage)
npx supabase start

# Apply all migrations and load supabase/seed.sql
npx supabase db reset
```

#### Option B: Remote / Hosted Supabase Project
1. Link your remote Supabase project:
   ```bash
   npx supabase link --project-ref your-project-ref
   ```
2. Push migrations:
   ```bash
   npx supabase db push
   ```
3. Run the user seed script:
   ```bash
   npm run seed:users
   ```

### 5. Running the Application
Start the development server:
```bash
npm run dev
```
Open [http://localhost:3000](http://localhost:3000) in your browser.

To verify code quality and build:
```bash
# Type check and linting
npm run lint

# Production build verification
npm run build
```

---

## Seed Accounts for Testing

All test accounts share the initial password: `Password123!`

| Role | Email | Status | Login Behavior |
| :--- | :--- | :--- | :--- |
| **Admin** | `admin@altersched.edu` | `active` | Successfully authenticates & enters `/dashboard` |
| **Scheduler** | `scheduler@altersched.edu` | `active` | Successfully authenticates & enters `/dashboard` |
| **Instructor** | `john.doe@altersched.edu` | `active` | Successfully authenticates & enters `/dashboard` |
| **Pending Instructor** | `pending.instructor@altersched.edu` | `pending` | **Rejected at login**: "Your account is pending administrator approval." |

---

## Phase 0 Security & Architectural Invariants

1. **Role Escalation Protection**: The `on_auth_user_created` trigger in PostgreSQL strictly overrides any `role` or `status` attributes supplied during registration. Self-registration is always assigned `role = 'instructor'` and `status = 'pending'`.
2. **Access Control**: Unauthenticated requests to `/dashboard` or `/` are intercepted by the Next.js Proxy/Middleware and redirected to `/login`.
3. **Status Guard**: The login flow inspects the user's `profiles` record. Accounts not in `active` status (`pending`, `rejected`, `disabled`) have their session immediately terminated and receive an informative error notification.
4. **Service Role Isolation**: Server-only operations utilizing `SUPABASE_SERVICE_ROLE_KEY` are isolated in `src/lib/supabase/admin.ts` with explicit browser runtime checks.
