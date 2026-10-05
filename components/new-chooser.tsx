import type { ReactNode } from 'react';
import Link from 'next/link';

/** The one question behind every "+ New": is something wrong, or do they want something built or changed? */
export function NewChooser({ base, query = '', client }: { base: string; query?: string; client: boolean }): ReactNode {
  const q = query ? `?${query}` : '';
  return (
    <div className="chooser">
      <Link className="pick" href={`${base}/support${q}`}>
        <span className="ico" aria-hidden="true">!</span>
        <span><strong>Something is broken, or {client ? 'I have' : 'they have'} a question</strong><br />
          <span className="muted">A workflow stopped, data looks wrong, someone can&apos;t log in, or &quot;how do I...?&quot; Goes straight to an implementer. Never uses credits.</span></span>
      </Link>
      <Link className="pick" href={`${base}/request${q}`}>
        <span className="ico" aria-hidden="true">+</span>
        <span><strong>{client ? 'I need' : 'They need'} something built or changed</strong><br />
          <span className="muted">A new workflow, report, pipeline, import, field change or training. Your team confirms the scope before any credits are used.</span></span>
      </Link>
    </div>
  );
}
