import type { ReactNode } from 'react';
import Link from 'next/link';
export default function NotFound(): ReactNode {
  return (
    <main className="login"><div className="panel stack">
      <h1 style={{ fontSize: 26 }}>Not found</h1>
      <p style={{ margin: 0 }}>This page does not exist, or you do not have access to it.</p>
      <div><Link className="btn" href="/">Go to my requests</Link></div>
    </div></main>
  );
}
