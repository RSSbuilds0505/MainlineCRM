import type { projectSummary } from '@/lib/projects';
import { hrs, money } from './ui';
export function ProjectBudget({ summary }: { summary: Awaited<ReturnType<typeof projectSummary>> }) {
  if (!summary) return null;
  return <section className="panel stack"><h2>Project allocation</h2>
    <div className="kpis"><div className="kpi"><b>{hrs(summary.contracted)}</b><span>Total contracted hours</span></div><div className="kpi"><b>{hrs(summary.logged)}</b><span>Logged hours</span></div><div className="kpi"><b>{hrs(summary.remaining)}</b><span>Hours remaining</span></div></div>
    {summary.warning ? <p role="status" className="banner">{summary.warning}. Review scope before scheduling more work.</p> : null}
    <p className="small muted">This is a total project allocation. All recorded time, including support, counts toward it. It never resets monthly. Warnings do not block time logging.</p>
    {summary.financial ? <div><strong>Owner only:</strong> {money(summary.financial.rate)}/hour · {money(summary.financial.value)} project value · {money(summary.financial.loggedValue)} value of logged hours. These amounts are not invoices or payments.</div> : null}
  </section>;
}
