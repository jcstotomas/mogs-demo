import { RemoteConsole } from '@/components/remote-console';
import { consoleFixture, fixtureBaseline, fixtureNotice, isFixtureState } from '@/components/remote-console-fixtures';

export default async function RemoteConsolePage({ searchParams }: { searchParams: Promise<{ fixture?: string; runId?: string }> }) {
  const params = await searchParams;
  const fixture = isFixtureState(params.fixture) ? params.fixture : null;
  return <RemoteConsole fixture={fixture} fixtureNotice={fixture ? fixtureNotice : null}
    initialEvidence={fixture ? consoleFixture(fixture) : null}
    initialBaseline={fixture ? { ...fixtureBaseline, activeRunId: null } : null}
    initialRunId={fixture ? null : params.runId ?? null} />;
}
