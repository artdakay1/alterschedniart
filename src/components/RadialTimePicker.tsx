'use client';

import React, { useState, useEffect, useRef } from 'react';

interface RadialTimePickerProps {
  value: string; // "HH:MM" in 24-hour format (e.g. "08:00", "13:30")
  onChange: (time24: string) => void;
  label?: string;
  disabled?: boolean;
  required?: boolean;
  className?: string;
  id?: string;
}

/**
 * Parses "HH:MM" (24-hour) into 12-hour components: hour (1-12), minute ('00' | '30'), period ('am' | 'pm').
 */
function parse24to12(time24: string): { hour: number; minute: '00' | '30'; period: 'am' | 'pm' } {
  if (!time24 || !time24.includes(':')) {
    return { hour: 8, minute: '00', period: 'am' };
  }
  const [hStr, mStr] = time24.split(':');
  let h = parseInt(hStr, 10);
  if (isNaN(h)) h = 8;
  const m = parseInt(mStr, 10) >= 30 ? '30' : '00';
  const period: 'am' | 'pm' = h >= 12 ? 'pm' : 'am';
  let h12 = h % 12;
  if (h12 === 0) h12 = 12;

  return { hour: h12, minute: m, period };
}

/**
 * Converts 12-hour components into "HH:MM" (24-hour format).
 */
function format12to24(hour: number, minute: '00' | '30', period: 'am' | 'pm'): string {
  let h24 = hour;
  if (period === 'pm' && hour < 12) {
    h24 = hour + 12;
  } else if (period === 'am' && hour === 12) {
    h24 = 0;
  }
  return `${String(h24).padStart(2, '0')}:${minute}`;
}

export function RadialTimePicker({
  value,
  onChange,
  label,
  disabled = false,
  className = '',
  id,
}: RadialTimePickerProps) {
  const [isOpen, setIsOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  const { hour, minute, period } = parse24to12(value);

  // Close when clicking outside
  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    }
    if (isOpen) {
      document.addEventListener('mousedown', handleClickOutside);
    }
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [isOpen]);

  const handleHourSelect = (newHour: number) => {
    const new24 = format12to24(newHour, minute, period);
    onChange(new24);
  };

  const handleMinuteSelect = (newMinute: '00' | '30') => {
    const new24 = format12to24(hour, newMinute, period);
    onChange(new24);
  };

  const handlePeriodToggle = (newPeriod: 'am' | 'pm') => {
    const new24 = format12to24(hour, minute, newPeriod);
    onChange(new24);
  };

  // 12 hours clock layout positions on 200px x 200px canvas
  // Center is (100, 100), radius is 72px
  const center = 100;
  const radius = 72;

  // Calculate pointer angle and coordinates for the selected hour
  // 12 is top (-90 deg), 3 is right (0 deg), 6 is bottom (90 deg), 9 is left (180 deg)
  const angleRad = (hour % 12) * (Math.PI / 6) - Math.PI / 2;
  const pointerX = center + radius * Math.cos(angleRad);
  const pointerY = center + radius * Math.sin(angleRad);

  const formattedDisplay = `${String(hour).padStart(2, '0')}:${minute} ${period.toUpperCase()}`;

  return (
    <div ref={containerRef} className={`position-relative ${className}`} id={id}>
      {label && (
        <label className="form-label small fw-semibold text-secondary mb-1 d-block">
          {label}
        </label>
      )}

      {/* Input Trigger Button */}
      <button
        type="button"
        disabled={disabled}
        onClick={() => !disabled && setIsOpen(!isOpen)}
        className={`form-control ref-form-control bg-white d-flex align-items-center justify-content-between text-start ${
          isOpen ? 'border-primary shadow-sm' : ''
        }`}
        style={{
          cursor: disabled ? 'not-allowed' : 'pointer',
          height: '42px',
        }}
      >
        <span className="fw-semibold text-dark font-monospace">{formattedDisplay}</span>
        <div className="d-flex align-items-center gap-1.5 text-secondary">
          <i className="bi bi-clock"></i>
          <i className={`bi bi-chevron-${isOpen ? 'up' : 'down'} text-xs`}></i>
        </div>
      </button>

      {/* Radial Clock Popup */}
      {isOpen && (
        <div
          className="position-absolute z-3 mt-1 bg-white rounded-4 shadow-lg border p-3"
          style={{
            width: '260px',
            left: '0',
            top: '100%',
          }}
        >
          {/* Header Preview & AM/PM Toggle */}
          <div className="d-flex align-items-center justify-content-between pb-2 mb-2 border-bottom">
            <div>
              <span className="fs-5 fw-bold text-dark font-monospace">
                {String(hour).padStart(2, '0')}:{minute}
              </span>
            </div>
            {/* AM / PM Segmented Buttons */}
            <div className="btn-group btn-group-sm p-0.5 bg-light rounded-pill border">
              <button
                type="button"
                onClick={() => handlePeriodToggle('am')}
                className={`btn btn-sm rounded-pill px-2.5 py-0.5 fw-bold text-xs ${
                  period === 'am' ? 'btn-primary text-white shadow-sm' : 'text-secondary border-0'
                }`}
              >
                AM
              </button>
              <button
                type="button"
                onClick={() => handlePeriodToggle('pm')}
                className={`btn btn-sm rounded-pill px-2.5 py-0.5 fw-bold text-xs ${
                  period === 'pm' ? 'btn-primary text-white shadow-sm' : 'text-secondary border-0'
                }`}
              >
                PM
              </button>
            </div>
          </div>

          {/* Radial Clock Face */}
          <div className="position-relative mx-auto my-1" style={{ width: '200px', height: '200px' }}>
            <svg
              width="200"
              height="200"
              className="position-absolute top-0 start-0 pointer-events-none"
              style={{ zIndex: 1 }}
            >
              {/* Outer dial background ring */}
              <circle cx={center} cy={center} r={radius + 18} fill="#f8fafc" stroke="#e2e8f0" strokeWidth="1" />
              {/* Pointer line */}
              <line
                x1={center}
                y1={center}
                x2={pointerX}
                y2={pointerY}
                stroke="#2563eb"
                strokeWidth="2.5"
                strokeLinecap="round"
              />
              {/* Center pivot point */}
              <circle cx={center} cy={center} r="4.5" fill="#2563eb" />
            </svg>

            {/* 12 Hour Numbers Arranged Radially */}
            {[12, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11].map((h) => {
              const hAngle = (h % 12) * (Math.PI / 6) - Math.PI / 2;
              const hX = center + radius * Math.cos(hAngle);
              const hY = center + radius * Math.sin(hAngle);
              const isSelected = hour === h;

              return (
                <button
                  key={h}
                  type="button"
                  onClick={() => handleHourSelect(h)}
                  className={`btn p-0 position-absolute d-flex align-items-center justify-content-center rounded-circle fw-bold ${
                    isSelected
                      ? 'bg-primary text-white shadow-sm'
                      : 'bg-transparent text-secondary hover:bg-light hover:text-dark'
                  }`}
                  style={{
                    width: '32px',
                    height: '32px',
                    left: `${hX - 16}px`,
                    top: `${hY - 16}px`,
                    zIndex: 2,
                    fontSize: '0.82rem',
                    transition: 'all 0.15s ease',
                  }}
                >
                  {h}
                </button>
              );
            })}
          </div>

          {/* Predetermined Minutes Selector (:00 and :30) */}
          <div className="mt-2 pt-2 border-top">
            <div className="d-flex align-items-center justify-content-between mb-1.5">
              <span className="text-secondary fw-semibold text-xs">Minutes:</span>
              <div className="d-flex gap-1.5">
                <button
                  type="button"
                  onClick={() => handleMinuteSelect('00')}
                  className={`btn btn-sm rounded-pill px-3 py-1 fw-bold text-xs ${
                    minute === '00'
                      ? 'btn-primary text-white shadow-sm'
                      : 'btn-outline-secondary border-light-subtle text-secondary bg-light'
                  }`}
                >
                  :00
                </button>
                <button
                  type="button"
                  onClick={() => handleMinuteSelect('30')}
                  className={`btn btn-sm rounded-pill px-3 py-1 fw-bold text-xs ${
                    minute === '30'
                      ? 'btn-primary text-white shadow-sm'
                      : 'btn-outline-secondary border-light-subtle text-secondary bg-light'
                  }`}
                >
                  :30
                </button>
              </div>
            </div>

            {/* Quick Done Button */}
            <div className="mt-2 text-end">
              <button
                type="button"
                onClick={() => setIsOpen(false)}
                className="btn btn-sm btn-light border w-100 rounded-3 fw-semibold text-xs py-1.5 text-primary"
              >
                Done
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
