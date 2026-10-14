'use client';

import React, { useState, useTransition } from 'react';
import Link from 'next/link';
import { revokeQrTokenAction } from '@/app/actions/qr-actions';
import type { AcademicTerm, ScheduleVersion, QrToken, Block, Program } from '@/types/database';

export interface BlockTokenItem {
  block: Block & { programs?: Program | null };
  token: QrToken | null;
  qrDataUrl: string | null;
  publicUrl: string;
  classesCount: number;
}

interface QrSheetsClientProps {
  currentTerm: AcademicTerm | null;
  publishedVersion: ScheduleVersion | null;
  items: BlockTokenItem[];
  userRole: 'admin' | 'scheduler';
}

export function QrSheetsClient({
  currentTerm,
  publishedVersion,
  items: initialItems,
  userRole,
}: QrSheetsClientProps) {
  const [items, setItems] = useState<BlockTokenItem[]>(initialItems);
  const [selectedBlockId, setSelectedBlockId] = useState<string>('all');
  const [isPending, startTransition] = useTransition();
  const [banner, setBanner] = useState<{ type: 'success' | 'error'; message: string } | null>(null);
  const [copiedTokenId, setCopiedTokenId] = useState<string | null>(null);

  // Filter items based on selector
  const displayItems =
    selectedBlockId === 'all'
      ? items
      : items.filter((item) => item.block.id === selectedBlockId);

  // Copy URL to clipboard
  const handleCopy = (url: string, tokenId: string) => {
    navigator.clipboard.writeText(url);
    setCopiedTokenId(tokenId);
    setTimeout(() => setCopiedTokenId(null), 2500);
  };

  // Revoke token
  const handleRevoke = (tokenId: string, blockName: string) => {
    if (
      !confirm(
        `Are you sure you want to REVOKE the public QR link for ${blockName}?\n\nOnce revoked, anyone scanning this QR code will see a "link no longer active" page.`
      )
    ) {
      return;
    }

    startTransition(async () => {
      try {
        const res = await revokeQrTokenAction(tokenId);
        if (res.success) {
          setBanner({
            type: 'success',
            message: `QR code link for ${blockName} has been revoked.`,
          });
          setItems((prev) =>
            prev.map((item) =>
              item.token?.id === tokenId
                ? {
                    ...item,
                    token: { ...item.token, revoked_at: res.revokedAt },
                  }
                : item
            )
          );
        }
      } catch (err: unknown) {
        setBanner({
          type: 'error',
          message: err instanceof Error ? err.message : 'Failed to revoke token.',
        });
      }
    });
  };

  // Trigger print
  const handlePrint = () => {
    window.print();
  };

  return (
    <div className="space-y-4 max-w-6xl mx-auto pb-5">
      {/* Top Banner Notice (Screen Only) */}
      {banner && (
        <div
          className={`print:hidden alert ${
            banner.type === 'success' ? 'alert-success' : 'alert-danger'
          } rounded-4 d-flex align-items-center justify-content-between py-3 px-4 mb-4 border-0 shadow-sm`}
        >
          <span className="small fw-semibold">{banner.message}</span>
          <button
            onClick={() => setBanner(null)}
            className="btn btn-sm btn-link text-decoration-none text-muted p-0"
          >
            ✕
          </button>
        </div>
      )}

      {/* Screen Controls Header (Screen Only) */}
      <div className="print:hidden d-flex flex-column flex-sm-row align-items-start align-items-sm-center justify-content-between gap-3 pb-3 border-bottom mb-4">
        <div>
          {publishedVersion && (
            <span className="pill-status pill-status-progress">
              Published v{publishedVersion.version_number}
            </span>
          )}
        </div>

        <div className="d-flex align-items-center gap-2">
          <Link
            href={`/${userRole}/schedule`}
            className="btn-ref-secondary"
          >
            &larr; Schedule Editor
          </Link>
          <button
            onClick={handlePrint}
            disabled={displayItems.length === 0}
            className="btn-ref-primary d-flex align-items-center gap-2"
          >
            <i className="bi bi-printer" />
            <span>Print QR Sheets</span>
          </button>
        </div>
      </div>

      {/* Filter and Overview Toolbar (Screen Only) */}
      <div className="print:hidden p-3 bg-white border border-white rounded-4 shadow-sm d-flex flex-column flex-sm-row align-items-start align-items-sm-center justify-content-between gap-3 mb-4">
        <div className="d-flex align-items-center gap-3">
          <label className="small fw-semibold text-secondary mb-0">Filter Block:</label>
          <select
            value={selectedBlockId}
            onChange={(e) => setSelectedBlockId(e.target.value)}
            className="form-select ref-form-control form-select-sm"
            style={{ minWidth: '220px' }}
          >
            <option value="all">All Blocks ({items.length} sheets)</option>
            {items.map((item) => {
              const prog = item.block.programs?.code || '';
              const sec = (item.block.section || '').trim();
              const yearStr = String(item.block.year_level || '');
              const label = /^Grade/i.test(sec) || sec.startsWith(yearStr) ? sec : `${yearStr}${sec}`;
              const blockLabel = prog ? `${prog} - ${label}` : label;
              return (
                <option key={item.block.id} value={item.block.id}>
                  {blockLabel} ({item.classesCount} classes)
                </option>
              );
            })}
          </select>
        </div>

        <div className="small text-secondary d-flex align-items-center gap-2">
          <span>Term: <strong className="text-dark">{currentTerm ? `${currentTerm.school_year} (${currentTerm.semester})` : 'N/A'}</strong></span>
          <span>&bull;</span>
          <span>Target: <strong className="text-dark">1 Page per Block</strong></span>
        </div>
      </div>

      {/* Screen Cards Grid (Screen Only) */}
      <div className="print:hidden row g-4 mb-4">
        {displayItems.map((item) => {
          const prog = item.block.programs?.code || '';
          const sec = (item.block.section || '').trim();
          const yearStr = String(item.block.year_level || '');
          const label = /^Grade/i.test(sec) || sec.startsWith(yearStr) ? sec : `${yearStr}${sec}`;
          const blockName = prog ? `${prog} - ${label}` : label;
          const isRevoked = Boolean(item.token?.revoked_at);

          return (
            <div key={item.block.id} className="col-12 col-md-6 col-lg-4">
              <div
                className={`p-4 rounded-5 bg-white border shadow-sm h-100 d-flex flex-column justify-content-between ${
                  isRevoked ? 'border-warning-subtle bg-light' : 'border-white'
                }`}
              >
                <div>
                  <div className="d-flex align-items-center justify-content-between border-bottom pb-3 mb-3">
                    <div>
                      <h2 className="fs-5 fw-bold text-dark m-0">{blockName}</h2>
                      <p className="small text-muted mb-0">{item.block.programs?.name}</p>
                    </div>
                    {isRevoked ? (
                      <span className="pill-status pill-status-pending">
                        Link Revoked
                      </span>
                    ) : (
                      <span className="pill-status pill-status-progress">
                        Active Link
                      </span>
                    )}
                  </div>

                  {/* QR Code Preview */}
                  <div className="py-3 d-flex flex-column align-items-center justify-content-center">
                    {item.qrDataUrl ? (
                      <div className="p-3 bg-light rounded-4 border inline-block shadow-xs">
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img
                          src={item.qrDataUrl}
                          alt={`QR code for ${blockName}`}
                          className="object-contain"
                          style={{ width: '150px', height: '150px' }}
                        />
                      </div>
                    ) : (
                      <div
                        className="rounded-4 bg-light border d-flex align-items-center justify-center text-center p-3 small text-muted"
                        style={{ width: '150px', height: '150px' }}
                      >
                        Token not yet generated
                      </div>
                    )}
                    <span className="small text-muted font-monospace mt-2">
                      {item.classesCount} weekly classes
                    </span>
                  </div>
                </div>

                {/* Action Buttons */}
                <div className="pt-3 border-top mt-3 d-flex flex-column gap-2">
                  <div className="d-flex align-items-center gap-2">
                    <a
                      href={item.publicUrl}
                      target="_blank"
                      rel="noreferrer"
                      className="btn btn-sm btn-light border rounded-pill px-3 shadow-sm flex-fill text-dark fw-semibold text-decoration-none text-center"
                    >
                      <span>View Public</span>
                      <i className="bi bi-box-arrow-up-right ms-1 small" />
                    </a>
                    <button
                      onClick={() => handleCopy(item.publicUrl, item.token?.id || '')}
                      className="btn btn-sm btn-light border rounded-pill px-3 shadow-sm text-dark fw-semibold"
                      title="Copy Public Link"
                    >
                      {copiedTokenId === item.token?.id ? 'Copied! ✓' : 'Copy Link'}
                    </button>
                  </div>

                  {item.token && !isRevoked && (
                    <button
                      onClick={() => handleRevoke(item.token!.id, blockName)}
                      disabled={isPending}
                      className="btn btn-sm btn-outline-danger rounded-pill px-3 fw-semibold w-100"
                    >
                      Deactivate / Revoke Link
                    </button>
                  )}
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {/* ========================================================================= */}
      {/* PRINT-ONLY SHEETS: One Full Clean Page Per Block for Wall Posting         */}
      {/* ========================================================================= */}
      <div className="hidden print:block print:w-full print:m-0 print:p-0">
        <style dangerouslySetInnerHTML={{ __html: `
          @media print {
            body {
              background: white !important;
              color: black !important;
              margin: 0 !important;
              padding: 0 !important;
            }
            .print-page-sheet {
              page-break-after: always;
              break-after: page;
              min-height: 98vh;
              display: flex;
              flex-direction: column;
              justify-content: space-between;
              align-items: center;
              padding: 3rem 2rem;
              box-sizing: border-box;
              text-align: center;
              background: white !important;
              color: #0f172a !important;
            }
            .print-page-sheet:last-child {
              page-break-after: avoid;
              break-after: avoid;
            }
          }
        `}} />

        {displayItems.map((item) => {
          const prog = item.block.programs?.code || '';
          const sec = (item.block.section || '').trim();
          const yearStr = String(item.block.year_level || '');
          const label = /^Grade/i.test(sec) || sec.startsWith(yearStr) ? sec : `${yearStr}${sec}`;
          const blockName = prog ? `${prog} - ${label}` : label;
          const isRevoked = Boolean(item.token?.revoked_at);

          return (
            <div key={`print-${item.block.id}`} className="print-page-sheet">
              {/* Institution & Department Header */}
              <div className="w-full border-b-2 border-slate-900 pb-6 space-y-1">
                <p className="text-sm font-bold tracking-widest uppercase text-slate-600">
                  ALTERSCHED ACADEMIC TIMETABLE
                </p>
                <h1 className="text-2xl font-black text-slate-950 tracking-tight">
                  OFFICIAL CLASS SCHEDULE
                </h1>
                <p className="text-sm font-semibold text-slate-700">
                  {currentTerm ? `School Year ${currentTerm.school_year} — ${currentTerm.semester}` : 'Academic Term'}
                </p>
              </div>

              {/* Large Section Block Focus */}
              <div className="my-6 space-y-2">
                <div className="inline-block px-8 py-2 rounded-2xl bg-slate-100 border border-slate-300">
                  <p className="text-xs uppercase font-bold tracking-wider text-slate-500">
                    CLASS BLOCK
                  </p>
                  <p className="text-5xl font-black text-slate-950 tracking-tight">
                    {blockName}
                  </p>
                </div>
                {item.block.programs?.name && (
                  <p className="text-base font-semibold text-slate-700 max-w-lg mx-auto">
                    {item.block.programs.name}
                  </p>
                )}
              </div>

              {/* High-Resolution QR Code */}
              <div className="my-6 flex flex-col items-center">
                {item.qrDataUrl ? (
                  <div className="p-4 bg-white border-4 border-slate-900 rounded-3xl shadow-xl inline-block">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={item.qrDataUrl}
                      alt={`QR Code for ${blockName}`}
                      className="w-72 h-72 object-contain"
                    />
                  </div>
                ) : (
                  <div className="w-72 h-72 border-2 border-dashed border-slate-400 rounded-3xl flex items-center justify-center text-sm font-bold text-slate-400">
                    QR Code Not Available
                  </div>
                )}
                {isRevoked && (
                  <p className="text-sm font-bold text-red-600 mt-2">
                    NOTICE: THIS CODE HAS BEEN REVOKED
                  </p>
                )}
              </div>

              {/* Instructions and Fallback URL */}
              <div className="w-full max-w-md space-y-2 bg-slate-50 p-4 rounded-2xl border border-slate-200">
                <p className="text-sm font-bold text-slate-900">
                  📱 Scan with your smartphone camera to view schedule
                </p>
                <p className="text-xs text-slate-600 leading-relaxed font-mono break-all">
                  {item.publicUrl}
                </p>
              </div>

              {/* Sheet Footer */}
              <div className="w-full pt-6 border-t border-slate-300 flex items-center justify-between text-[11px] text-slate-500 font-medium">
                <span>AlterSched System &bull; Version v{publishedVersion?.version_number || 1}</span>
                <span>
                  Published:{' '}
                  {publishedVersion?.published_at
                    ? new Date(publishedVersion.published_at).toLocaleDateString()
                    : new Date().toLocaleDateString()}
                </span>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
