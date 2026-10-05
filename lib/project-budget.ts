/** Operational budget: all time recorded against this project account counts, including support. */
export function projectBudget(contracted: number, logged: number) {
  const remaining = Math.round((contracted - logged) * 100) / 100;
  const usedPercent = contracted > 0 ? logged / contracted * 100 : 0;
  const warning = remaining < 0 ? 'Over budget' : remaining === 0 ? 'Allocation exhausted' : usedPercent >= 80 ? '80% or more used' : null;
  return { contracted, logged, remaining, usedPercent, warning };
}
export function projectValue(hours: number, rate: number): number { return Math.round(hours * rate * 100) / 100; }
