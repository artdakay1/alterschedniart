// src/app/scheduler/generate/GenerateClient.tsx
'use client';

import React, { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import type { AcademicTerm, Block } from '@/types/database';
import { generateAiDraftAction } from './actions';
import type { SchedulerPreferences, BlockDraftResult } from '@/lib/ai';

interface GenerateClientProps {
  terms: AcademicTerm[];
  blocks: (Block & { programs?: { code: string; name: string } | null })[];
  currentTermId: string;
}

type BlockStatus = 'queued' | 'generating' | 'validating' | 'writing' | 'done' | 'failed';

export function GenerateClient({
  terms,
  blocks,
  currentTermId,
}: GenerateClientProps) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  const [selectedTermId, setSelectedTermId] = useState(currentTermId);
  const [selectedBlockIds, setSelectedBlockIds] = useState<string[]>(
    blocks.map((b) => b.id)
  );

  const [preferences, setPreferences] = useState<SchedulerPreferences>({
    noClassesAfter5pm: false,
    preferMornings: true,
    allowSaturday: false,
    customNotes: '',
  });

  const [blockProgress, setBlockProgress] = useState<Record<string, BlockStatus>>({});
  const [generationResults, setGenerationResults] = useState<BlockDraftResult[] | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const handleToggleBlock = (blockId: string) => {
    setSelectedBlockIds((prev) =>
      prev.includes(blockId)
        ? prev.filter((id) => id !== blockId)
        : [...prev, blockId]
    );
  };

  const handleSelectAllBlocks = () => {
    if (selectedBlockIds.length === blocks.length) {
      setSelectedBlockIds([]);
    } else {
      setSelectedBlockIds(blocks.map((b) => b.id));
    }
  };

  const handleGenerate = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMessage(null);
    setGenerationResults(null);

    if (selectedBlockIds.length === 0) {
      setErrorMessage('Please select at least one student block.');
      return;
    }

    // Initialize progress indicators
    const initialProgress: Record<string, BlockStatus> = {};
    for (const bId of selectedBlockIds) {
      initialProgress[bId] = 'generating';
    }
    setBlockProgress(initialProgress);

    startTransition(async () => {
      try {
        const response = await generateAiDraftAction(
          selectedTermId,
          selectedBlockIds,
          preferences
        );

        setGenerationResults(response.results);

        // Mark all as done
        const finalProgress: Record<string, BlockStatus> = {};
        for (const res of response.results) {
          finalProgress[res.blockId] = res.success ? 'done' : 'failed';
        }
        setBlockProgress(finalProgress);

        // Route straight to Phase 3 schedule editor with the populated timetable!
        setTimeout(() => {
          router.push(
            `/scheduler/schedule?termId=${selectedTermId}&versionId=${response.versionId}&blockId=${response.firstBlockId || selectedBlockIds[0] || ''}`
          );
          router.refresh();
        }, 800);
      } catch (err: unknown) {
        setErrorMessage(
          err instanceof Error ? err.message : 'AI drafting pipeline encountered an error.'
        );
        const errProgress: Record<string, BlockStatus> = {};
        for (const bId of selectedBlockIds) {
          errProgress[bId] = 'failed';
        }
        setBlockProgress(errProgress);
      }
    });
  };

  return (
    <div className="space-y-4">
      {errorMessage && (
        <div className="alert alert-danger rounded-4 py-3 px-4 mb-4 small d-flex justify-content-between align-items-center border-0 shadow-sm">
          <span>{errorMessage}</span>
          <button
            onClick={() => setErrorMessage(null)}
            className="btn btn-sm btn-link text-decoration-none text-muted p-0"
          >
            ✕
          </button>
        </div>
      )}

      <form onSubmit={handleGenerate} className="space-y-4">
        <div className="bg-white rounded-5 shadow-sm p-4 p-md-5 border border-white space-y-4">
          {/* Academic Term */}
          <div className="mb-4">
            <label className="form-label small fw-semibold text-secondary mb-1">
              Academic Term
            </label>
            <select
              value={selectedTermId}
              onChange={(e) => setSelectedTermId(e.target.value)}
              className="form-select ref-form-control w-100"
              style={{ maxWidth: '360px' }}
            >
              {terms.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.school_year} ({t.semester}) {t.is_current ? '★ Current' : ''}
                </option>
              ))}
            </select>
          </div>

          {/* Target Student Blocks */}
          <div className="mb-4">
            <div className="d-flex align-items-center justify-content-between mb-2">
              <label className="form-label small fw-semibold text-secondary mb-0">
                Target Student Blocks ({selectedBlockIds.length} of {blocks.length} selected)
              </label>
              <button
                type="button"
                onClick={handleSelectAllBlocks}
                className="btn btn-sm btn-link text-primary text-decoration-none fw-semibold p-0"
              >
                {selectedBlockIds.length === blocks.length ? 'Deselect All' : 'Select All'}
              </button>
            </div>

            <div className="row g-3">
              {blocks.map((b) => {
                const isSelected = selectedBlockIds.includes(b.id);
                const status = blockProgress[b.id];

                return (
                  <div key={b.id} className="col-12 col-sm-6 col-md-4">
                    <div
                      onClick={() => !isPending && handleToggleBlock(b.id)}
                      className={`p-3 rounded-4 border cursor-pointer transition d-flex align-items-center justify-content-between ${
                        isSelected
                          ? 'bg-light border-primary shadow-xs'
                          : 'bg-white border-light-subtle'
                      }`}
                      style={{ cursor: 'pointer' }}
                    >
                      <div className="d-flex align-items-center gap-3">
                        <input
                          type="checkbox"
                          checked={isSelected}
                          onChange={() => {}}
                          className="form-check-input mt-0 pointer-events-none"
                        />
                        <div>
                          <div className="fw-bold text-dark small">
                            {b.programs?.code || 'Block'} - {b.section.startsWith(String(b.year_level)) || /^Grade/i.test(b.section) ? b.section : `${b.year_level}${b.section}`}
                          </div>
                          <div className="small text-muted" style={{ fontSize: '11px' }}>
                            {b.programs?.name || 'Active Cohort'}
                          </div>
                        </div>
                      </div>

                      {status && (
                        <span
                          className={`pill-status ${
                            status === 'done'
                              ? 'pill-status-progress'
                              : status === 'generating'
                              ? 'pill-status-pending'
                              : status === 'failed'
                              ? 'pill-status-archived text-danger'
                              : 'pill-status-archived'
                          }`}
                        >
                          {status}
                        </span>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Preferences */}
          <div className="pt-3 border-top mb-4">
            <h3 className="small fw-bold text-dark uppercase mb-3" style={{ fontSize: '12px' }}>
              Scheduling Heuristic Preferences
            </h3>
            <div className="row g-3">
              <div className="col-12 col-md-4">
                <label className="d-flex align-items-center gap-2.5 p-3 rounded-4 bg-light border cursor-pointer h-100">
                  <input
                    type="checkbox"
                    checked={preferences.preferMornings}
                    onChange={(e) =>
                      setPreferences((prev) => ({
                        ...prev,
                        preferMornings: e.target.checked,
                      }))
                    }
                    className="form-check-input mt-0"
                  />
                  <span className="small text-dark fw-medium">
                    Prefer morning slots (08:00 - 12:00)
                  </span>
                </label>
              </div>

              <div className="col-12 col-md-4">
                <label className="d-flex align-items-center gap-2.5 p-3 rounded-4 bg-light border cursor-pointer h-100">
                  <input
                    type="checkbox"
                    checked={preferences.noClassesAfter5pm}
                    onChange={(e) =>
                      setPreferences((prev) => ({
                        ...prev,
                        noClassesAfter5pm: e.target.checked,
                      }))
                    }
                    className="form-check-input mt-0"
                  />
                  <span className="small text-dark fw-medium">
                    No classes after 5:00 PM
                  </span>
                </label>
              </div>

              <div className="col-12 col-md-4">
                <label className="d-flex align-items-center gap-2.5 p-3 rounded-4 bg-light border cursor-pointer h-100">
                  <input
                    type="checkbox"
                    checked={preferences.allowSaturday}
                    onChange={(e) =>
                      setPreferences((prev) => ({
                        ...prev,
                        allowSaturday: e.target.checked,
                      }))
                    }
                    className="form-check-input mt-0"
                  />
                  <span className="small text-dark fw-medium">
                    Allow Saturday sessions
                  </span>
                </label>
              </div>
            </div>

            <div className="mt-3">
              <label className="form-label small fw-semibold text-secondary mb-1">
                Custom Scheduler Notes / Constraints
              </label>
              <textarea
                rows={2}
                value={preferences.customNotes}
                onChange={(e) =>
                  setPreferences((prev) => ({
                    ...prev,
                    customNotes: e.target.value,
                  }))
                }
                placeholder="e.g. Prioritize computer labs for programming courses on Tuesdays and Thursdays."
                className="form-control ref-form-control"
              />
            </div>
          </div>

          {/* Action Button */}
          <div className="pt-3 border-top d-flex align-items-center justify-content-between">
            <div className="small text-muted">
              Validated automatically with the Conflict Engine before writing.
            </div>

            <button
              type="submit"
              disabled={isPending || selectedBlockIds.length === 0}
              className="btn-ref-primary px-4 py-2.5 d-flex align-items-center gap-2"
            >
              {isPending ? (
                <>
                  <span className="spinner-border spinner-border-sm" role="status" aria-hidden="true" />
                  <span>Synthesizing Draft Schedule...</span>
                </>
              ) : (
                <>
                  <i className="bi bi-magic" />
                  <span>Generate Schedule Draft</span>
                </>
              )}
            </button>
          </div>
        </div>
      </form>

      {/* Generation Results Summary */}
      {generationResults && (
        <div className="bg-white rounded-5 shadow-sm p-4 border border-white space-y-3">
          <h3 className="fs-5 fw-bold text-dark m-0">
            Generation Results
          </h3>
          <div className="row g-3">
            {generationResults.map((res) => (
              <div key={res.blockId} className="col-12 col-md-6">
                <div className="p-3 rounded-4 border bg-light">
                  <div className="d-flex align-items-center justify-content-between mb-2">
                    <span className="fw-bold text-dark small">
                      {res.blockName}
                    </span>
                    <span className="pill-status pill-status-progress">
                      {res.entriesWritten.length} sessions placed
                    </span>
                  </div>

                  {res.unassigned.length > 0 && (
                    <div className="pt-2 border-top mt-2">
                      <span className="small fw-bold text-warning">
                        Unassigned Hours ({res.unassigned.length}):
                      </span>
                      <ul className="mt-1 mb-0 ps-3 small text-muted">
                        {res.unassigned.map((u, i) => (
                          <li key={i}>
                            {u.subjectCode}: {u.remainingHours}h remaining ({u.reason})
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
