import React from 'react';

export default function InstructorLoading() {
  return (
    <div className="py-4 space-y-4 animate-pulse">
      <div className="card shadow-sm border-0 p-4 bg-white">
        <div className="d-flex justify-content-between align-items-center">
          <div>
            <div className="bg-secondary-subtle rounded" style={{ width: '190px', height: '24px' }} />
            <div className="bg-secondary-subtle rounded mt-2" style={{ width: '260px', height: '14px' }} />
          </div>
          <div className="bg-secondary-subtle rounded" style={{ width: '100px', height: '36px' }} />
        </div>
      </div>

      <div className="card shadow-sm border-0 p-4 bg-white">
        <div className="table-responsive">
          <table className="table table-hover align-middle mb-0">
            <thead>
              <tr>
                <th style={{ width: '25%' }}><div className="bg-secondary-subtle rounded" style={{ height: '16px' }} /></th>
                <th style={{ width: '25%' }}><div className="bg-secondary-subtle rounded" style={{ height: '16px' }} /></th>
                <th style={{ width: '25%' }}><div className="bg-secondary-subtle rounded" style={{ height: '16px' }} /></th>
                <th style={{ width: '25%' }}><div className="bg-secondary-subtle rounded" style={{ height: '16px' }} /></th>
              </tr>
            </thead>
            <tbody>
              {[1, 2, 3, 4].map((i) => (
                <tr key={i}>
                  <td><div className="bg-secondary-subtle rounded" style={{ height: '18px', width: '70%' }} /></td>
                  <td><div className="bg-secondary-subtle rounded" style={{ height: '18px', width: '50%' }} /></td>
                  <td><div className="bg-secondary-subtle rounded" style={{ height: '18px', width: '65%' }} /></td>
                  <td><div className="bg-secondary-subtle rounded" style={{ height: '18px', width: '40%' }} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
