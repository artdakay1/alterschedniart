// src/components/FormModal.tsx
'use client';

import React, { useEffect } from 'react';

interface FormModalProps {
  isOpen: boolean;
  onClose: () => void;
  title: string;
  description?: string;
  onSubmit: (e: React.FormEvent) => void;
  isSubmitting?: boolean;
  submitLabel?: string;
  error?: string | null;
  size?: 'sm' | 'md' | 'lg' | 'xl';
  maxWidth?: string;
  customFooter?: React.ReactNode;
  children: React.ReactNode;
}

export function FormModal({
  isOpen,
  onClose,
  title,
  description,
  onSubmit,
  isSubmitting = false,
  submitLabel = 'Save Changes',
  error,
  size = 'lg',
  maxWidth,
  customFooter,
  children,
}: FormModalProps) {
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && isOpen && !isSubmitting) {
        onClose();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, isSubmitting, onClose]);

  if (!isOpen) return null;

  const sizeClass = size === 'xl' ? 'modal-xl' : size === 'sm' ? 'modal-sm' : size === 'md' ? 'modal-md' : 'modal-lg';

  return (
    <div
      className="modal fade show d-block"
      tabIndex={-1}
      role="dialog"
      aria-modal="true"
      style={{ backgroundColor: 'rgba(15, 23, 42, 0.6)', backdropFilter: 'blur(3px)' }}
    >
      <div
        className={`modal-dialog modal-dialog-centered ${sizeClass}`}
        role="document"
        style={maxWidth ? { maxWidth, width: '96vw' } : undefined}
      >
        <div className="modal-content card shadow-lg border-0 bg-white overflow-hidden">
          {/* Modal Header */}
          <div className="modal-header py-3 px-4 bg-light border-bottom d-flex justify-content-between align-items-center">
            <div>
              <h2 className="modal-title h5 fw-bold text-dark mb-0">{title}</h2>
              {description && (
                <p className="text-secondary small mb-0 mt-0.5">{description}</p>
              )}
            </div>
            <button
              type="button"
              className="btn-close"
              aria-label="Close"
              onClick={onClose}
              disabled={isSubmitting}
            />
          </div>

          {/* Error Alert */}
          {error && (
            <div className="alert alert-danger py-2 px-3 small mx-4 mt-3 mb-0" role="alert">
              <i className="bi bi-exclamation-octagon me-1.5" />
              <span>{error}</span>
            </div>
          )}

          {/* Form Content */}
          <form onSubmit={onSubmit}>
            <div className="modal-body p-4 space-y-3" style={{ maxHeight: 'calc(80vh - 140px)', overflowY: 'auto' }}>
              {children}
            </div>

            {/* Modal Footer */}
            <div className="modal-footer py-2.5 px-4 bg-light border-top d-flex justify-content-end gap-2">
              {customFooter ? (
                customFooter
              ) : (
                <>
                  <button
                    type="button"
                    onClick={onClose}
                    disabled={isSubmitting}
                    className="btn btn-sm btn-outline-secondary px-3"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    disabled={isSubmitting}
                    className="btn btn-sm btn-primary px-3 fw-semibold d-inline-flex align-items-center gap-2"
                  >
                    {isSubmitting ? (
                      <>
                        <span className="spinner-border spinner-border-sm" role="status" aria-hidden="true" />
                        <span>Saving...</span>
                      </>
                    ) : (
                      <span>{submitLabel}</span>
                    )}
                  </button>
                </>
              )}
            </div>
          </form>
        </div>
      </div>
    </div>
  );
}
