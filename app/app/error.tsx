'use client';
import type { ReactNode } from 'react';
export default function ErrorPage({ reset }: { error: Error; reset: () => void }): ReactNode {
  return (
    <div className="center panel stack" role="alert">
      <h1>This page did not load</h1>
      <p style={{ margin: 0 }}>Something went wrong on our side. Try again, and tell Josh if it keeps happening.</p>
      <div><button className="btn" onClick={reset}>Try again</button></div>
    </div>
  );
}
