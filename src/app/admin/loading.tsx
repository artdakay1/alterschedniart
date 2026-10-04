import React from 'react';

export default function AdminLoading() {
  return (
    <div className="py-4 space-y-4 animate-pulse">
      {/* Header Skeleton */}
      <div className="card shadow-sm border-0 p-4 bg-white">
        <div className="d-flex justify-content-between align-items-center">
          <div>
            <div className="bg-secondary-subtle rounded" style={{ width: '180px', height: '24px' }} />
            <div className="bg-secondary-subtle rounded mt-2" style={{ width: '280px', height: '14px' }} />
          </div>
          <div className="bg-secondary-subtle rounded" style={{ width: '120px', height: '36px' }} />
        </div>
      </div>

      {/* Content Table Skeleton */}
      <div className="card shadow-sm border-0 p-4 bg-white">
        <div className="d-flex justify-content-between mb-3">
          <div className="bg-secondary-subtle rounded" style={{ width: '220px', height: '36px' }} />
          <div className="bg-secondary-subtle rounded" style={{ width: '160px', height: '36px' }} />
        </div>
        <div className="table-responsive">
          <table className="table table-hover align-middle mb-0">
            <thead>
              <tr>
                <th style={{ width: '30%' }}><div className="bg-secondary-subtle rounded" style={{ height: '16px' }} /></th>
                <th style={{ width: '25%' }}><div className="bg-secondary-subtle rounded" style={{ height: '16px' }} /></th>
                <th style={{ width: '25%' }}><div className="bg-secondary-subtle rounded" style={{ height: '16px' }} /></th>
                <th style={{ width: '20%' }}><div className="bg-secondary-subtle rounded" style={{ height: '16px' }} /></th>
              </tr>
            </thead>
            <tbody>
              {[1, 2, 3, 4, 5].map((i) => (
                <tr key={i}>
                  <td><div className="bg-secondary-subtle rounded" style={{ height: '18px', width: '80%' }} /></td>
                  <td><div className="bg-secondary-subtle rounded" style={{ height: '18px', width: '60%' }} /></td>
                  <td><div className="bg-secondary-subtle rounded" style={{ height: '18px', width: '70%' }} /></td>
                  <td><div className="bg-secondary-subtle rounded" style={{ height: '18px', width: '50%' }} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
