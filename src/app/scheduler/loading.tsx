import React from 'react';

export default function SchedulerLoading() {
  return (
    <div className="py-4 space-y-4 animate-pulse">
      {/* Header Skeleton */}
      <div className="card shadow-sm border-0 p-4 bg-white">
        <div className="d-flex flex-column flex-sm-row justify-content-between align-items-start align-items-sm-center gap-3">
          <div>
            <div className="bg-secondary-subtle rounded" style={{ width: '200px', height: '26px' }} />
            <div className="bg-secondary-subtle rounded mt-2" style={{ width: '320px', height: '14px' }} />
          </div>
          <div className="d-flex gap-2">
            <div className="bg-secondary-subtle rounded" style={{ width: '90px', height: '36px' }} />
            <div className="bg-secondary-subtle rounded" style={{ width: '130px', height: '36px' }} />
          </div>
        </div>
      </div>

      {/* Grid / Editor Skeleton */}
      <div className="card shadow-sm border-0 p-4 bg-white">
        <div className="row g-3 mb-4">
          <div className="col-12 col-md-4">
            <div className="bg-secondary-subtle rounded" style={{ height: '38px' }} />
          </div>
          <div className="col-12 col-md-4">
            <div className="bg-secondary-subtle rounded" style={{ height: '38px' }} />
          </div>
          <div className="col-12 col-md-4">
            <div className="bg-secondary-subtle rounded" style={{ height: '38px' }} />
          </div>
        </div>

        <div className="row g-3">
          {[1, 2, 3, 4, 5, 6].map((i) => (
            <div key={i} className="col-12 col-md-6 col-lg-4">
              <div className="p-3 border rounded-3 bg-light">
                <div className="bg-secondary-subtle rounded mb-2" style={{ height: '20px', width: '60%' }} />
                <div className="bg-secondary-subtle rounded mb-2" style={{ height: '14px', width: '90%' }} />
                <div className="bg-secondary-subtle rounded" style={{ height: '14px', width: '40%' }} />
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
