import { useState } from 'react';
import { Play } from 'lucide-react';
import { Card, CardBody, CardHeader, CardTitle, PageHeading, Button, StatusDot, Spinner } from '@/components/ui';
import { apiPost, ApiError } from '@/lib/api';

interface Check {
  name: string;
  status: 'ok' | 'fail' | 'skip';
  latency_ms?: number;
  detail: string;
}
interface DiagnosticsResult {
  ran_at: string;
  summary: { ok: number; fail: number; skip: number };
  checks: Check[];
}

export function Diagnostics() {
  const [result, setResult] = useState<DiagnosticsResult | null>(null);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState('');

  async function run() {
    setRunning(true);
    setError('');
    try {
      const res = await apiPost<DiagnosticsResult>('/api/diagnostics', {});
      setResult(res);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'diagnostics failed');
    } finally {
      setRunning(false);
    }
  }

  return (
    <>
      <PageHeading title="Diagnostics" subtitle="End-to-end health checks across every pipe" />

      <Card className="mb-4">
        <CardBody className="flex flex-wrap items-center justify-between gap-3 py-4">
          <div>
            <div className="text-sm text-ink">Run all checks</div>
            {result && (
              <div className="mt-0.5 text-xs text-ink-faint">
                last run {new Date(result.ran_at).toLocaleTimeString()} ·{' '}
                <span className="text-phos">{result.summary.ok} ok</span>
                {result.summary.fail > 0 && <span className="text-danger"> · {result.summary.fail} fail</span>}
                {result.summary.skip > 0 && <span> · {result.summary.skip} skipped</span>}
              </div>
            )}
          </div>
          <Button variant="primary" onClick={run} disabled={running}>
            {running ? <Spinner /> : <Play size={15} />}
            {running ? 'Running…' : 'Run'}
          </Button>
        </CardBody>
      </Card>

      {error && <p className="mb-4 text-sm text-danger">{error}</p>}

      {result && (
        <Card>
          <CardHeader>
            <CardTitle>Results</CardTitle>
          </CardHeader>
          <CardBody>
            <ul className="divide-y divide-line">
              {result.checks.map((c) => (
                <li key={c.name} className="flex items-start gap-3 py-2.5">
                  <StatusDot tone={c.status === 'ok' ? 'ok' : c.status === 'fail' ? 'bad' : 'idle'} />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 text-sm text-ink">
                      {c.name}
                      {c.latency_ms != null && <span className="text-xs text-ink-faint">{c.latency_ms}ms</span>}
                    </div>
                    <div className="text-xs text-ink-muted">{c.detail}</div>
                  </div>
                </li>
              ))}
            </ul>
          </CardBody>
        </Card>
      )}

      {!result && !running && !error && (
        <p className="text-sm text-ink-faint">Press Run to check the database, integrations, email worker, and AI providers.</p>
      )}
    </>
  );
}
