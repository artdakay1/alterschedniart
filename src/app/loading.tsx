import React from 'react';

export default function RootLoading() {
  return (
    <div className="d-flex align-items-center justify-content-center min-vh-100 bg-light">
      <div className="text-center p-4">
        <div className="spinner-border text-primary mb-3" style={{ width: '3rem', height: '3rem' }} role="status">
          <span className="visually-hidden">Loading...</span>
        </div>
        <p className="text-muted small fw-medium">Loading AlterSched...</p>
      </div>
    </div>
  );
}
