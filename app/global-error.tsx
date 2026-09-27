'use client';
import type { ReactNode } from 'react';
export default function GlobalError({ reset }: { error: Error; reset: () => void }): ReactNode {
  return (
    <html lang="en"><body style={{ fontFamily: 'system-ui, sans-serif', padding: 32 }}>
      <h1>Mainline did not load</h1>
      <p>Something went wrong on our side. Try again in a moment.</p>
      <button onClick={reset}>Try again</button>
    </body></html>
  );
}
