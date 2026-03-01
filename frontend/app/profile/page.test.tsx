import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import ProfilePage from './page';
import { AuthValidationError } from '@/lib/auth';

const mockUseAuth = vi.fn();

vi.mock('@/components/RequireAuth', () => ({
  default: ({ children }: { children: ReactNode }) => <>{children}</>,
}));

vi.mock('@/lib/AuthContext', () => ({
  useAuth: () => mockUseAuth(),
}));

vi.mock('@/components/i18n/I18nProvider', () => ({
  useI18n: () => ({
    t: (_key: string, fallback?: string) => fallback ?? _key,
    locale: 'en',
    direction: 'ltr',
    dictionary: {},
  }),
}));

describe('ProfilePage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders current user profile values', () => {
    mockUseAuth.mockReturnValue({
      user: {
        pk: 1,
        email: 'reader@example.com',
        first_name: 'Reader',
        last_name: 'User',
        username: 'reader',
      },
      isLoading: false,
      updateProfile: vi.fn(),
    });

    render(<ProfilePage />);

    expect(screen.getByLabelText('First name')).toHaveValue('Reader');
    expect(screen.getByLabelText('Last name')).toHaveValue('User');
    expect(screen.getByLabelText('Email')).toHaveValue('reader@example.com');
  });

  it('disables submit when there are no changes', () => {
    mockUseAuth.mockReturnValue({
      user: {
        pk: 1,
        email: 'reader@example.com',
        first_name: 'Reader',
        last_name: 'User',
        username: 'reader',
      },
      isLoading: false,
      updateProfile: vi.fn(),
    });

    render(<ProfilePage />);
    expect(screen.getByRole('button', { name: 'Save changes' })).toBeDisabled();
  });

  it('submits profile changes and shows success feedback', async () => {
    const updateProfile = vi.fn().mockResolvedValue(undefined);
    mockUseAuth.mockReturnValue({
      user: {
        pk: 1,
        email: 'reader@example.com',
        first_name: 'Reader',
        last_name: 'User',
        username: 'reader',
      },
      isLoading: false,
      updateProfile,
    });

    render(<ProfilePage />);

    const userInput = userEvent.setup();
    await userInput.clear(screen.getByLabelText('First name'));
    await userInput.type(screen.getByLabelText('First name'), 'Updated');
    await userInput.click(screen.getByRole('button', { name: 'Save changes' }));

    await waitFor(() => {
      expect(updateProfile).toHaveBeenCalledWith({
        first_name: 'Updated',
        last_name: 'User',
        email: 'reader@example.com',
      });
    });

    expect(screen.getByText('Profile updated successfully.')).toBeInTheDocument();
  });

  it('renders field-level validation error returned by api', async () => {
    const updateProfile = vi
      .fn()
      .mockRejectedValue(new AuthValidationError('Email already exists.', { email: 'Email already exists.' }));

    mockUseAuth.mockReturnValue({
      user: {
        pk: 1,
        email: 'reader@example.com',
        first_name: 'Reader',
        last_name: 'User',
        username: 'reader',
      },
      isLoading: false,
      updateProfile,
    });

    render(<ProfilePage />);

    const userInput = userEvent.setup();
    await userInput.clear(screen.getByLabelText('Email'));
    await userInput.type(screen.getByLabelText('Email'), 'duplicate@example.com');
    await userInput.click(screen.getByRole('button', { name: 'Save changes' }));

    await waitFor(() => {
      expect(screen.getByText('Email already exists.')).toBeInTheDocument();
    });
  });
});
