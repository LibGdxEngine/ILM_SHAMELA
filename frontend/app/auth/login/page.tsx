import { Suspense } from 'react';

import AuthPanel from '@/components/auth/AuthPanel';

export default function LoginPage() {
  return (
    <Suspense fallback={null}>
      <AuthPanel initialMode="signin" />
    </Suspense>
  );
}
