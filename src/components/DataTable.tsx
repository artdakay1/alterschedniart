// src/components/DataTable.tsx
'use client';

import React, { useState, useMemo } from 'react';

export interface Column<T> {
  header: string;
  accessorKey?: keyof T;
  render?: (item: T) => React.ReactNode;
  className?: string;
}

interface DataTableProps<T> {
  title: string;
  description?: string;
  data: T[];
  columns: Column<T>[];
  keyExtractor: (item: T) => string;
  searchPlaceholder?: string;
  searchFilter?: (item: T, query: string) => boolean;
  onAdd?: () => void;
  addLabel?: string;
  actions?: (item: T) => React.ReactNode;
  emptyMessage?: string;
  headerExtras?: React.ReactNode;
  onDeleteSelected?: (selectedKeys: string[], clearSelection: () => void) => void | Promise<void>;
  bulkDeleteLabel?: string;
}

export function DataTable<T>({
  title,
  description,
  data,
  columns,
  keyExtractor,
  searchPlaceholder = 'Search records...',
  searchFilter,
  onAdd,
  addLabel = 'Add New',
  actions,
  emptyMessage = 'No records found.',
  headerExtras,
  onDeleteSelected,
  bulkDeleteLabel,
}: DataTableProps<T>) {
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedKeys, setSelectedKeys] = useState<Set<string>>(new Set());
  const [viewMode, setViewMode] = useState<'table' | 'cards'>('table');

  const filteredData = useMemo(() => {
    if (!searchQuery.trim() || !searchFilter) return data;
    const query = searchQuery.toLowerCase().trim();
    return data.filter((item) => searchFilter(item, query));
  }, [data, searchQuery, searchFilter]);

  const allSelected =
    filteredData.length > 0 && filteredData.every((item) => selectedKeys.has(keyExtractor(item)));

  const toggleSelectAll = () => {
    if (allSelected) {
      setSelectedKeys(new Set());
    } else {
      setSelectedKeys(new Set(filteredData.map((item) => keyExtractor(item))));
    }
  };

  const toggleSelectOne = (key: string) => {
    setSelectedKeys((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  return (
    <div className="space-y-4">
      {/* Optional Title & Description */}
      {(title || description) && (
        <div className="mb-1">
          {title && <h3 className="h5 fw-bold text-dark mb-1">{title}</h3>}
          {description && <p className="small text-muted mb-0">{description}</p>}
        </div>
      )}

      {/* Section Header with Title, Segment Pills, and Action Buttons (Exact Reference Layout) */}
      <div className="d-flex flex-column flex-md-row justify-content-between align-items-start align-items-md-center gap-3">
        {/* Pill segment control [Table | Cards] */}
        <div>
          <div className="pill-segment-control">
            <button
              type="button"
              onClick={() => setViewMode('table')}
              className={`pill-segment-btn ${viewMode === 'table' ? 'active' : ''}`}
            >
              Table
            </button>
            <button
              type="button"
              onClick={() => setViewMode('cards')}
              className={`pill-segment-btn ${viewMode === 'cards' ? 'active' : ''}`}
            >
              Cards
            </button>
          </div>
        </div>

        {/* Right Actions: Purple Primary Pill & White Pill Export */}
        <div className="d-flex flex-wrap align-items-center gap-2.5">
          {searchFilter && (
            <div className="search-capsule-wrap">
              <i
                className="bi bi-search position-absolute text-muted"
                style={{ left: '14px', fontSize: '0.8rem' }}
              />
              <input
                type="text"
                placeholder={searchPlaceholder}
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="search-capsule-input"
              />
            </div>
          )}

          {headerExtras}

          {onAdd && (
            <button
              onClick={onAdd}
              type="button"
              className="btn-ref-primary"
            >
              <i className="bi bi-plus-lg" />
              <span>{addLabel}</span>
            </button>
          )}
        </div>
      </div>

      {/* Bulk Action Alert Banner when 2 or more rows / all rows are selected */}
      {selectedKeys.size >= 2 && onDeleteSelected && (
        <div className="alert alert-light border border-danger-subtle bg-danger-subtle bg-opacity-10 d-flex flex-wrap align-items-center justify-content-between gap-3 p-3 rounded-4 shadow-sm">
          <div className="d-flex align-items-center gap-2">
            <span className="badge bg-danger text-white rounded-pill px-2.5 py-1">
              {selectedKeys.size} selected
            </span>
            <span className="small fw-semibold text-dark">
              {allSelected
                ? `All ${selectedKeys.size} records selected across current view.`
                : `${selectedKeys.size} record${selectedKeys.size === 1 ? '' : 's'} selected.`}
            </span>
          </div>
          <div className="d-flex align-items-center gap-2">
            <button
              type="button"
              onClick={() => setSelectedKeys(new Set())}
              className="btn btn-sm btn-light border rounded-pill px-3 text-secondary"
            >
              Cancel Selection
            </button>
            <button
              type="button"
              onClick={() => onDeleteSelected(Array.from(selectedKeys), () => setSelectedKeys(new Set()))}
              className="btn btn-sm btn-danger rounded-pill px-3.5 shadow-sm fw-semibold d-flex align-items-center gap-1.5"
            >
              <i className="bi bi-trash3-fill" />
              <span>{bulkDeleteLabel || `Delete ${allSelected ? 'All' : 'Selected'} (${selectedKeys.size})`}</span>
            </button>
          </div>
        </div>
      )}

      {/* Main Table Card (White Rounded Frame matching Reference Design) */}
      <div className="ref-table-card">
        <div className="table-responsive">
          {filteredData.length === 0 ? (
            <div className="text-center py-5 text-secondary small">
              <i className="bi bi-inbox text-muted d-block mb-2" style={{ fontSize: '2.4rem' }} />
              <p className="mb-0 fw-medium">{emptyMessage}</p>
            </div>
          ) : (
            <table className="ref-table">
              <thead>
                <tr>
                  <th style={{ width: '48px', textAlign: 'center' }}>
                    <input
                      type="checkbox"
                      checked={allSelected}
                      onChange={toggleSelectAll}
                      className="ref-checkbox"
                      aria-label="Select all rows"
                    />
                  </th>
                  {columns.map((col, idx) => (
                    <th key={idx} className={col.className || ''}>
                      {col.header}
                    </th>
                  ))}
                  {actions && (
                    <th style={{ width: '48px', textAlign: 'center' }}>
                      <span className="visually-hidden">Actions</span>
                    </th>
                  )}
                </tr>
              </thead>
              <tbody>
                {filteredData.map((item) => {
                  const key = keyExtractor(item);
                  const isChecked = selectedKeys.has(key);
                  return (
                    <tr key={key} style={{ backgroundColor: isChecked ? '#f8f7ff' : undefined }}>
                      <td style={{ textAlign: 'center' }}>
                        <input
                          type="checkbox"
                          checked={isChecked}
                          onChange={() => toggleSelectOne(key)}
                          className="ref-checkbox"
                          aria-label={`Select row ${key}`}
                        />
                      </td>

                      {columns.map((col, idx) => (
                        <td key={idx} className={col.className || ''}>
                          {col.render
                            ? col.render(item)
                            : col.accessorKey
                            ? String(item[col.accessorKey] ?? '')
                            : null}
                        </td>
                      ))}

                      {actions && (
                        <td style={{ textAlign: 'center' }}>
                          <div className="d-inline-flex align-items-center justify-content-center">
                            {actions(item)}
                          </div>
                        </td>
                      )}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>

        {/* Footer Row matching reference card */}
        <div className="px-4 py-3 bg-white border-top d-flex justify-content-between align-items-center text-muted small" style={{ fontSize: '0.78rem' }}>
          <span>
            Showing <strong>{filteredData.length}</strong> record{filteredData.length === 1 ? '' : 's'}
          </span>
          {selectedKeys.size > 0 && (
            <div className="d-flex align-items-center gap-2">
              <span className="badge bg-primary-subtle text-primary border border-primary-subtle rounded-pill px-2.5 py-1">
                {selectedKeys.size} selected
              </span>
              {onDeleteSelected && selectedKeys.size >= 2 && (
                <button
                  type="button"
                  onClick={() => onDeleteSelected(Array.from(selectedKeys), () => setSelectedKeys(new Set()))}
                  className="btn btn-sm btn-outline-danger rounded-pill py-0 px-2 fw-semibold"
                  style={{ fontSize: '0.75rem' }}
                >
                  <i className="bi bi-trash3 me-1" />
                  Delete ({selectedKeys.size})
                </button>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
