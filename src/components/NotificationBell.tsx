// src/components/NotificationBell.tsx
'use client';

import React, { useState, useEffect, useRef, useTransition } from 'react';
import {
  markNotificationAsReadAction,
  markAllNotificationsAsReadAction,
} from '@/app/actions/notification-actions';

export interface AppNotification {
  id: string;
  title: string;
  body: string;
  is_read: boolean;
  created_at: string;
}

interface NotificationBellProps {
  initialNotifications?: AppNotification[];
}

export function NotificationBell({ initialNotifications = [] }: NotificationBellProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [notifications, setNotifications] = useState<AppNotification[]>(initialNotifications);
  const [isPending, startTransition] = useTransition();
  const dropdownRef = useRef<HTMLDivElement>(null);

  const unreadCount = notifications.filter((n) => !n.is_read).length;

  // Close dropdown on outside click
  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const handleMarkAsRead = (id: string) => {
    startTransition(async () => {
      setNotifications((prev) =>
        prev.map((n) => (n.id === id ? { ...n, is_read: true } : n))
      );
      await markNotificationAsReadAction(id);
    });
  };

  const handleMarkAllAsRead = () => {
    startTransition(async () => {
      setNotifications((prev) => prev.map((n) => ({ ...n, is_read: true })));
      await markAllNotificationsAsReadAction();
    });
  };

  return (
    <div className="position-relative" ref={dropdownRef}>
      <button
        type="button"
        onClick={() => setIsOpen(!isOpen)}
        className="circle-action-btn position-relative"
        aria-label="Notifications"
      >
        <i className="bi bi-bell text-secondary" style={{ fontSize: '0.92rem' }} />

        {unreadCount > 0 && (
          <span
            className="position-absolute top-0 start-100 translate-middle badge rounded-pill bg-danger border border-white"
            style={{ fontSize: '0.62rem', padding: '0.25em 0.45em' }}
          >
            {unreadCount > 9 ? '9+' : unreadCount}
          </span>
        )}
      </button>

      {isOpen && (
        <div
          className="card shadow-lg border position-absolute end-0 mt-2 bg-white text-dark z-3"
          style={{ width: '340px', maxWidth: '90vw' }}
        >
          <div className="card-header bg-light border-bottom py-2.5 px-3 d-flex align-items-center justify-content-between">
            <div className="d-flex align-items-center gap-2">
              <span className="fw-bold small text-uppercase text-secondary" style={{ fontSize: '0.75rem' }}>
                Notifications
              </span>
              {unreadCount > 0 && (
                <span className="badge bg-danger rounded-pill" style={{ fontSize: '0.65rem' }}>
                  {unreadCount} new
                </span>
              )}
            </div>

            {unreadCount > 0 && (
              <button
                type="button"
                onClick={handleMarkAllAsRead}
                disabled={isPending}
                className="btn btn-link btn-sm text-primary p-0 text-decoration-none fw-semibold"
                style={{ fontSize: '0.75rem' }}
              >
                Mark all read
              </button>
            )}
          </div>

          <div className="list-group list-group-flush overflow-auto" style={{ maxHeight: '350px' }}>
            {notifications.length === 0 ? (
              <div className="p-4 text-center text-muted small">
                No notifications right now.
              </div>
            ) : (
              notifications.map((n) => (
                <div
                  key={n.id}
                  className={`list-group-item list-group-item-action p-3 d-flex align-items-start gap-2.5 ${
                    n.is_read ? 'bg-white' : 'bg-primary-subtle'
                  }`}
                >
                  <div className="mt-1 flex-shrink-0">
                    {!n.is_read ? (
                      <span className="badge bg-primary p-1 rounded-circle d-block" />
                    ) : (
                      <span className="badge bg-secondary-subtle p-1 rounded-circle d-block" />
                    )}
                  </div>

                  <div className="flex-grow-1 min-w-0">
                    <div className="d-flex align-items-center justify-content-between gap-2">
                      <p className={`small mb-0 text-truncate ${n.is_read ? 'fw-normal text-secondary' : 'fw-bold text-dark'}`}>
                        {n.title}
                      </p>
                      <small className="text-muted text-nowrap" style={{ fontSize: '0.7rem' }}>
                        {new Date(n.created_at).toLocaleDateString([], {
                          month: 'short',
                          day: 'numeric',
                        })}
                      </small>
                    </div>

                    <p className="small text-muted mb-1 text-break" style={{ fontSize: '0.78rem' }}>
                      {n.body}
                    </p>

                    {!n.is_read && (
                      <button
                        type="button"
                        onClick={() => handleMarkAsRead(n.id)}
                        disabled={isPending}
                        className="btn btn-link btn-sm text-primary p-0 text-decoration-none fw-semibold"
                        style={{ fontSize: '0.72rem' }}
                      >
                        Mark as read
                      </button>
                    )}
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  );
}
