// src/components/AppShell.tsx
'use client';

import React, { useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { LogoutButton } from '@/components/LogoutButton';
import { NotificationBell, type AppNotification } from '@/components/NotificationBell';
import type { UserRole } from '@/types/database';

export interface NavLinkItem {
  label: string;
  href: string;
  icon?: string;
}

interface AppShellProps {
  role: UserRole;
  userName: string;
  userEmail: string;
  links: NavLinkItem[];
  notifications?: AppNotification[];
  children: React.ReactNode;
}

export function AppShell({
  role,
  userName,
  userEmail,
  links,
  notifications,
  children,
}: AppShellProps) {
  const pathname = usePathname();
  const [isMobileOpen, setIsMobileOpen] = useState(false);
  const [searchVal, setSearchVal] = useState('');

  // Generate initials for avatar
  const initials = userName
    ? userName
        .split(' ')
        .map((p) => p[0])
        .join('')
        .slice(0, 2)
        .toUpperCase()
    : 'AS';

  const defaultIcons: Record<string, string> = {
    Dashboard: 'bi-grid-fill',
    Terms: 'bi-calendar-range',
    'Programs & Blocks': 'bi-mortarboard',
    Subjects: 'bi-book',
    Rooms: 'bi-building',
    Instructors: 'bi-people',
    Constraints: 'bi-shield-check',
    'Fixed Constraints': 'bi-lock',
    Alterations: 'bi-arrow-left-right',
    'QR Sheets': 'bi-qr-code',
    Users: 'bi-person-gear',
    'Schedule Editor': 'bi-calendar3',
    'AI Generator': 'bi-cpu',
    'My Availability': 'bi-clock-history',
  };

  return (
    <div className="min-vh-100 p-2 p-md-3 p-xl-4 d-flex flex-column flex-lg-row gap-3 gap-xl-4 position-relative">
      {/* Mobile Backdrop */}
      {isMobileOpen && (
        <div
          className="position-fixed inset-0 bg-dark bg-opacity-50 z-30 d-lg-none"
          style={{ top: 0, left: 0, right: 0, bottom: 0, zIndex: 1040 }}
          onClick={() => setIsMobileOpen(false)}
        />
      )}

      {/* ========================================================================= */}
      {/* LEFT SIDEBAR NAVIGATION (Matching Reference Layout)                       */}
      {/* ========================================================================= */}
      <aside className={`sidebar-panel ${isMobileOpen ? 'show-mobile' : ''}`}>
        <div>
          {/* Brand Logo & Name */}
          <div className="d-flex align-items-center justify-content-between px-2 pb-3 mb-2 border-bottom border-light">
            <Link
              href={`/${role}`}
              className="d-flex align-items-center gap-2.5 text-decoration-none text-dark"
              onClick={() => setIsMobileOpen(false)}
            >
              <div
                className="d-flex align-items-center justify-content-center bg-white shadow-sm p-1 border rounded-3"
                style={{
                  width: '38px',
                  height: '38px',
                }}
              >
                <img
                  src="/images/altersched-logo.png"
                  alt="AlterSched Logo"
                  style={{ width: '100%', height: '100%', objectFit: 'contain' }}
                />
              </div>
              <div>
                <span
                  className="fw-bold tracking-tight text-dark d-block"
                  style={{ fontSize: '1.2rem', letterSpacing: '-0.02em', lineHeight: 1.1 }}
                >
                  AlterSched
                </span>
                <span className="text-muted text-uppercase fw-semibold" style={{ fontSize: '0.68rem', letterSpacing: '0.05em' }}>
                  {role === 'admin' ? 'Admin Hub' : role === 'scheduler' ? 'Scheduler Hub' : 'Faculty Portal'}
                </span>
              </div>
            </Link>

            <button
              type="button"
              className="btn btn-sm btn-light border-0 d-lg-none"
              onClick={() => setIsMobileOpen(false)}
            >
              <i className="bi bi-x-lg" />
            </button>
          </div>

          {/* Section: MENU */}
          <div className="sidebar-section-label">MENU</div>
          <nav className="d-flex flex-column gap-1">
            {links.map((link) => {
              const isActive =
                pathname === link.href ||
                (link.href !== `/${role}` && pathname.startsWith(`${link.href}/`));
              const iconClass = link.icon || defaultIcons[link.label] || 'bi-circle';

              return (
                <Link
                  key={link.href}
                  href={link.href}
                  prefetch={true}
                  onClick={() => setIsMobileOpen(false)}
                  className={`sidebar-nav-link ${isActive ? 'active' : ''}`}
                >
                  <i className={`bi ${iconClass}`} />
                  <span>{link.label}</span>
                </Link>
              );
            })}
          </nav>

          {/* Section: GENERAL */}
          <div className="sidebar-section-label mt-4">GENERAL</div>
          <nav className="d-flex flex-column gap-1">
            <Link
              href={`/${role}`}
              prefetch={true}
              className="sidebar-nav-link"
              onClick={() => setIsMobileOpen(false)}
            >
              <i className="bi bi-gear" />
              <span>Settings</span>
            </Link>
            <div className="d-flex align-items-center gap-2 px-3 py-2 text-secondary small">
              <LogoutButton />
            </div>
          </nav>
        </div>

        {/* Sidebar Bottom Promo / Engine Status Card */}
        <div className="sidebar-promo-card mt-3">
          <div className="d-flex align-items-center gap-2 mb-2">
            <span
              className="d-flex align-items-center justify-content-center text-white"
              style={{
                width: '24px',
                height: '24px',
                borderRadius: '8px',
                background: '#0E0AB8',
                fontSize: '0.75rem',
              }}
            >
              <i className="bi bi-shield-check" />
            </span>
            <span className="fw-bold small">Conflict Engine</span>
          </div>
          <p className="text-secondary small mb-3" style={{ fontSize: '0.72rem', color: '#94a3b8' }}>
            Deterministic timetable checks active across all offerings.
          </p>
          <Link
            href={role === 'admin' ? '/admin/terms' : '/scheduler/schedule'}
            className="sidebar-promo-btn"
          >
            <span>A.Y. 2026-2027 Active</span>
            <i className="bi bi-arrow-right" style={{ fontSize: '0.8rem' }} />
          </Link>
        </div>
      </aside>

      {/* ========================================================================= */}
      {/* RIGHT MAIN CONTENT AREA                                                   */}
      {/* ========================================================================= */}
      <div className="d-flex flex-column flex-grow-1 overflow-hidden">
        {/* Topbar matching reference */}
        <header className="app-topbar">
          <div className="d-flex align-items-center gap-2 gap-md-3">
            {/* Mobile Hamburger Toggle */}
            <button
              type="button"
              className="btn btn-sm btn-light border-0 d-lg-none p-1.5"
              onClick={() => setIsMobileOpen(true)}
              aria-label="Open sidebar menu"
            >
              <i className="bi bi-list fs-5" />
            </button>

            {/* Search Task Input with shortcut pill */}
            <div className="position-relative d-flex align-items-center">
              <i
                className="bi bi-search position-absolute text-muted"
                style={{ left: '14px', fontSize: '0.85rem' }}
              />
              <input
                type="text"
                value={searchVal}
                onChange={(e) => setSearchVal(e.target.value)}
                placeholder="Search schedule, task..."
                className="form-control"
                style={{
                  background: '#f8fafc',
                  border: '1px solid #e2e8f0',
                  borderRadius: '9999px',
                  padding: '8px 46px 8px 38px',
                  fontSize: '0.84rem',
                  width: '260px',
                  transition: 'all 0.2s ease',
                }}
              />
              <span
                className="position-absolute text-muted font-monospace fw-semibold"
                style={{
                  right: '12px',
                  fontSize: '0.7rem',
                  background: '#e2e8f0',
                  padding: '2px 6px',
                  borderRadius: '6px',
                }}
              >
                ⌘F
              </span>
            </div>
          </div>

          {/* Right: Mail, Bell, and User Profile Info Capsule */}
          <div className="d-flex align-items-center gap-2 gap-md-3">
            {/* Notification Bell */}
            <NotificationBell initialNotifications={notifications} />

            {/* User Profile Capsule (Totok Michael style) */}
            <div className="d-flex align-items-center gap-2.5 ps-2 border-start border-light-subtle">
              <div className="avatar-gradient-ring">
                <div className="avatar-inner">{initials}</div>
              </div>
              <div className="d-none d-sm-block text-start">
                <div
                  className="fw-bold text-dark text-truncate"
                  style={{ fontSize: '0.84rem', maxWidth: '160px', lineHeight: 1.2 }}
                >
                  {userName}
                </div>
                <div
                  className="text-muted text-truncate"
                  style={{ fontSize: '0.72rem', maxWidth: '160px', lineHeight: 1 }}
                >
                  {userEmail}
                </div>
              </div>
            </div>
          </div>
        </header>

        {/* Page Content Body */}
        <main className="flex-grow-1">
          {children}
        </main>
      </div>
    </div>
  );
}
