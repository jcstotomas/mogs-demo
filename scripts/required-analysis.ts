/** One real-provider analysis of the frozen full corpus, with no approval or publication. */
import { randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { crawlRemoteScope } from '../lib/crawl/remote';
import { createPublicArtifact, parseSeedManifest } from '../lib/deployment/public-artifact';
import { confirmedFacts } from '../lib/facts/derive';
import { hashRecord } from '../lib/hash';
import { assertCoverageResolution, CoverageRegistrySchema } from '../lib/metrics/coverage-contract';
import { processRemoteRun } from '../lib/pipeline/remote';
import { runtimeProviderConfig } from '../lib/providers';
import { loadLocalEnv } from '../lib/providers/env';
import { RemoteCoordinator } from '../lib/runs/remote-service';
import { BaselineSchema } from '../lib/runs/remote-types';

loadLocalEnv();
const origin = process.argv[2] ?? 'http://localhost:3108';
const url = new URL(origin);
if (url.protocol !== 'http:' || !['localhost', '127.0.0.1'].includes(url.hostname) || url.pathname !== '/' || url.search || url.hash) throw new Error('Use the local content-only demo server origin.');
const builtArtifact = JSON.parse(await readFile('apps/public/generated/public-artifact.json', 'utf8'));
const sourceCommit = builtArtifact.sourceCommit as string;
const runtimeCommit = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
if (builtArtifact.scope !== 'required-22' || !/^[a-f0-9]{40}$/.test(sourceCommit)) throw new Error('Build the frozen full-corpus public artifact first.');
const committed = (file: string) => execFileSync('git', ['show', sourceCommit + ':' + file], { encoding: 'utf8', maxBuffer: 8_000_000 });
const seedManifestText = committed('content/seed.json'), seed = parseSeedManifest(seedManifestText);
if (seed.scope !== 'required-22') throw new Error('Commit the frozen required-22 corpus first.');
const factText = committed('data/seed/facts.json'), beforeFacts = JSON.parse(factText);
const artifact = createPublicArtifact({ sourceCommit, mode: 'seed', seedManifestText, factText });
const coverage = CoverageRegistrySchema.parse(JSON.parse(committed('fixtures/remote/coverage-required-22.json')));
const sources = Object.fromEntries(Object.entries(seed.sources).map(([file, item]) => [file, item.source]));
const runRoot = path.resolve('data/remote2/local-analysis', randomUUID());
const databasePath = path.join(runRoot, 'app.db'), legacyPath = path.join(runRoot, 'legacy.db'), contentRoot = path.join(runRoot, 'content');
for (const [file, source] of Object.entries(sources)) {
  const destination = path.join(contentRoot, file); await mkdir(path.dirname(destination), { recursive: true }); await writeFile(destination, source, { flag: 'wx' });
}
const baseline = BaselineSchema.parse({
  target: { repository: 'jcstotomas/mogs-demo', baseRef: 'local-required-22', productionOrigin: 'https://local-required-22.invalid', vercelProjectId: 'local-only', vercelTeamId: 'local-only', statusProducerAppId: 5179329 },
  baseSha: sourceCommit, deployedSha: sourceCommit, deploymentId: 'local-static-' + sourceCommit.slice(0, 12), deploymentUrl: origin,
  observedAt: new Date().toISOString(), inventoryHash: artifact.inventoryHash, corpusHash: seed.corpusHash, factsHash: artifact.factsHash, factsFileHash: artifact.factsFileHash, assets: artifact.assets,
});
const confirmedAt = new Date(); // Crawl and processing share the original start time.
const crawled = await crawlRemoteScope(baseline, { sources, publishedFacts: beforeFacts, localTestOrigin: origin });
assertCoverageResolution(coverage, crawled.passages.filter(p => p.editable), crawled.pages.filter(p => p.editable));
// The v2 database pins HTTPS target identities. Local readback stays explicitly
// recorded in localOrigin; this reserved invalid hostname is never a deployment.
for (const page of crawled.pages) page.url = new URL(new URL(page.url).pathname, baseline.target.productionOrigin).href;
for (const passage of crawled.passages) passage.url = new URL(new URL(passage.url).pathname, baseline.target.productionOrigin).href;
const coordinator = new RemoteCoordinator({ databasePath, legacyPath, actor: 'test', clock: () => confirmedAt });
const { run } = coordinator.confirm({ contractVersion: 2, launchAttemptId: randomUUID(), idempotencyKey: randomUUID(), expectedFactVersion: 1, baselineHash: hashRecord(baseline) }, {
  baseline, beforeFacts, desiredFacts: confirmedFacts(beforeFacts), config: runtimeProviderConfig(), mode: 'eval', ...crawled,
});
console.log(JSON.stringify({ started: true, runId: run.id, assets: artifact.assets.length, passages: crawled.passages.length, concurrency: run.config.concurrency, provider: run.config.judgeModel, evidenceKind: 'local-real-provider-analysis', publicationCredit: false }));
await processRemoteRun(run.id, { databasePath, legacyPath, contentRoot });
const evidence = coordinator.export(run.id);
const evidenceDir = path.resolve('data/evidence/remote2'); await mkdir(evidenceDir, { recursive: true });
const evidencePath = path.join(evidenceDir, 'local-analysis-' + run.id + '.json');
const record = { format: 'mogs-required-analysis-v1', evidenceKind: 'local-real-provider-analysis', localOrigin: origin, sourceCommit, runtimeCommit, corpusHash: seed.corpusHash, registryHash: coverage.registryHash, publicationCredit: false, humanApprovals: 0, pr: null, evidence };
await writeFile(evidencePath, JSON.stringify(record, null, 2) + '\n', { flag: 'wx' });
await writeFile(path.join(evidenceDir, 'local-analysis-latest.json'), JSON.stringify({ evidenceFile: path.basename(evidencePath) }, null, 2) + '\n');
console.log(JSON.stringify({ runId: run.id, status: evidence.run.status, stats: evidence.run.stats, errors: evidence.run.errors, groups: evidence.groups.map(g => ({ title: g.title, eligible: g.eligibleIds.length, excluded: g.excludedIds.length })), evidencePath, firstGroupTargetMet: evidence.run.stats.firstSealedGroupMs !== null && evidence.run.stats.firstSealedGroupMs <= 90000, allReadyTargetMet: evidence.run.stats.allResultsReadyMs !== null && evidence.run.stats.allResultsReadyMs <= 180000, deployedGatePassed: false }));
if (evidence.run.status !== 'ready') process.exitCode = 1;
