// src/app/(auth)/layout.tsx
import React from 'react';

export default function AuthLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="min-h-screen d-flex flex-column justify-content-center align-items-center p-3 p-sm-4 p-md-5">
      <div className="w-100" style={{ maxWidth: '440px' }}>
        {/* Brand Header */}
        <div className="text-center mb-4">
          <div
            className="d-inline-flex align-items-center justify-content-center rounded-circle shadow-sm mb-3"
            style={{
              width: '56px',
              height: '56px',
              background: 'linear-gradient(135deg, #5e2de0, #7b4bf7)',
              color: '#ffffff',
            }}
          >
            <span className="fs-4 fw-bold">AS</span>
          </div>
          <h1 className="fs-3 fw-bold text-dark m-0" style={{ letterSpacing: '-0.02em' }}>
            AlterSched
          </h1>
          <p className="small text-secondary fw-semibold mt-1 mb-0 text-uppercase" style={{ letterSpacing: '0.08em', fontSize: '11px' }}>
            BSIT Academic Scheduling System
          </p>
        </div>

        {/* Auth Floating Card */}
        <div
          className="bg-white p-4 p-sm-5 shadow-lg border border-white"
          style={{
            borderRadius: '28px',
            boxShadow: '0 20px 50px rgba(94, 45, 224, 0.08), 0 1px 3px rgba(0,0,0,0.04)',
          }}
        >
          {children}
        </div>

        {/* Footer Note */}
        <p className="text-center small text-secondary mt-4 mb-0 opacity-75">
          Phase 7 QR Integration &bull; Capstone Project &bull; BSIT Department
        </p>
      </div>
    </div>
  );
}
