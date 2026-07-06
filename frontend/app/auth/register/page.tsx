import { Suspense } from 'react';

import AuthPanel from '@/components/auth/AuthPanel';

export default function RegisterPage() {
  return (
    <Suspense fallback={null}>
      <AuthPanel initialMode="signup" />
    </Suspense>
  );
}
