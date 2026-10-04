// src/components/RoleNav.tsx
'use client';

import React, { useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { LogoutButton } from '@/components/LogoutButton';
import { NotificationBell, type AppNotification } from '@/components/NotificationBell';
import type { UserRole } from '@/types/database';

interface RoleNavProps {
  role: UserRole;
  userName: string;
  userEmail: string;
  links: { label: string; href: string }[];
  activeHref?: string;
  notifications?: AppNotification[];
}

export function RoleNav({
  role,
  userName,
  userEmail,
  links,
  activeHref,
  notifications,
}: RoleNavProps) {
  const pathname = usePathname();
  const [isMobileOpen, setIsMobileOpen] = useState(false);
  const [searchVal, setSearchVal] = useState('');

  // Initials for avatar
  const initials = userName
    ? userName
        .split(' ')
        .map((p) => p[0])
        .join('')
        .slice(0, 2)
        .toUpperCase()
    : 'AS';

  return (
    <header className="island-header">
      {/* Left: Brand + Navigation Tabs */}
      <div className="d-flex align-items-center gap-4 gap-xl-5 flex-wrap">
        {/* Brand Logo matching reference */}
        <Link
          href={`/${role}`}
          className="d-flex align-items-center gap-2 text-decoration-none text-dark"
        >
          <div
            className="d-flex align-items-center justify-content-center fw-bold"
            style={{
              width: '32px',
              height: '32px',
              borderRadius: '8px',
              background: '#111827',
              color: '#ffffff',
              fontSize: '0.82rem',
              letterSpacing: '-0.02em',
            }}
          >
            <i className="bi bi-grid-fill" style={{ fontSize: '0.9rem' }} />
          </div>
          <div className="d-flex align-items-baseline gap-1.5">
            <span
              className="fw-bold tracking-tight text-dark"
              style={{ fontSize: '1.15rem', letterSpacing: '-0.03em' }}
            >
              {role === 'admin' ? 'ADMINS' : role === 'scheduler' ? 'SCHEDULER' : 'FACULTY'}
            </span>
          </div>
        </Link>

        {/* Desktop Nav Links with dark underline active state */}
        <nav className="d-none d-lg-flex align-items-center gap-3 gap-xl-4">
          {links.map((link) => {
            const isActive = (activeHref || pathname) === link.href;
            return (
              <Link
                key={link.href}
                href={link.href}
                prefetch={true}
                className={`island-nav-link ${isActive ? 'active' : ''}`}
              >
                {link.label}
              </Link>
            );
          })}
        </nav>
      </div>

      {/* Right Controls: Search Capsule, Sun/Moon, Bell, Avatar */}
      <div className="d-flex align-items-center gap-2.5">
        {/* Search Capsule Input */}
        <div className="search-capsule-wrap d-none d-md-flex">
          <i
            className="bi bi-search position-absolute text-muted"
            style={{ left: '14px', fontSize: '0.8rem' }}
          />
          <input
            type="text"
            placeholder="Search here..."
            value={searchVal}
            onChange={(e) => setSearchVal(e.target.value)}
            className="search-capsule-input"
          />
        </div>

        {/* Theme indicator pill (decorative matching reference design) */}
        <div
          className="d-none d-sm-flex align-items-center gap-1.5 px-2.5 py-1.5 bg-white rounded-pill border"
          style={{ borderColor: 'rgba(220, 225, 240, 0.9)', boxShadow: '0 2px 6px rgba(0,0,0,0.03)' }}
          title="Light Theme Active"
        >
          <i className="bi bi-moon text-secondary" style={{ fontSize: '0.78rem' }} />
          <i className="bi bi-brightness-high-fill text-warning" style={{ fontSize: '0.82rem' }} />
        </div>

        {/* Notification Bell */}
        <NotificationBell initialNotifications={notifications} />

        {/* User Profile Avatar with Colorful Gradient Ring */}
        <div className="d-flex align-items-center gap-2">
          <div className="avatar-gradient-ring" title={`${userName} (${userEmail})`}>
            <div className="avatar-inner">{initials}</div>
          </div>
          <div className="d-none d-xl-block text-start lh-1">
            <div className="fw-bold small text-dark" style={{ fontSize: '0.8rem' }}>
              {userName}
            </div>
            <small className="text-muted" style={{ fontSize: '0.7rem' }}>
              {role.toUpperCase()}
            </small>
          </div>
        </div>

        {/* Sign Out Button */}
        <LogoutButton />

        {/* Mobile Toggler */}
        <button
          className="btn btn-sm circle-action-btn d-lg-none"
          type="button"
          onClick={() => setIsMobileOpen(!isMobileOpen)}
          aria-label="Toggle navigation"
        >
          <i className={`bi ${isMobileOpen ? 'bi-x-lg' : 'bi-list'}`} />
        </button>
      </div>

      {/* Mobile Drawer */}
      {isMobileOpen && (
        <div
          className="d-lg-none w-100 position-absolute start-0 top-100 mt-2 p-3 bg-white rounded-4 shadow-lg border"
          style={{ zIndex: 1050 }}
        >
          <div className="mb-3 pb-2 border-bottom d-flex justify-content-between align-items-center">
            <div>
              <div className="fw-bold small text-dark">{userName}</div>
              <small className="text-muted">{userEmail}</small>
            </div>
            <span className="badge bg-secondary-subtle text-secondary text-uppercase">{role}</span>
          </div>

          <div className="d-flex flex-column gap-1">
            {links.map((link) => {
              const isActive = (activeHref || pathname) === link.href;
              return (
                <Link
                  key={link.href}
                  href={link.href}
                  prefetch={true}
                  onClick={() => setIsMobileOpen(false)}
                  className={`p-2.5 rounded-3 text-decoration-none d-flex align-items-center justify-content-between ${
                    isActive
                      ? 'bg-primary-subtle text-primary fw-bold'
                      : 'text-dark hover:bg-light'
                  }`}
                  style={{ fontSize: '0.86rem' }}
                >
                  <span>{link.label}</span>
                  {isActive && <i className="bi bi-check2 text-primary" />}
                </Link>
              );
            })}
          </div>
        </div>
      )}
    </header>
  );
}
