// src/app/(dashboard)/layout.tsx
import React from 'react';

export default function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="min-h-screen d-flex flex-column">
      {children}
    </div>
  );
}
