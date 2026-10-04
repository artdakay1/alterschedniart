'use client';

import React, { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import { loginSchema, type LoginInput } from '@/lib/validators/auth';

export default function LoginPage() {
  const router = useRouter();
  const [formData, setFormData] = useState<LoginInput>({
    email: '',
    password: '',
  });
  const [errors, setErrors] = useState<Partial<Record<keyof LoginInput, string>>>({});
  const [authError, setAuthError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const { name, value } = e.target;
    setFormData((prev) => ({ ...prev, [name]: value }));
    if (errors[name as keyof LoginInput]) {
      setErrors((prev) => ({ ...prev, [name]: undefined }));
    }
    setAuthError(null);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setAuthError(null);

    // 1. Zod client validation
    const result = loginSchema.safeParse(formData);
    if (!result.success) {
      const fieldErrors: Partial<Record<keyof LoginInput, string>> = {};
      for (const issue of result.error.issues) {
        const field = issue.path[0] as keyof LoginInput;
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

      // 2. Supabase Auth sign-in
      const { data: authData, error: signInError } =
        await supabase.auth.signInWithPassword({
          email: formData.email,
          password: formData.password,
        });

      if (signInError || !authData.user) {
        setAuthError(
          signInError?.message === 'Invalid login credentials'
            ? 'Invalid email or password. Please try again.'
            : signInError?.message || 'Failed to sign in. Please verify your credentials.'
        );
        setIsLoading(false);
        return;
      }

      // 3. Query the user's profile to verify account status
      const { data: profile, error: profileError } = await supabase
        .from('profiles')
        .select('role, status, full_name')
        .eq('id', authData.user.id)
        .single();

      if (profileError || !profile) {
        await supabase.auth.signOut();
        setAuthError('Unable to load user profile. Please contact the administrator.');
        setIsLoading(false);
        return;
      }

      // 4. Block login if status is not "active"
      if (profile.status === 'pending') {
        await supabase.auth.signOut();
        setAuthError(
          'Your account is pending administrator approval. Please wait for an admin to activate your account.'
        );
        setIsLoading(false);
        return;
      }

      if (profile.status === 'rejected') {
        await supabase.auth.signOut();
        setAuthError(
          'Your account registration has been rejected. Please contact the department administrator.'
        );
        setIsLoading(false);
        return;
      }

      if (profile.status === 'disabled') {
        await supabase.auth.signOut();
        setAuthError(
          'Your account has been disabled. Please contact the department administrator.'
        );
        setIsLoading(false);
        return;
      }

      // Active user: redirect by role (/admin, /scheduler, /instructor)
      if (profile.role === 'admin') {
        router.push('/admin');
      } else if (profile.role === 'scheduler') {
        router.push('/scheduler');
      } else {
        router.push('/instructor');
      }
      router.refresh();
    } catch {
      setAuthError('An unexpected error occurred during sign in. Please try again.');
      setIsLoading(false);
    }
  };

  return (
    <div>
      <div className="mb-4">
        <h2 className="fs-4 fw-bold text-dark mb-1">Sign In</h2>
        <p className="small text-secondary mb-0">
          Access your AlterSched account (Admin, Scheduler, or Instructor)
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
            placeholder="instructor@altersched.edu"
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
            autoComplete="current-password"
            value={formData.password}
            onChange={handleChange}
            placeholder="••••••••"
            className={`form-control ref-form-control ${errors.password ? 'is-invalid' : ''}`}
          />
          {errors.password && (
            <div className="invalid-feedback small">{errors.password}</div>
          )}
        </div>

        <button
          type="submit"
          disabled={isLoading}
          className="btn-ref-primary w-100 py-2.5 mt-2 d-flex align-items-center justify-center gap-2"
        >
          {isLoading ? 'Signing in...' : 'Sign In'}
        </button>
      </form>

      <div className="mt-4 pt-3 border-top text-center">
        <p className="small text-secondary mb-0">
          New instructor?{' '}
          <Link
            href="/register"
            className="text-primary fw-semibold text-decoration-none"
          >
            Create an account
          </Link>
        </p>
      </div>
    </div>
  );
}
