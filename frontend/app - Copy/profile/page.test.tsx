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

const baseUser = {
  pk: 1,
  email: 'reader@example.com',
  first_name: 'Reader',
  last_name: 'User',
  username: 'reader',
  avatar: 'https://example.com/old-avatar.jpg',
};

function mockAuthState(overrides?: {
  isLoading?: boolean;
  updateProfile?: ReturnType<typeof vi.fn>;
  user?: typeof baseUser;
}) {
  mockUseAuth.mockReturnValue({
    user: overrides?.user ?? baseUser,
    isLoading: overrides?.isLoading ?? false,
    updateProfile: overrides?.updateProfile ?? vi.fn(),
  });
}

describe('ProfilePage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders current user profile values including avatar', () => {
    mockAuthState();

    render(<ProfilePage />);

    expect(screen.getByLabelText('First name')).toHaveValue('Reader');
    expect(screen.getByLabelText('Last name')).toHaveValue('User');
    expect(screen.getByLabelText('Email')).toHaveValue('reader@example.com');
    expect(screen.getByLabelText('Avatar URL (optional)')).toHaveValue('https://example.com/old-avatar.jpg');
  });

  it('disables submit when there are no profile or password changes', () => {
    mockAuthState();

    render(<ProfilePage />);

    expect(screen.getByRole('button', { name: 'Save changes' })).toBeDisabled();
  });

  it('submits profile changes with avatar and shows success feedback', async () => {
    const updateProfile = vi.fn().mockResolvedValue(undefined);
    mockAuthState({ updateProfile });

    render(<ProfilePage />);

    const userInput = userEvent.setup();
    await userInput.clear(screen.getByLabelText('First name'));
    await userInput.type(screen.getByLabelText('First name'), 'Updated');
    await userInput.clear(screen.getByLabelText('Avatar URL (optional)'));
    await userInput.type(screen.getByLabelText('Avatar URL (optional)'), 'https://example.com/new-avatar.jpg');
    await userInput.click(screen.getByRole('button', { name: 'Save changes' }));

    await waitFor(() => {
      expect(updateProfile).toHaveBeenCalledWith({
        first_name: 'Updated',
        last_name: 'User',
        email: 'reader@example.com',
        avatar: 'https://example.com/new-avatar.jpg',
      });
    });

    expect(screen.getByText('Profile updated successfully.')).toBeInTheDocument();
  });

  it('submits password update without profile changes and clears password fields', async () => {
    const updateProfile = vi.fn().mockResolvedValue(undefined);
    mockAuthState({ updateProfile });

    render(<ProfilePage />);

    const userInput = userEvent.setup();
    await userInput.type(screen.getByLabelText('Current password'), 'ReaderPass123!');
    await userInput.type(screen.getByLabelText('New password'), 'ReaderPass456!');
    await userInput.type(screen.getByLabelText('Confirm new password'), 'ReaderPass456!');
    await userInput.click(screen.getByRole('button', { name: 'Save changes' }));

    await waitFor(() => {
      expect(updateProfile).toHaveBeenCalledWith({
        current_password: 'ReaderPass123!',
        new_password: 'ReaderPass456!',
        new_password_confirm: 'ReaderPass456!',
      });
    });

    await waitFor(() => {
      expect(screen.getByLabelText('Current password')).toHaveValue('');
      expect(screen.getByLabelText('New password')).toHaveValue('');
      expect(screen.getByLabelText('Confirm new password')).toHaveValue('');
    });
  });

  it('blocks submit when password fields are only partially filled', async () => {
    const updateProfile = vi.fn();
    mockAuthState({ updateProfile });

    render(<ProfilePage />);

    const userInput = userEvent.setup();
    await userInput.clear(screen.getByLabelText('First name'));
    await userInput.type(screen.getByLabelText('First name'), 'Reader Updated');
    await userInput.type(screen.getByLabelText('New password'), 'ReaderPass456!');
    await userInput.click(screen.getByRole('button', { name: 'Save changes' }));

    expect(screen.getByText('Current password is required.')).toBeInTheDocument();
    expect(screen.getByText('Please confirm your new password.')).toBeInTheDocument();
    expect(updateProfile).not.toHaveBeenCalled();
  });

  it('shows mismatch validation when password confirmation does not match', async () => {
    const updateProfile = vi.fn();
    mockAuthState({ updateProfile });

    render(<ProfilePage />);

    const userInput = userEvent.setup();
    await userInput.type(screen.getByLabelText('Current password'), 'ReaderPass123!');
    await userInput.type(screen.getByLabelText('New password'), 'ReaderPass456!');
    await userInput.type(screen.getByLabelText('Confirm new password'), 'ReaderPass789!');
    await userInput.click(screen.getByRole('button', { name: 'Save changes' }));

    expect(screen.getByText('New password and confirmation do not match.')).toBeInTheDocument();
    expect(updateProfile).not.toHaveBeenCalled();
  });

  it('validates avatar URL format before submit', async () => {
    const updateProfile = vi.fn();
    mockAuthState({ updateProfile });

    render(<ProfilePage />);

    const userInput = userEvent.setup();
    await userInput.clear(screen.getByLabelText('Avatar URL (optional)'));
    await userInput.type(screen.getByLabelText('Avatar URL (optional)'), 'not-a-valid-url');
    await userInput.click(screen.getByRole('button', { name: 'Save changes' }));

    expect(screen.getByText('Please enter a valid URL.')).toBeInTheDocument();
    expect(updateProfile).not.toHaveBeenCalled();
  });

  it('renders password field validation error returned by api', async () => {
    const updateProfile = vi
      .fn()
      .mockRejectedValue(new AuthValidationError('Password too weak.', { new_password: 'Password too weak.' }));

    mockAuthState({ updateProfile });

    render(<ProfilePage />);

    const userInput = userEvent.setup();
    await userInput.type(screen.getByLabelText('Current password'), 'ReaderPass123!');
    await userInput.type(screen.getByLabelText('New password'), 'short');
    await userInput.type(screen.getByLabelText('Confirm new password'), 'short');
    await userInput.click(screen.getByRole('button', { name: 'Save changes' }));

    await waitFor(() => {
      expect(screen.getByText('Password too weak.')).toBeInTheDocument();
    });
  });

  it('renders general validation error returned by api', async () => {
    const updateProfile = vi
      .fn()
      .mockRejectedValue(new AuthValidationError('Current password is incorrect.'));

    mockAuthState({ updateProfile });

    render(<ProfilePage />);

    const userInput = userEvent.setup();
    await userInput.type(screen.getByLabelText('Current password'), 'WrongPass123!');
    await userInput.type(screen.getByLabelText('New password'), 'ReaderPass456!');
    await userInput.type(screen.getByLabelText('Confirm new password'), 'ReaderPass456!');
    await userInput.click(screen.getByRole('button', { name: 'Save changes' }));

    await waitFor(() => {
      expect(screen.getByText('Current password is incorrect.')).toBeInTheDocument();
    });
  });
});
