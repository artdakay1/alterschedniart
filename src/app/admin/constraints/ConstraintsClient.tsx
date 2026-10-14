// src/app/admin/constraints/ConstraintsClient.tsx
'use client';

import React, { useState, useMemo } from 'react';
import Link from 'next/link';

interface ConstraintsClientProps {
  userRole?: 'admin' | 'scheduler';
  isReadOnly?: boolean;
}

type RuleCategory = 'all' | 'hard' | 'soft' | 'grid' | 'exemptions';

interface SystemRule {
  id: string;
  name: string;
  code: string;
  type: 'hard' | 'soft' | 'grid';
  icon: string;
  summary: string;
  condition: string;
  rationale: string;
  enforcement: string;
  exemptions?: string;
  tags: string[];
}

const SYSTEM_RULES: SystemRule[] = [
  // Hard Rules
  {
    id: 'double_booked_instructor',
    name: 'Instructor Overlap',
    code: 'double_booked_instructor / instructor_overlap',
    type: 'hard',
    icon: 'bi-person-x-fill',
    summary: 'An instructor cannot be scheduled to teach two or more sessions simultaneously.',
    condition: 'Occurs when multiple entries sharing the same instructorId overlap in time on the same day of the week.',
    rationale: 'Physical impossibility: A faculty member cannot be present in multiple locations or instruct multiple cohorts at the same instant.',
    enforcement: 'Blocks schedule saving, pre-publish gate, and alteration requests.',
    tags: ['instructor', 'overlap', 'faculty', 'double booking', 'hard'],
  },
  {
    id: 'double_booked_room',
    name: 'Room Facility Collision',
    code: 'double_booked_room / room_overlap',
    type: 'hard',
    icon: 'bi-door-closed-fill',
    summary: 'A physical classroom or computer laboratory cannot host more than one class simultaneously.',
    condition: 'Occurs when multiple schedule entries with the same roomId overlap in time on the same day.',
    rationale: 'Physical room and space allocation prevent simultaneous occupancy by separate course sections.',
    enforcement: 'Blocks schedule saving, pre-publish gate, and alteration requests.',
    exemptions: 'Courses with facilityType === "unspecified" or roomId === null (e.g. PE, off-campus, or unassigned facility subjects) are exempt from room collision checks.',
    tags: ['room', 'facility', 'lab', 'lecture', 'overlap', 'double booking', 'hard'],
  },
  {
    id: 'double_booked_section',
    name: 'Student Cohort Overlap',
    code: 'double_booked_section / block_overlap',
    type: 'hard',
    icon: 'bi-people-fill',
    summary: 'A student block or cohort section cannot have overlapping classes at the same time.',
    condition: 'Occurs when multiple schedule entries for the same student block (e.g. BSIT 1-A) overlap on the same day.',
    rationale: 'Students in a block follow a common curriculum cohort and cannot attend concurrent class periods.',
    enforcement: 'Blocks schedule saving, pre-publish gate, and alteration requests.',
    tags: ['section', 'block', 'cohort', 'students', 'overlap', 'hard'],
  },
  {
    id: 'outside_availability',
    name: 'Outside Instructor Availability',
    code: 'outside_availability',
    type: 'hard',
    icon: 'bi-clock-history',
    summary: 'Sessions cannot be scheduled outside an instructor’s declared weekly availability hours.',
    condition: 'Occurs when an entry is placed on a day or time slot that does not fall within the instructor’s approved weekly availability windows.',
    rationale: 'Protects faculty work-life balance, contractual commitments, and part-time availability contracts.',
    enforcement: 'Blocks pre-publish validation and alteration approvals.',
    tags: ['availability', 'instructor', 'hours', 'preferences', 'hard'],
  },
  {
    id: 'missing_room_equipment',
    name: 'Specialized Facility Equipment',
    code: 'missing_room_equipment',
    type: 'hard',
    icon: 'bi-cpu-fill',
    summary: 'Specialized technical subjects mandating computer laboratories must be assigned to laboratory rooms.',
    condition: 'Occurs when a subject requires specialized lab facilities or an instructor requires lab equipment, but the session is assigned to a standard lecture room.',
    rationale: 'BSIT technical subjects (programming, networking, web systems) require dedicated desktop computers and software setups.',
    enforcement: 'Blocks pre-publish validation.',
    tags: ['equipment', 'laboratory', 'computer lab', 'hardware', 'hard'],
  },
  {
    id: 'duplicate_subject_in_block',
    name: 'Duplicate Subject in Block',
    code: 'duplicate_subject_in_block',
    type: 'hard',
    icon: 'bi-files',
    summary: 'A student section cannot have the same academic subject assigned under multiple distinct course offerings.',
    condition: 'Occurs when two different class offerings for the same subject code are scheduled for the same block section in the same academic term.',
    rationale: 'Students should only take a curriculum course once per semester.',
    enforcement: 'Blocks pre-publish validation.',
    tags: ['duplicate', 'curriculum', 'subject', 'offering', 'hard'],
  },
  {
    id: 'incomplete_hours',
    name: 'Curriculum Contact Hours Mismatch',
    code: 'incomplete_hours',
    type: 'hard',
    icon: 'bi-hourglass-split',
    summary: 'Scheduled duration must match the exact contact hours prescribed by the academic curriculum.',
    condition: 'Occurs when the sum of scheduled minutes for a course offering does not equal (lectureHours + labHours) * 60 minutes.',
    rationale: 'Commission on Higher Education (CHED) and institutional curriculum compliance require exact weekly contact hours.',
    enforcement: 'Blocks pre-publish validation.',
    exemptions: '1-unit and 2-unit subjects require exactly 60 minutes and 120 minutes of weekly instruction, respectively.',
    tags: ['hours', 'contact hours', 'curriculum', 'units', 'hard'],
  },
  {
    id: 'invalid_time_slot',
    name: 'Canonical Grid Alignment',
    code: 'invalid_time_slot',
    type: 'hard',
    icon: 'bi-grid-3x3-gap-fill',
    summary: 'Classes must align to canonical timetable start times and standardized duration increments.',
    condition: 'Occurs when an entry starts at an unauthorized time, ends off-grid, or duration is misaligned.',
    rationale: 'Maintains institutional synchronization across rooms and block cohorts, preventing schedule fragmentation.',
    enforcement: 'Blocks schedule saving, publish gate, and alteration requests.',
    exemptions: '1-unit subjects (60 min) and 2-unit subjects (120 min, such as PE, PATHFit, and NSTP) are fully permitted to use 1-hour and 2-hour continuous blocks on any day from Monday through Saturday.',
    tags: ['grid', 'time slot', 'start time', 'duration', '1.5h', 'pe', '1 unit', '2 units', 'hard'],
  },
  {
    id: 'spans_lunch_break',
    name: 'Institutional Lunch Break Clash',
    code: 'spans_lunch_break',
    type: 'hard',
    icon: 'bi-cup-hot-fill',
    summary: 'No class session may cross or span the institutional lunch break window (12:30 PM – 1:00 PM).',
    condition: 'Occurs when a single entry starts before 12:30 PM and ends after 1:00 PM, or overlaps the midday recess.',
    rationale: 'Ensures dedicated meal and rest periods for both students and faculty across all college departments.',
    enforcement: 'Blocks schedule saving, pre-publish validation, and alteration requests.',
    tags: ['lunch', 'break', 'midday', 'blackout', 'recess', 'hard'],
  },

  // Soft Rules
  {
    id: 'irregular_day_pairing',
    name: 'Lecture Day Pairing Advisory',
    code: 'irregular_day_pairing',
    type: 'soft',
    icon: 'bi-calendar2-range',
    summary: 'Multi-session lecture classes on weekdays should follow the standard MW or TTH pairing convention.',
    condition: 'Advises schedulers when a lecture course scheduled across multiple weekday sessions does not follow Monday & Wednesday (MW) or Tuesday & Thursday (TTH) pairing.',
    rationale: 'Standard collegiate timetabling balances student cognitive load and weekly study patterns evenly across the semester.',
    enforcement: 'Advisory notice only. Does NOT block saving, publishing, or alterations.',
    exemptions: 'Single-session continuous courses (1-unit and 2-unit classes like PE), laboratory sessions, electives, capstones, Friday sessions, and Saturday classes are completely exempt.',
    tags: ['pairing', 'MW', 'TTH', 'day pairing', 'advisory', 'soft'],
  },
  {
    id: 'unqualified_instructor',
    name: 'Subject Qualification Advisory',
    code: 'unqualified_instructor',
    type: 'soft',
    icon: 'bi-award-fill',
    summary: 'Advises when an instructor is assigned to teach a course outside their documented teaching qualifications.',
    condition: 'Flags when instructor.qualifications does not list the assigned subjectId.',
    rationale: 'Ensures academic rigor and accreditation compliance by pairing subjects with specialized subject-matter faculty.',
    enforcement: 'Advisory notice only. Schedulers may proceed if departmental head approval is granted.',
    tags: ['qualification', 'faculty', 'credential', 'advisory', 'soft'],
  },
];

export function ConstraintsClient({ userRole = 'admin', isReadOnly = false }: ConstraintsClientProps) {
  const [selectedCategory, setSelectedCategory] = useState<RuleCategory>('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [expandedRuleId, setExpandedRuleId] = useState<string | null>(null);

  const filteredRules = useMemo(() => {
    return SYSTEM_RULES.filter((rule) => {
      // Category filter
      if (selectedCategory === 'hard' && rule.type !== 'hard') return false;
      if (selectedCategory === 'soft' && rule.type !== 'soft') return false;
      if (selectedCategory === 'exemptions' && !rule.exemptions) return false;
      if (selectedCategory === 'grid' && rule.id !== 'invalid_time_slot' && rule.id !== 'spans_lunch_break') return false;

      // Search query filter
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase();
        const matchesName = rule.name.toLowerCase().includes(q);
        const matchesSummary = rule.summary.toLowerCase().includes(q);
        const matchesCode = rule.code.toLowerCase().includes(q);
        const matchesTags = rule.tags.some((t) => t.toLowerCase().includes(q));
        const matchesExemptions = rule.exemptions?.toLowerCase().includes(q);
        return matchesName || matchesSummary || matchesCode || matchesTags || matchesExemptions;
      }

      return true;
    });
  }, [selectedCategory, searchQuery]);

  const hardCount = SYSTEM_RULES.filter((r) => r.type === 'hard').length;
  const softCount = SYSTEM_RULES.filter((r) => r.type === 'soft').length;

  return (
    <div className="space-y-6">
      {/* Header Banner */}
      <div className="rounded-3xl bg-gradient-to-r from-blue-900 via-indigo-900 to-slate-900 text-white p-6 md:p-8 shadow-xl relative overflow-hidden">
        <div className="relative z-10 max-w-3xl">
          <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-blue-500/20 border border-blue-400/30 text-blue-200 text-xs font-semibold uppercase tracking-wider mb-3">
            <i className="bi bi-shield-lock-fill"></i>
            Deterministic Conflict Engine & Scheduling Architecture
          </div>
          <h1 className="text-2xl md:text-3xl font-extrabold tracking-tight text-white mb-2">
            System Rules & Timetable Constraints
          </h1>
          <p className="text-blue-100/80 text-sm md:text-base leading-relaxed">
            The mathematical and institutional rules governing class timetabling for the College of Computer Studies at CCTC.
            Hard rules guarantee zero-conflict schedules, while soft advisories guide optimal collegiate distribution.
          </p>

          {/* Key Metrics Chips */}
          <div className="flex flex-wrap gap-3 mt-5">
            <div className="flex items-center gap-2.5 px-3.5 py-2 rounded-2xl bg-white/10 backdrop-blur-md border border-white/15 text-xs">
              <span className="w-2.5 h-2.5 rounded-full bg-rose-400 animate-pulse"></span>
              <span className="font-semibold text-white">{hardCount} Hard Rules</span>
              <span className="text-blue-200 text-[11px]">(Blocking)</span>
            </div>
            <div className="flex items-center gap-2.5 px-3.5 py-2 rounded-2xl bg-white/10 backdrop-blur-md border border-white/15 text-xs">
              <span className="w-2.5 h-2.5 rounded-full bg-amber-400"></span>
              <span className="font-semibold text-white">{softCount} Soft Rules</span>
              <span className="text-blue-200 text-[11px]">(Advisory)</span>
            </div>
            <div className="flex items-center gap-2.5 px-3.5 py-2 rounded-2xl bg-white/10 backdrop-blur-md border border-white/15 text-xs">
              <i className="bi bi-calendar-check text-emerald-400"></i>
              <span className="font-semibold text-white">Mon – Sat Grid</span>
              <span className="text-blue-200 text-[11px]">(Sunday Disallowed)</span>
            </div>
            <div className="flex items-center gap-2.5 px-3.5 py-2 rounded-2xl bg-white/10 backdrop-blur-md border border-white/15 text-xs">
              <i className="bi bi-cup-hot text-amber-300"></i>
              <span className="font-semibold text-white">12:30 – 1:00 PM</span>
              <span className="text-blue-200 text-[11px]">(Protected Lunch Break)</span>
            </div>
          </div>
        </div>

        {/* Decorative background geometry */}
        <div className="absolute right-0 top-0 bottom-0 w-1/3 bg-radial from-blue-500/10 to-transparent pointer-events-none"></div>
      </div>

      {/* Policy Update Highlights Card */}
      <div className="rounded-2xl border border-indigo-100 bg-indigo-50/60 p-4 md:p-5 text-indigo-950 shadow-sm">
        <div className="flex items-start gap-3">
          <div className="p-2 rounded-xl bg-indigo-600 text-white shrink-0 mt-0.5">
            <i className="bi bi-info-circle-fill text-lg"></i>
          </div>
          <div className="space-y-1.5 text-xs md:text-sm">
            <h3 className="font-bold text-indigo-900 text-sm md:text-base">
              Recent Institutional Policy Updates (1-Unit & 2-Unit Subject Exemptions)
            </h3>
            <ul className="list-disc pl-4 space-y-1 text-indigo-900/80">
              <li>
                <strong>1-Hour & 2-Hour Subjects Permitted Mon–Sat:</strong> Subjects with 1 unit (1 hour / 60 min) and 2 units (2 hours / 120 min, such as Physical Education, PATHFit, and NSTP) are scheduled as a single continuous session on 1 day. They are <strong>fully accepted on any day Monday through Saturday</strong> (not restricted to Saturday) and are exempt from standard 1.5-hour duration increments.
              </li>
              <li>
                <strong>Removed Daily Load Limit (<code>heavy_load_day</code>):</strong> Instructors are no longer flagged or restricted by the 6-hour daily teaching threshold, providing department schedulers complete flexibility with faculty availability.
              </li>
              <li>
                <strong>Removed Lab Underutilization Notice (<code>lab_room_underused</code>):</strong> Standard non-lab lecture classes are permitted to occupy computer laboratories as regular classroom spaces without triggering system warnings.
              </li>
            </ul>
          </div>
        </div>
      </div>

      {/* Filter Tabs & Search Bar */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-3 pt-2">
        <div className="flex flex-wrap items-center gap-1.5 p-1 rounded-2xl bg-slate-100 border border-slate-200/80 text-xs">
          <button
            onClick={() => setSelectedCategory('all')}
            className={`px-3.5 py-1.5 rounded-xl font-semibold transition-all ${
              selectedCategory === 'all'
                ? 'bg-white text-slate-900 shadow-sm'
                : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            All Rules ({SYSTEM_RULES.length})
          </button>
          <button
            onClick={() => setSelectedCategory('hard')}
            className={`px-3.5 py-1.5 rounded-xl font-semibold transition-all flex items-center gap-1.5 ${
              selectedCategory === 'hard'
                ? 'bg-rose-600 text-white shadow-sm'
                : 'text-slate-600 hover:text-rose-700'
            }`}
          >
            <span className="w-1.5 h-1.5 rounded-full bg-rose-300"></span>
            Hard Rules ({hardCount})
          </button>
          <button
            onClick={() => setSelectedCategory('soft')}
            className={`px-3.5 py-1.5 rounded-xl font-semibold transition-all flex items-center gap-1.5 ${
              selectedCategory === 'soft'
                ? 'bg-amber-500 text-white shadow-sm'
                : 'text-slate-600 hover:text-amber-700'
            }`}
          >
            <span className="w-1.5 h-1.5 rounded-full bg-amber-300"></span>
            Soft Advisories ({softCount})
          </button>
          <button
            onClick={() => setSelectedCategory('grid')}
            className={`px-3.5 py-1.5 rounded-xl font-semibold transition-all flex items-center gap-1.5 ${
              selectedCategory === 'grid'
                ? 'bg-blue-600 text-white shadow-sm'
                : 'text-slate-600 hover:text-blue-700'
            }`}
          >
            <i className="bi bi-grid-3x3"></i>
            Grid & Timeslots
          </button>
          <button
            onClick={() => setSelectedCategory('exemptions')}
            className={`px-3.5 py-1.5 rounded-xl font-semibold transition-all flex items-center gap-1.5 ${
              selectedCategory === 'exemptions'
                ? 'bg-emerald-600 text-white shadow-sm'
                : 'text-slate-600 hover:text-emerald-700'
            }`}
          >
            <i className="bi bi-check2-circle"></i>
            Special Exemptions
          </button>
        </div>

        {/* Search capsule input */}
        <div className="relative min-w-[260px]">
          <i className="bi bi-search absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400 text-xs"></i>
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search rules, codes, keywords..."
            className="w-full pl-9 pr-3 py-2 text-xs rounded-xl border border-slate-200 bg-white text-slate-800 focus:outline-none focus:ring-2 focus:ring-blue-600/20 focus:border-blue-600 transition"
          />
          {searchQuery && (
            <button
              onClick={() => setSearchQuery('')}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 text-xs"
            >
              ✕
            </button>
          )}
        </div>
      </div>

      {/* Rules List Cards */}
      <div className="grid grid-cols-1 gap-4">
        {filteredRules.map((rule) => {
          const isHard = rule.type === 'hard';
          const isExpanded = expandedRuleId === rule.id;

          return (
            <div
              key={rule.id}
              className={`rounded-2xl border transition-all duration-200 ${
                isHard
                  ? 'border-slate-200/90 bg-white hover:border-rose-300 hover:shadow-md'
                  : 'border-slate-200/90 bg-white hover:border-amber-300 hover:shadow-md'
              }`}
            >
              <div className="p-5">
                <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-3">
                  <div className="flex items-start gap-3.5">
                    <div
                      className={`w-10 h-10 rounded-2xl flex items-center justify-center shrink-0 text-lg shadow-sm ${
                        isHard
                          ? 'bg-rose-50 text-rose-600 border border-rose-200/60'
                          : 'bg-amber-50 text-amber-600 border border-amber-200/60'
                      }`}
                    >
                      <i className={`bi ${rule.icon}`}></i>
                    </div>

                    <div>
                      <div className="flex flex-wrap items-center gap-2 mb-1">
                        <h2 className="text-base font-bold text-slate-900">{rule.name}</h2>
                        <span
                          className={`inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[11px] font-bold uppercase tracking-wider ${
                            isHard
                              ? 'bg-rose-100 text-rose-700 border border-rose-200'
                              : 'bg-amber-100 text-amber-700 border border-amber-200'
                          }`}
                        >
                          <span
                            className={`w-1.5 h-1.5 rounded-full ${
                              isHard ? 'bg-rose-600' : 'bg-amber-600'
                            }`}
                          ></span>
                          {isHard ? 'Hard Rule • Blocking' : 'Soft Rule • Advisory'}
                        </span>
                        <code className="text-[11px] font-mono text-slate-500 bg-slate-100 px-2 py-0.5 rounded-md">
                          {rule.code}
                        </code>
                      </div>
                      <p className="text-slate-600 text-xs sm:text-sm leading-relaxed">
                        {rule.summary}
                      </p>
                    </div>
                  </div>

                  <button
                    onClick={() => setExpandedRuleId(isExpanded ? null : rule.id)}
                    className="self-end sm:self-start text-xs font-semibold px-3 py-1.5 rounded-xl border border-slate-200 bg-slate-50 text-slate-700 hover:bg-slate-100 transition shrink-0"
                  >
                    {isExpanded ? 'Hide Details' : 'View Specifications'}
                  </button>
                </div>

                {/* Expanded Details Drawer */}
                {isExpanded && (
                  <div className="mt-4 pt-4 border-t border-slate-100 grid grid-cols-1 md:grid-cols-2 gap-4 text-xs">
                    <div className="space-y-1.5 p-3 rounded-xl bg-slate-50 border border-slate-100">
                      <span className="font-bold text-slate-800 uppercase tracking-wider text-[10px]">
                        Trigger Condition & Logic
                      </span>
                      <p className="text-slate-600 leading-relaxed">{rule.condition}</p>
                    </div>

                    <div className="space-y-1.5 p-3 rounded-xl bg-slate-50 border border-slate-100">
                      <span className="font-bold text-slate-800 uppercase tracking-wider text-[10px]">
                        Academic Rationale
                      </span>
                      <p className="text-slate-600 leading-relaxed">{rule.rationale}</p>
                    </div>

                    <div className="space-y-1.5 p-3 rounded-xl bg-slate-50 border border-slate-100">
                      <span className="font-bold text-slate-800 uppercase tracking-wider text-[10px]">
                        System Enforcement
                      </span>
                      <p className="text-slate-600 leading-relaxed">{rule.enforcement}</p>
                    </div>

                    {rule.exemptions && (
                      <div className="space-y-1.5 p-3 rounded-xl bg-emerald-50/70 border border-emerald-200/60 text-emerald-950">
                        <span className="font-bold text-emerald-800 uppercase tracking-wider text-[10px] flex items-center gap-1">
                          <i className="bi bi-shield-check"></i>
                          Permitted Exceptions & Policies
                        </span>
                        <p className="text-emerald-900 leading-relaxed">{rule.exemptions}</p>
                      </div>
                    )}
                  </div>
                )}
              </div>
            </div>
          );
        })}

        {filteredRules.length === 0 && (
          <div className="p-8 text-center rounded-2xl border border-dashed border-slate-200 bg-slate-50 text-slate-500 text-sm">
            <i className="bi bi-search text-2xl mb-2 block text-slate-400"></i>
            No rules found matching &quot;{searchQuery}&quot;. Try adjusting your search query or category filters.
          </div>
        )}
      </div>

      {/* Canonical Timetable Grid Reference */}
      <div className="rounded-3xl border border-slate-200 bg-white p-6 md:p-8 shadow-sm">
        <div className="flex items-center gap-3 mb-4">
          <div className="w-10 h-10 rounded-2xl bg-blue-50 text-blue-600 border border-blue-200/60 flex items-center justify-center text-lg shadow-sm">
            <i className="bi bi-clock"></i>
          </div>
          <div>
            <h2 className="text-lg font-bold text-slate-900">
              Canonical Timetable Grid & Slot Boundaries
            </h2>
            <p className="text-xs text-slate-500">
              CCTC Timetable grid reference for Monday through Saturday. All standard class sessions align to these periods.
            </p>
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 text-xs">
          {/* Morning Sessions */}
          <div className="p-4 rounded-2xl bg-slate-50 border border-slate-200/80 space-y-2.5">
            <div className="flex items-center justify-between font-bold text-slate-900 border-b border-slate-200 pb-2">
              <span className="flex items-center gap-1.5">
                <i className="bi bi-sun text-amber-500"></i>
                Morning Sessions
              </span>
              <span className="text-[11px] text-slate-500 font-normal">8:00 AM – 12:30 PM</span>
            </div>
            <div className="space-y-1.5">
              <div className="flex items-center justify-between p-2 rounded-xl bg-white border border-slate-200/60">
                <span className="font-bold text-slate-800">08:00 – 09:30</span>
                <span className="text-slate-500 font-mono">1.5h Standard</span>
              </div>
              <div className="flex items-center justify-between p-2 rounded-xl bg-white border border-slate-200/60">
                <span className="font-bold text-slate-800">09:30 – 11:00</span>
                <span className="text-slate-500 font-mono">1.5h Standard</span>
              </div>
              <div className="flex items-center justify-between p-2 rounded-xl bg-white border border-slate-200/60">
                <span className="font-bold text-slate-800">11:00 – 12:30</span>
                <span className="text-slate-500 font-mono">1.5h Standard</span>
              </div>
              <div className="p-2 rounded-xl bg-emerald-50 border border-emerald-200 text-emerald-800 text-[11px]">
                <strong>1h / 2h Single Sessions:</strong> 08:00–09:00, 08:00–10:00, 09:00–10:00, 10:00–11:00, 10:00–12:00, 11:00–12:00 permitted.
              </div>
            </div>
          </div>

          {/* Institutional Lunch Break */}
          <div className="p-4 rounded-2xl bg-rose-50/60 border border-rose-200 space-y-2.5">
            <div className="flex items-center justify-between font-bold text-rose-950 border-b border-rose-200 pb-2">
              <span className="flex items-center gap-1.5">
                <i className="bi bi-slash-circle text-rose-600"></i>
                Lunch Recess Blackout
              </span>
              <span className="text-[11px] text-rose-700 font-normal">Locked Slot</span>
            </div>
            <div className="space-y-2 text-rose-900 text-xs">
              <div className="p-3 rounded-xl bg-white border border-rose-200 text-center font-bold text-rose-700">
                12:30 PM – 1:00 PM
              </div>
              <p className="text-[11px] text-rose-800/90 leading-relaxed">
                Zero classes permitted across this 30-minute interval. Morning classes must conclude by 12:30 PM; afternoon sessions resume at or after 1:00 PM.
              </p>
            </div>
          </div>

          {/* Afternoon & Evening Sessions */}
          <div className="p-4 rounded-2xl bg-slate-50 border border-slate-200/80 space-y-2.5">
            <div className="flex items-center justify-between font-bold text-slate-900 border-b border-slate-200 pb-2">
              <span className="flex items-center gap-1.5">
                <i className="bi bi-moon-stars text-indigo-500"></i>
                Afternoon & Evening
              </span>
              <span className="text-[11px] text-slate-500 font-normal">1:00 PM – 8:30 PM</span>
            </div>
            <div className="space-y-1.5">
              <div className="flex items-center justify-between p-2 rounded-xl bg-white border border-slate-200/60">
                <span className="font-bold text-slate-800">13:00 – 14:30</span>
                <span className="text-slate-500 font-mono">1.5h Standard</span>
              </div>
              <div className="flex items-center justify-between p-2 rounded-xl bg-white border border-slate-200/60">
                <span className="font-bold text-slate-800">14:30 – 16:00</span>
                <span className="text-slate-500 font-mono">1.5h Standard</span>
              </div>
              <div className="flex items-center justify-between p-2 rounded-xl bg-white border border-slate-200/60">
                <span className="font-bold text-slate-800">16:00 – 17:30</span>
                <span className="text-slate-500 font-mono">1.5h Standard</span>
              </div>
              <div className="flex items-center justify-between p-2 rounded-xl bg-white border border-slate-200/60">
                <span className="font-bold text-slate-800">17:30 – 19:00</span>
                <span className="text-slate-500 font-mono">1.5h Standard</span>
              </div>
              <div className="p-2 rounded-xl bg-emerald-50 border border-emerald-200 text-emerald-800 text-[11px]">
                <strong>1h / 2h Single Sessions:</strong> 13:00–14:00, 13:00–15:00, 14:00–16:00, 15:00–17:00, 16:00–18:00, 17:00–19:00 permitted.
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Department Scoping Notice */}
      <div className="rounded-2xl border border-slate-200 bg-white p-5 text-xs text-slate-600 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="p-2.5 rounded-xl bg-slate-100 text-slate-700">
            <i className="bi bi-diagram-3-fill text-lg"></i>
          </div>
          <div>
            <h3 className="font-bold text-slate-900 text-sm">
              Department Scoping & Allowed Subject Permissions
            </h3>
            <p className="text-slate-500 text-xs">
              Schedulers operate within their assigned department (BSIT vs High School). Subjects outside a scheduler&apos;s permitted scope appear locked with read-only badges on the Timetable Workbench.
            </p>
          </div>
        </div>

        {userRole === 'admin' && (
          <Link
            href="/admin/users"
            className="btn btn-sm btn-outline-primary rounded-pill px-4 text-xs font-semibold shrink-0"
          >
            Manage Schedulers & Scopes
          </Link>
        )}
      </div>
    </div>
  );
}
