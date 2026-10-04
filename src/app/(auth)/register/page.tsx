'use client';

import React, { useState } from 'react';
import Link from 'next/link';
import { createClient } from '@/lib/supabase/client';
import { registerSchema, type RegisterInput } from '@/lib/validators/auth';

export default function RegisterPage() {
  const [formData, setFormData] = useState<RegisterInput>({
    fullName: '',
    email: '',
    password: '',
    confirmPassword: '',
  });
  const [errors, setErrors] = useState<Partial<Record<keyof RegisterInput, string>>>({});
  const [authError, setAuthError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [isSubmittedSuccess, setIsSubmittedSuccess] = useState(false);

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const { name, value } = e.target;
    setFormData((prev) => ({ ...prev, [name]: value }));
    if (errors[name as keyof RegisterInput]) {
      setErrors((prev) => ({ ...prev, [name]: undefined }));
    }
    setAuthError(null);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setAuthError(null);

    // 1. Validate with Zod
    const result = registerSchema.safeParse(formData);
    if (!result.success) {
      const fieldErrors: Partial<Record<keyof RegisterInput, string>> = {};
      for (const issue of result.error.issues) {
        const field = issue.path[0] as keyof RegisterInput;
        if (field && !fieldErrors[field]) {
          fieldErrors[field] = issue.message;
        }
      }
      setErrors(fieldErrors);
      return;
    }

    setIsLoading(true);

    try {
      const supabase = createClient();

      // 2. Perform sign up
      // Note: We deliberately only pass full_name in user metadata.
      // Even if a client tampered with metadata to send role='admin', our database trigger
      // strictly ignores it and forces role='instructor' and status='pending'.
      const { error } = await supabase.auth.signUp({
        email: formData.email,
        password: formData.password,
        options: {
          data: {
            full_name: formData.fullName,
          },
        },
      });

      if (error) {
        setAuthError(error.message || 'Failed to complete registration. Please try again.');
        setIsLoading(false);
        return;
      }

      // 3. Immediately sign out to prevent auto-login into the dashboard
      // as required: "does not log the user into the dashboard"
      await supabase.auth.signOut();

      setIsSubmittedSuccess(true);
      setIsLoading(false);
    } catch {
      setAuthError('An unexpected error occurred during registration. Please try again.');
      setIsLoading(false);
    }
  };

  if (isSubmittedSuccess) {
    return (
      <div className="text-center py-2">
        <div
          className="mx-auto d-flex align-items-center justify-content-center rounded-circle mb-3"
          style={{ width: '56px', height: '56px', background: '#fef3e7', color: '#f28b24' }}
        >
          <svg
            className="bi"
            width="28"
            height="28"
            fill="currentColor"
            viewBox="0 0 16 16"
          >
            <path d="M8 15A7 7 0 1 1 8 1a7 7 0 0 1 0 14zm0 1A8 8 0 1 0 8 0a8 8 0 0 0 0 16z"/>
            <path d="M8 4a.5.5 0 0 1 .5.5v3h3a.5.5 0 0 1 0 1h-3.5a.5.5 0 0 1-.5-.5v-4A.5.5 0 0 1 8 4z"/>
          </svg>
        </div>

        <h2 className="fs-4 fw-bold text-dark mb-2">
          Registration Submitted
        </h2>

        <div className="p-3 rounded-4 bg-light border text-secondary small mb-4 text-start">
          <p className="fw-bold text-dark mb-1">
            Your account is pending admin approval.
          </p>
          <p className="mb-0 text-muted" style={{ fontSize: '12px' }}>
            Instructor accounts require manual verification by an administrator before you can log in.
            You will be able to access the system once approved.
          </p>
        </div>

        <Link
          href="/login"
          className="btn-ref-primary d-inline-block text-center text-decoration-none w-100 py-2.5"
        >
          Return to Sign In
        </Link>
      </div>
    );
  }

  return (
    <div>
      <div className="mb-4">
        <h2 className="fs-4 fw-bold text-dark mb-1">
          Instructor Registration
        </h2>
        <p className="small text-secondary mb-0">
          Apply for an instructor scheduling account in the BSIT department.
        </p>
      </div>

      {authError && (
        <div
          role="alert"
          className="alert alert-danger rounded-4 py-2.5 px-3 mb-4 small d-flex align-items-center gap-2 border-0 shadow-sm"
        >
          <svg
            className="bi shrink-0"
            width="18"
            height="18"
            fill="currentColor"
            viewBox="0 0 16 16"
          >
            <path d="M8.982 1.566a1.13 1.13 0 0 0-1.96 0L.165 13.233c-.457.778.091 1.767.98 1.767h13.713c.889 0 1.438-.99.98-1.767L8.982 1.566zM8 5c.535 0 .954.462.9.995l-.35 3.507a.552.552 0 0 1-1.1 0L7.1 5.995A.905.905 0 0 1 8 5zm.002 6a1 1 0 1 1 0 2 1 1 0 0 1 0-2z"/>
          </svg>
          <span className="flex-1">{authError}</span>
        </div>
      )}

      <form onSubmit={handleSubmit} className="d-flex flex-column gap-3">
        <div>
          <label
            htmlFor="fullName"
            className="form-label small fw-semibold text-secondary mb-1"
          >
            Full Name
          </label>
          <input
            id="fullName"
            name="fullName"
            type="text"
            autoComplete="name"
            value={formData.fullName}
            onChange={handleChange}
            placeholder="Prof. Juan Dela Cruz"
            className={`form-control ref-form-control ${errors.fullName ? 'is-invalid' : ''}`}
          />
          {errors.fullName && (
            <div className="invalid-feedback small">{errors.fullName}</div>
          )}
        </div>

        <div>
          <label
            htmlFor="email"
            className="form-label small fw-semibold text-secondary mb-1"
          >
            Email Address
          </label>
          <input
            id="email"
            name="email"
            type="email"
            autoComplete="email"
            value={formData.email}
            onChange={handleChange}
            placeholder="juan.delacruz@altersched.edu"
            className={`form-control ref-form-control ${errors.email ? 'is-invalid' : ''}`}
          />
          {errors.email && (
            <div className="invalid-feedback small">{errors.email}</div>
          )}
        </div>

        <div>
          <label
            htmlFor="password"
            className="form-label small fw-semibold text-secondary mb-1"
          >
            Password
          </label>
          <input
            id="password"
            name="password"
            type="password"
            autoComplete="new-password"
            value={formData.password}
            onChange={handleChange}
            placeholder="Min. 8 characters"
            className={`form-control ref-form-control ${errors.password ? 'is-invalid' : ''}`}
          />
          {errors.password && (
            <div className="invalid-feedback small">{errors.password}</div>
          )}
        </div>

        <div>
          <label
            htmlFor="confirmPassword"
            className="form-label small fw-semibold text-secondary mb-1"
          >
            Confirm Password
          </label>
          <input
            id="confirmPassword"
            name="confirmPassword"
            type="password"
            autoComplete="new-password"
            value={formData.confirmPassword}
            onChange={handleChange}
            placeholder="Re-enter your password"
            className={`form-control ref-form-control ${errors.confirmPassword ? 'is-invalid' : ''}`}
          />
          {errors.confirmPassword && (
            <div className="invalid-feedback small">{errors.confirmPassword}</div>
          )}
        </div>

        <button
          type="submit"
          disabled={isLoading}
          className="btn-ref-primary w-100 py-2.5 mt-2 d-flex align-items-center justify-center gap-2"
        >
          {isLoading ? 'Submitting Application...' : 'Register as Instructor'}
        </button>
      </form>

      <div className="mt-4 pt-3 border-top text-center">
        <p className="small text-secondary mb-0">
          Already have an account?{' '}
          <Link
            href="/login"
            className="text-primary fw-semibold text-decoration-none"
          >
            Sign in
          </Link>
        </p>
      </div>
    </div>
  );
}
