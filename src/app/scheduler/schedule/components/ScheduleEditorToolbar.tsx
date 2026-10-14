// src/app/scheduler/schedule/components/ScheduleEditorToolbar.tsx
'use client';

import React from 'react';
import Link from 'next/link';
import type { AcademicTerm, Block, ScheduleVersion } from '@/types/database';

export type ZoomDensity = '100%' | '85%' | '70%';

export interface ScheduleEditorToolbarProps {
  terms: AcademicTerm[];
  currentTermId: string;
  currentTerm: AcademicTerm | undefined;
  blocks: (Block & { programs?: { code: string; name: string } | null })[];
  selectedBlockId: string | null;
  selectedBlock: (Block & { programs?: { code: string; name: string } | null }) | undefined;
  draftVersion: ScheduleVersion;
  versionName?: string;
  versionNames?: Record<string, string>;
  versions?: ScheduleVersion[];
  scheduleStyle: 'grid' | 'spreadsheet';
  zoomDensity: ZoomDensity;
  showMasterlist: boolean;
  isReadOnly: boolean;
  isPending: boolean;
  isAiDrafting: boolean;
  isClearingBlock: boolean;
  isPublishing: boolean;
  hardViolationsCount: number;
  softViolationsCount: number;
  selectedBlockEntriesCount: number;
  formatBlockLabel: (b?: any) => string;
  onBackToOverview?: () => void;
  onRenameVersion?: () => void;
  onSelectBlock: (blockId: string) => void;
  onSelectTerm: (termId: string) => void;
  onSelectVersion?: (versionId: string) => void;
  onSetScheduleStyle: (style: 'grid' | 'spreadsheet') => void;
  onSetZoomDensity: (zoom: ZoomDensity) => void;
  onToggleMasterlist: () => void;
  onToggleValidationPanel: () => void;
  onOpenVersionsModal: () => void;
  onOpenAiAdjustments: () => void;
  onOpenClearBlockConfirm: () => void;
  onOpenPublishConfirm: () => void;
}

export function ScheduleEditorToolbar({
  terms,
  currentTermId,
  currentTerm,
  blocks,
  selectedBlockId,
  selectedBlock,
  draftVersion,
  versionName,
  versionNames,
  versions,
  scheduleStyle,
  zoomDensity,
  showMasterlist,
  isReadOnly,
  isPending,
  isAiDrafting,
  isClearingBlock,
  isPublishing,
  hardViolationsCount,
  softViolationsCount,
  selectedBlockEntriesCount,
  formatBlockLabel,
  onBackToOverview,
  onRenameVersion,
  onSelectBlock,
  onSelectTerm,
  onSelectVersion,
  onSetScheduleStyle,
  onSetZoomDensity,
  onToggleMasterlist,
  onToggleValidationPanel,
  onOpenVersionsModal,
  onOpenAiAdjustments,
  onOpenClearBlockConfirm,
  onOpenPublishConfirm,
}: ScheduleEditorToolbarProps) {
  // Quick section step (prev/next)
  const currentBlockIndex = blocks.findIndex((b) => b.id === selectedBlockId);
  const handlePrevBlock = () => {
    if (currentBlockIndex > 0) {
      onSelectBlock(blocks[currentBlockIndex - 1].id);
    }
  };
  const handleNextBlock = () => {
    if (currentBlockIndex >= 0 && currentBlockIndex < blocks.length - 1) {
      onSelectBlock(blocks[currentBlockIndex + 1].id);
    }
  };

  return (
    <div className="card border-0 shadow-sm rounded-4 p-3 mb-4 bg-white">
      <div className="d-flex flex-wrap align-items-center justify-content-between gap-3">
        {/* Left Side: Back button, Term & Block Selectors */}
        <div className="d-flex flex-wrap align-items-center gap-2">
          {onBackToOverview && (
            <button
              type="button"
              onClick={onBackToOverview}
              className="btn btn-outline-secondary rounded-circle d-inline-flex align-items-center justify-content-center shadow-none p-0 transition"
              style={{ width: '36px', height: '36px' }}
              title="Back to Year Level and Block Cohorts overview"
              aria-label="Back to Overview"
            >
              <i className="bi bi-arrow-left fs-5"></i>
            </button>
          )}

          {/* Term Selector */}
          <div className="d-flex align-items-center gap-1.5 bg-light p-1.5 rounded-3 border">
            <span className="text-muted small fw-semibold ps-1">Term:</span>
            <select
              value={currentTermId}
              onChange={(e) => onSelectTerm(e.target.value)}
              className="form-select form-select-sm border-0 bg-transparent fw-bold text-dark py-1"
              style={{ width: 'auto', minWidth: '150px' }}
            >
              {terms.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.school_year} — {t.semester} {t.is_current ? '(Active)' : ''}
                </option>
              ))}
            </select>
          </div>

          {/* Block Selector with Prev / Next Switcher */}
          <div className="d-flex align-items-center gap-1 bg-light p-1 rounded-3 border">
            <button
              type="button"
              onClick={handlePrevBlock}
              disabled={currentBlockIndex <= 0}
              className="btn btn-sm btn-light border-0 text-secondary p-1"
              title="Previous block (Ctrl + Left)"
            >
              <i className="bi bi-chevron-left" style={{ fontSize: '11px' }}></i>
            </button>
            <select
              value={selectedBlockId || ''}
              onChange={(e) => onSelectBlock(e.target.value)}
              className="form-select form-select-sm border-0 bg-transparent fw-bold text-dark py-1"
              style={{ width: 'auto', minWidth: '190px' }}
            >
              {blocks.map((b) => (
                <option key={b.id} value={b.id}>
                  {formatBlockLabel(b)}
                </option>
              ))}
            </select>
            <button
              type="button"
              onClick={handleNextBlock}
              disabled={currentBlockIndex < 0 || currentBlockIndex >= blocks.length - 1}
              className="btn btn-sm btn-light border-0 text-secondary p-1"
              title="Next block (Ctrl + Right)"
            >
              <i className="bi bi-chevron-right" style={{ fontSize: '11px' }}></i>
            </button>
          </div>

          {/* Version Selector */}
          <div className="d-flex align-items-center gap-1.5 bg-light p-1.5 rounded-3 border">
            <span className="text-muted small fw-semibold ps-1">Version:</span>
            <select
              value={draftVersion.id}
              onChange={(e) => onSelectVersion ? onSelectVersion(e.target.value) : undefined}
              className="form-select form-select-sm border-0 bg-transparent fw-bold text-dark py-1"
              style={{ width: 'auto', minWidth: '150px' }}
            >
              {(versions || [draftVersion]).map((v) => (
                <option key={v.id} value={v.id}>
                  {versionNames?.[v.id] ? `${versionNames[v.id]} (v${v.version_number})` : `v${v.version_number}`} [{v.status.toUpperCase()}]
                </option>
              ))}
            </select>
            {onRenameVersion && (
              <button
                type="button"
                onClick={onRenameVersion}
                className="btn btn-sm btn-light border-0 text-secondary p-1"
                title="Rename this draft version"
              >
                <i className="bi bi-pencil-square" style={{ fontSize: '12px' }}></i>
              </button>
            )}
          </div>
        </div>

        {/* Right Side: View Styles, Density, and Actions */}
        <div className="d-flex flex-wrap align-items-center gap-2">
          {/* Feature A: Viewport Density & Zoom Toggle */}
          {scheduleStyle === 'grid' && (
            <div className="btn-group btn-group-sm p-0.5 bg-light rounded-3 border" role="group">
              <button
                type="button"
                onClick={() => onSetZoomDensity('100%')}
                className={`btn btn-sm px-2.5 fw-semibold transition ${
                  zoomDensity === '100%' ? 'btn-primary text-white shadow-2xs' : 'btn-light text-secondary'
                }`}
                style={{ fontSize: '11px', ...(zoomDensity === '100%' ? { backgroundColor: '#0E0AB8', borderColor: '#0E0AB8' } : {}) }}
                title="Comfortable 100% scale"
              >
                100%
              </button>
              <button
                type="button"
                onClick={() => onSetZoomDensity('85%')}
                className={`btn btn-sm px-2.5 fw-semibold transition ${
                  zoomDensity === '85%' ? 'btn-primary text-white shadow-2xs' : 'btn-light text-secondary'
                }`}
                style={{ fontSize: '11px', ...(zoomDensity === '85%' ? { backgroundColor: '#0E0AB8', borderColor: '#0E0AB8' } : {}) }}
                title="Compact 85% scale (fits laptops)"
              >
                85%
              </button>
              <button
                type="button"
                onClick={() => onSetZoomDensity('70%')}
                className={`btn btn-sm px-2.5 fw-semibold transition ${
                  zoomDensity === '70%' ? 'btn-primary text-white shadow-2xs' : 'btn-light text-secondary'
                }`}
                style={{ fontSize: '11px', ...(zoomDensity === '70%' ? { backgroundColor: '#0E0AB8', borderColor: '#0E0AB8' } : {}) }}
                title="Fit Screen 70% scale (no horizontal scroll)"
              >
                70%
              </button>
            </div>
          )}

          {/* View Mode Toggle: Grid vs Spreadsheet */}
          <div className="btn-group btn-group-sm p-0.5 bg-light rounded-3 border" role="group">
            <button
              type="button"
              onClick={() => onSetScheduleStyle('grid')}
              className={`btn btn-sm px-3 fw-semibold transition d-flex align-items-center gap-1.5 ${
                scheduleStyle === 'grid' ? 'btn-primary text-white shadow-sm' : 'btn-light text-secondary'
              }`}
              style={{ fontSize: '11.5px', ...(scheduleStyle === 'grid' ? { backgroundColor: '#0E0AB8', borderColor: '#0E0AB8' } : {}) }}
            >
              <i className="bi bi-calendar3-week"></i>
              <span>Weekly Grid</span>
            </button>
            <button
              type="button"
              onClick={() => onSetScheduleStyle('spreadsheet')}
              className={`btn btn-sm px-3 fw-semibold transition d-flex align-items-center gap-1.5 ${
                scheduleStyle === 'spreadsheet' ? 'btn-primary text-white shadow-sm' : 'btn-light text-secondary'
              }`}
              style={{ fontSize: '11.5px', ...(scheduleStyle === 'spreadsheet' ? { backgroundColor: '#0E0AB8', borderColor: '#0E0AB8' } : {}) }}
            >
              <i className="bi bi-table"></i>
              <span>Spreadsheet</span>
            </button>
          </div>

          {/* Export Buttons */}
          <div className="d-flex align-items-center gap-1">
            <a
              href={`/api/schedule/export?versionId=${draftVersion.id}&format=pdf&blockId=${selectedBlockId}`}
              download
              className="btn btn-sm btn-light border py-1.5 px-2.5 d-flex align-items-center gap-1 text-secondary"
              title="Export this block timetable to PDF"
              style={{ fontSize: '11.5px' }}
            >
              <i className="bi bi-file-earmark-pdf text-danger"></i>
              <span>PDF</span>
            </a>
            <a
              href={`/api/schedule/export?versionId=${draftVersion.id}&format=excel&blockId=${selectedBlockId}`}
              download
              className="btn btn-sm btn-light border py-1.5 px-2.5 d-flex align-items-center gap-1 text-secondary"
              title="Export this block timetable to Excel (.xlsx)"
              style={{ fontSize: '11.5px' }}
            >
              <i className="bi bi-file-earmark-spreadsheet text-success"></i>
              <span>Excel</span>
            </a>
          </div>

          {/* Masterlist Toggle */}
          <button
            type="button"
            onClick={onToggleMasterlist}
            className={`btn btn-sm border py-1.5 px-2.5 d-flex align-items-center gap-1.5 ${
              showMasterlist ? 'btn-primary text-white border-primary shadow-sm' : 'btn-light text-secondary'
            }`}
            style={{ fontSize: '11.5px', ...(showMasterlist ? { backgroundColor: '#0E0AB8', borderColor: '#0E0AB8' } : {}) }}
            title="Toggle whole department masterlist"
          >
            <i className={`bi bi-table ${showMasterlist ? 'text-white' : 'text-primary'}`}></i>
            <span>{showMasterlist ? 'Hide Masterlist' : 'Masterlist'}</span>
          </button>

          {/* Validate Button */}
          <button
            type="button"
            onClick={onToggleValidationPanel}
            className="btn btn-sm btn-light border py-1.5 px-2.5 d-flex align-items-center gap-1.5 text-secondary"
            style={{ fontSize: '11.5px' }}
          >
            <i className="bi bi-shield-check text-primary"></i>
            <span>Validate</span>
            {hardViolationsCount > 0 && (
              <span className="badge rounded-pill bg-danger" style={{ fontSize: '10px' }}>
                {hardViolationsCount}
              </span>
            )}
            {softViolationsCount > 0 && (
              <span className="badge rounded-pill bg-warning text-dark" style={{ fontSize: '10px' }}>
                {softViolationsCount}
              </span>
            )}
            {hardViolationsCount === 0 && softViolationsCount === 0 && (
              <span className="badge rounded-pill bg-success-subtle text-success" style={{ fontSize: '10px' }}>
                Clean
              </span>
            )}
          </button>

          {/* Editor Action Buttons */}
          {!isReadOnly ? (
            <>
              <Link
                href={`/scheduler/generate?termId=${currentTermId}${selectedBlockId ? `&blockId=${selectedBlockId}` : ''}`}
                className="btn btn-sm btn-primary text-white py-1.5 px-3 rounded-pill d-flex align-items-center gap-1 text-decoration-none fw-semibold shadow-sm"
                style={{ fontSize: '11.5px', backgroundColor: '#0E0AB8', borderColor: '#0E0AB8' }}
                title="Configure filters and run algorithm for this block"
              >
                <i className="bi bi-cpu"></i>
                <span>Generate Schedule</span>
              </Link>

              {selectedBlockEntriesCount > 0 && (
                <button
                  type="button"
                  onClick={onOpenAiAdjustments}
                  disabled={isPending || isAiDrafting}
                  className="btn btn-sm btn-outline-primary py-1.5 px-3 rounded-pill d-flex align-items-center gap-1 fw-semibold"
                  style={{ fontSize: '11.5px' }}
                  title="Request schedule adjustments using AI"
                >
                  <i className="bi bi-magic"></i>
                  <span>AI Adjust</span>
                </button>
              )}

              {selectedBlockEntriesCount > 0 && (
                <button
                  type="button"
                  onClick={onOpenClearBlockConfirm}
                  disabled={isPending || isClearingBlock}
                  className="btn btn-sm btn-outline-danger py-1.5 px-3 rounded-pill d-flex align-items-center gap-1 fw-semibold"
                  style={{ fontSize: '11.5px' }}
                  title="Clear all scheduled classes for this block"
                >
                  <i className="bi bi-trash3"></i>
                  <span>Clear Block</span>
                </button>
              )}

              <button
                type="button"
                onClick={onOpenPublishConfirm}
                disabled={isPending || isPublishing || hardViolationsCount > 0}
                className="btn btn-sm btn-success text-white py-1.5 px-3.5 rounded-pill d-flex align-items-center gap-1 fw-semibold shadow-sm"
                style={{ fontSize: '11.5px' }}
                title={
                  hardViolationsCount > 0
                    ? `Cannot publish: ${hardViolationsCount} hard conflict(s) exist`
                    : 'Publish schedule version'
                }
              >
                <i className="bi bi-send-check"></i>
                <span>Publish</span>
              </button>
            </>
          ) : (
            <div className="badge bg-secondary-subtle text-secondary border px-3 py-1.5 rounded-pill fw-semibold" style={{ fontSize: '11px' }}>
              <i className="bi bi-lock me-1"></i>
              Read-Only
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
