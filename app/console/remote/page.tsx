import { RemoteConsole } from '@/components/remote-console';
import { consoleFixture, fixtureBaseline, fixtureNotice, isFixtureState } from '@/components/remote-console-fixtures';
import { loadRequiredRecording } from './recording';

export const dynamic = 'force-dynamic';

export default async function RemoteConsolePage({ searchParams }: { searchParams: Promise<{ fixture?: string; runId?: string; recording?: string }> }) {
  const params = await searchParams;
  const multichannelEnabled = process.env.MOGS_MULTICHANNEL_ENABLED === '1';
  if (params.recording === 'required-22') {
    const recording = await loadRequiredRecording();
    return <RemoteConsole fixture={null} fixtureNotice={null} initialEvidence={recording.evidence}
      initialBaseline={null} initialRunId={null} recordingNotice={recording.notice} recordingOrigin={recording.localOrigin} multichannelEnabled={multichannelEnabled} />;
  }
  const fixture = isFixtureState(params.fixture) ? params.fixture : null;
  return <RemoteConsole fixture={fixture} fixtureNotice={fixture ? fixtureNotice : null}
    initialEvidence={fixture ? consoleFixture(fixture) : null}
    initialBaseline={fixture ? { ...fixtureBaseline, activeRunId: null } : null}
    initialRunId={fixture ? null : params.runId ?? null} multichannelEnabled={multichannelEnabled} />;
}
