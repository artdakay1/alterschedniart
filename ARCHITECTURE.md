# AlterSched System Architecture & Block Diagram

This document outlines the high-level system architecture, block diagram, component decomposition, and data flow for **AlterSched**, an academic scheduling and resource management system tailored for collegiate and departmental scheduling.

---

## 1. System Architecture Block Diagram

```mermaid
flowchart TB
    %% User Personas & Clients
    subgraph Clients ["Client Layer (Presentation Tier)"]
        direction TB
        AdminUser["Administrator\n(Desktop Browser)"]
        SchedulerUser["Department Scheduler\n(Desktop Browser)"]
        InstructorUser["Faculty Instructor\n(Mobile / Desktop)"]
        StudentGuest["Student / Public Guest\n(Mobile QR Scanner)"]
    end

    %% Frontend Application Layer
    subgraph Frontend ["Frontend Tier (Next.js 16 App Router)"]
        direction TB
        UI_Shell["App Shell & Navigation\n(RoleNav, Sidebar, Responsive Layout)"]
        UI_SchedGrid["Schedule Views\n(Weekly Time Grid, Master Spreadsheet,\nRadial Time Picker, Drag & Drop)"]
        UI_AdminPortal["Admin Console\n(Rooms, Subjects, Blocks, Faculty, Terms)"]
        UI_InstructorPortal["Instructor Portal\n(Availability Matrix, Alteration Requests)"]
        UI_PublicQR["Public Schedule Viewer\n(/schedule/public/[token])"]
    end

    %% Backend Application Layer
    subgraph Backend ["Backend Tier (Next.js Server Runtime & Business Logic)"]
        direction TB
        AuthMiddleware["Auth & Route Guard\n(Next.js Proxy, Session Validation, RLS Scope)"]
        ServerActions["Server Actions & API Handlers\n(Mutation Handlers, Zod Input Validation)"]
        
        subgraph CoreEngines ["Core Business Logic Engines"]
            ConflictEngine["Deterministic Conflict Engine\n(16 Hard/Soft Rules, Room/Teacher Clashes,\nMW/TTH Pairing, Canonical Slots, Lunch Break)"]
            PublishGate["Publish Gate & Validation\n(Completeness Verification, Unplaced Checks)"]
            AlterationService["Alteration Service\n(Proposal Diff, Approval/Rejection Workflow)"]
            HeuristicGenerator["Heuristic Generator\n(Rule-Based Backtracking Algorithm,\nLab Overflow Fallback)"]
        end

        subgraph IntegrationServices ["Integration & Auxiliary Services"]
            QRService["QR Generation Engine\n(qrcode library, Token Cryptography, SVG/DataURL)"]
            EmailService["Email Dispatch Service\n(Resend API / SMTP Transport, Template Engine)"]
            GeminiClient["Gemini AI Client\n(gemini-3.5-flash / flash-lite API Connector,\nStructured JSON Schema Prompting)"]
        end
    end

    %% External Services
    subgraph ExternalServices ["External Services & APIs"]
        GeminiAPI["Google Generative AI\n(Gemini 3.5 Flash REST API)"]
        ResendAPI["Email Provider\n(Resend API / SMTP Relay)"]
    end

    %% Database & Persistence Layer
    subgraph DatabaseLayer ["Data Tier (Supabase PostgreSQL & GoTrue)"]
        direction TB
        GoTrue["Supabase Auth (GoTrue)\n(JWT Tokens, Role Claims, User Sessions)"]
        
        subgraph PostgresTables ["PostgreSQL Relational Tables (Row-Level Security Enabled)"]
            direction TB
            Users_DB[("profiles\ninstructors")]
            Academic_DB[("academic_terms\nprograms\nblocks\nsubjects")]
            Facilities_DB[("rooms\nfixed_constraints")]
            Scheduling_DB[("class_offerings\nschedule_versions\nschedule_entries")]
            Alteration_DB[("alteration_requests\naudit_log\nnotifications\nqr_tokens")]
        end

        DB_Triggers["Triggers & Constraints\n(Role Escalation Guard, Audit Logging,\nSingle Current Term Constraint)"]
    end

    %% Connections
    AdminUser --> UI_AdminPortal
    SchedulerUser --> UI_SchedGrid
    InstructorUser --> UI_InstructorPortal
    StudentGuest --> UI_PublicQR

    UI_AdminPortal --> UI_Shell
    UI_SchedGrid --> UI_Shell
    UI_InstructorPortal --> UI_Shell
    UI_PublicQR --> UI_Shell

    UI_Shell --> AuthMiddleware
    AuthMiddleware --> ServerActions

    ServerActions --> CoreEngines
    ServerActions --> IntegrationServices

    CoreEngines --> ConflictEngine
    HeuristicGenerator --> ConflictEngine
    PublishGate --> ConflictEngine
    AlterationService --> ConflictEngine

    IntegrationServices --> QRService
    IntegrationServices --> EmailService
    IntegrationServices --> GeminiClient

    GeminiClient -->|"HTTPS / REST (API Key Protected)"| GeminiAPI
    EmailService -->|"HTTPS REST / TLS"| ResendAPI

    AuthMiddleware -->|"Validate Session"| GoTrue
    ServerActions -->|"Postgres Client (Anon / Service Role Key)"| PostgresTables
    PostgresTables --> DB_Triggers
    QRService -->|"Store & Validate Tokens"| Alteration_DB
    EmailService -->|"Query Recipient Emails"| Users_DB
```

---

## 2. Component Decomposition

### A. Frontend Layer (Next.js 16 App Router)
- **Framework & Libraries**: Next.js 16 (React 19, TypeScript Strict Mode), Tailwind CSS, Vanilla CSS styling tokens, Bootstrap Icons.
- **Key Modules**:
  - **Weekly Schedule Grid & Spreadsheet View**: Interactive matrix displaying academic sessions by timeslots and day pairings (MW, TTH, Single Day).
  - **Radial Time Picker**: Circular analog-style clock face with strictly predetermined `:00` / `:30` minute pills and automatic course duration calculations.
  - **Conflict & Advisory Badges**: Real-time visual warnings for room clashes, faculty double-booking, and irregular day pairings.
  - **Public Schedule View**: Read-only, responsive timetable screen accessible via scanned QR codes without requiring login credentials.

### B. Backend Layer (Server Actions & Domain Engines)
- **Server Runtime**: Node.js Next.js Server Actions with Zod schema validation and role-based authorization guards.
- **Deterministic Conflict Engine (`src/lib/conflict-engine`)**:
  - Independent, deterministic verification engine evaluating 16 hard and soft constraints.
  - Enforces canonical slot alignment (`08:00`, `09:30`, `11:00`, `13:00`, `14:30`, `16:00`, `17:30`, `19:00`), lunch clearance (`12:30–13:00`), faculty availability, and room capacity.
- **Heuristic Schedule Generator (`src/lib/ai/gemini-client.ts`)**:
  - Algorithmic scheduler using priority heuristics, course unit splits (1.5h Lec + 1.5h Lab), canonical day pairs (Monday/Wednesday, Tuesday/Thursday), and automatic **computer laboratory overflow fallback** when standard lecture rooms are fully occupied.
- **Publish Gate**:
  - Guard preventing publication of incomplete or conflicting drafts.
- **Alteration Service**:
  - Manages schedule change requests submitted by instructors with impact preview, approval/rejection pipelines, and audit trails.

### C. External Integrations
1. **Google Gemini Flash API (`gemini-3.5-flash` / `gemini-3.5-flash-lite`)**:
   - Used for optional AI-assisted schedule adjustments and human-language constraint refinement.
   - Secure server-to-server HTTPS communication using server-side environment variables (`GEMINI_API_KEY`).
2. **Email Notification Service (`Resend API / SMTP Transport`)**:
   - Dispatches transactional emails to faculty members upon schedule publication or alteration resolution.
3. **QR Code Engine (`qrcode`)**:
   - Generates cryptographically unguessable tokens (`qr_tokens` table) and renders QR codes (Data URL / SVG) for student blocks.

### D. Data Tier (Supabase PostgreSQL)
- **Supabase PostgreSQL 15+**:
  - 17 relational tables organized with foreign keys, composite indexes, and strict cascade rules.
  - Row-Level Security (RLS) active across all tables.
  - Database triggers preventing unauthorized role elevation and enforcing term uniqueness.
- **Supabase GoTrue**:
  - Handles secure password hashing, session tokens, JWT claims, and authentication state.

---

## 3. Data Flow

```mermaid
sequenceDiagram
    autonumber
    actor Scheduler as Scheduler / Admin
    participant Client as Next.js Client (UI)
    participant Server as Next.js Server Actions
    participant Engine as Conflict Engine
    participant Gemini as Google Gemini Flash API
    participant DB as Supabase PostgreSQL
    participant Email as Email Service (Resend)
    participant QR as QR Generator
    actor Faculty as Faculty / Instructor
    actor Student as Student (Public)

    %% Scenario 1: Generating and Adjusting Schedule
    rect rgb(240, 248, 255)
        note over Scheduler, Gemini: 1. Schedule Generation & AI Adjustment
        Scheduler->>Client: Click "Generate Schedule" or request AI adjustment
        Client->>Server: invoke generateDraftAction() / aiAdjustAction()
        Server->>DB: Fetch offerings, rooms, instructors, availability, constraints
        DB-->>Server: Return academic context data
        alt Algorithmic Generation
            Server->>Engine: Run heuristic placement with lab overflow fallback
            Engine-->>Server: Draft schedule entries (0 hard conflicts)
        else AI Refinement Mode
            Server->>Gemini: POST /models/gemini-3.5-flash:generateContent (Prompt + Context)
            Gemini-->>Server: Structured JSON proposed schedule
            Server->>Engine: Validate proposed entries against 16 rules
        end
        Server->>DB: Save entries to schedule_entries table under draft version
        Server-->>Client: Updated schedule draft loaded into UI
    end

    %% Scenario 2: Publishing & QR Token Generation
    rect rgb(245, 255, 245)
        note over Scheduler, Email: 2. Publish Schedule, Email Dispatch & QR Generation
        Scheduler->>Client: Click "Publish Schedule Version"
        Client->>Server: invoke publishScheduleVersionAction(versionId)
        Server->>Engine: Validate entire version via Publish Gate
        Engine-->>Server: 0 hard conflicts, 100% curriculum completion verified
        Server->>DB: Update version status to "published"
        Server->>QR: Generate secure tokens & QR code URLs for each block
        QR->>DB: Store in qr_tokens table
        Server->>Email: Send schedule publication notifications to assigned instructors
        Email-->>Faculty: Deliver transactional email with teaching schedule details
        Server-->>Client: Publish success with downloadable QR badges
    end

    %% Scenario 3: Public QR Schedule Lookup
    rect rgb(255, 250, 240)
        note over Student, DB: 3. Public Student Schedule Lookup
        Student->>Client: Scan QR Code -> Open /schedule/public/[token]
        Client->>Server: Query timetable for token
        Server->>DB: Query qr_tokens & fetch active published schedule entries
        DB-->>Server: Return published block schedule
        Server-->>Client: Render mobile-friendly class timetable (No login required)
    end
```

### End-to-End Data Flow Description
When a scheduler initiates timetable drafting, Next.js Server Actions retrieve academic offerings, instructor availability matrix records, room specifications, and existing blackout constraints from Supabase PostgreSQL. The backend executes the deterministic heuristic algorithm—placing classes according to collegiate MW / TTH day-pairing conventions and invoking computer lab overflow when lecture rooms are saturated—or alternatively invokes the Google Gemini Flash REST API with strict JSON schema prompts for natural-language schedule adjustments. All output entries are validated in memory by the Conflict Engine against 16 hard and soft constraint rules before being written to PostgreSQL under a draft `schedule_version`. Once validated and approved through the Publish Gate, the system transitions the version status to `published`, triggers the QR Generation service to create unguessable block lookup tokens in the `qr_tokens` table, and dispatches email notifications to all assigned faculty members via the Resend API. Students and guests scan the generated QR codes to access the read-only public schedule view (`/schedule/public/[token]`), where the server resolves the token against the active published schedule and renders the clean timetable without exposing administrative credentials.
