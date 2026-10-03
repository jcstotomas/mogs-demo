import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { extractRenderedAsset, parseSource, replaceSourceBlocks } from '../lib/assets/source';
import { confirmedFacts } from '../lib/facts/derive';
import { sha256 } from '../lib/hash';
import { hashRecord } from '../lib/hash';
import { createDeploymentMetadata, createPublicArtifact, MINIATURE_SOURCE_FILES } from '../lib/deployment/public-artifact';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const sourceCommit = 'a'.repeat(40);

async function seedInputs() {
  const [seedManifestText, factText] = await Promise.all([
    readFile(path.join(root, 'content/seed.json'), 'utf8'),
    readFile(path.join(root, 'data/seed/facts.json'), 'utf8'),
  ]);
  return { seedManifestText, factText };
}

test('pristine public miniature binds all source hashes and $30 canonical facts', async () => {
  const inputs = await seedInputs();
  const artifact = createPublicArtifact({ sourceCommit, mode: 'seed', ...inputs });
  assert.equal(artifact.routes.length, 4);
  assert.deepEqual(artifact.routes.map(route => route.pathname), [
    '/assets/email/eligible', '/assets/email/onboarding', '/site/launch', '/site/pricing',
  ]);
  const pricing = artifact.routes.find(route => route.pathname === '/site/pricing')!;
  const launch = artifact.routes.find(route => route.pathname === '/site/launch')!;
  assert.match(pricing.html, /Starter is \$30 a month for customers without legacy eligibility/);
  assert.match(launch.html, /Starter is \$30 a month/);
  const crawled = extractRenderedAsset(pricing.html, 'https://public.invalid/site/pricing');
  assert.equal(crawled.page.editable, false);
  assert.equal(crawled.page.file, null);
  const seed = JSON.parse(inputs.seedManifestText) as { sources: Record<string, { source: string }> };
  for (const route of artifact.routes.filter(route => route.sourceFile !== null)) {
    const original = parseSource(seed.sources[route.sourceFile!].source, route.sourceFile!, route.kind === 'web' ? 'web' : 'email');
    const rendered = extractRenderedAsset(route.html, 'https://public.invalid' + route.pathname);
    assert.deepEqual(rendered.passages.map(passage => passage.text), original.blocks.map(block => block.text));
  }
  assert.deepEqual(Object.keys(artifact.sourceHashes).sort(), [...MINIATURE_SOURCE_FILES]);
  assert.equal(artifact.inventoryHash, hashRecord(artifact.assets));
  assert.deepEqual(artifact.assets.map(asset => asset.path), [
    'content/email/eligible.md', 'content/email/onboarding.md', 'content/site/launch.md', null,
  ]);
  assert.equal(artifact.assets[3].editable, false);
  assert.equal(artifact.assets[3].sourceHash, artifact.factsHash);
  assert.equal(artifact.factsFileHash, sha256((await seedInputs()).factText));
  assert.doesNotMatch(JSON.stringify(artifact), /expectedLabel|manifestHash|apiKey|data\/evidence/);

  const artifactText = JSON.stringify(artifact, null, 2) + '\n';
  const metadata = createDeploymentMetadata(artifactText);
  assert.equal(metadata.sourceCommit, sourceCommit);
  assert.equal(metadata.contractVersion, 2);
  assert.equal(metadata.repository, 'jcstotomas/mogs-demo');
  assert.equal(metadata.artifactHash, sha256(artifactText));
  assert.equal(metadata.inventoryHash, artifact.inventoryHash);
  assert.deepEqual(metadata.sourceHashes, artifact.sourceHashes);
});

test('commit mode renders one checked source change and the committed desired facts', async () => {
  const { seedManifestText, factText } = await seedInputs();
  const seed = JSON.parse(seedManifestText) as { sources: Record<string, { source: string }> };
  const sources = Object.fromEntries(MINIATURE_SOURCE_FILES.map(file => [file, seed.sources[file].source]));
  const launch = parseSource(sources['site/launch.md'], 'site/launch.md', 'web');
  sources['site/launch.md'] = replaceSourceBlocks(launch, [{ sourceId: 'starter-price', original: 'Starter is $30 a month.', replacement: 'Starter is $40 a month.' }], launch.sourceHash);
  const facts = confirmedFacts(JSON.parse(factText));
  const artifact = createPublicArtifact({ sourceCommit, mode: 'commit', seedManifestText, factText: JSON.stringify(facts) + '\n', sourceTexts: sources });
  assert.match(artifact.routes.find(route => route.pathname === '/site/pricing')!.html, /Starter is \$40 a month for customers without legacy eligibility/);
  assert.match(artifact.routes.find(route => route.pathname === '/site/launch')!.html, /Starter is \$40 a month/);
  const eligible = artifact.routes.find(route => route.pathname === '/assets/email/eligible')!;
  assert.match(eligible.html, /Starter is \$30 a month/);
  assert.match(eligible.html, /\{\{ first_name \}\}/);
  assert.match(eligible.html, /https:\/\/mogs\.example\/account\?ref=legacy&amp;step=1/);
  assert.equal(artifact.sourceHashes['email/eligible.md'], seed.sources['email/eligible.md'] && sha256(seed.sources['email/eligible.md'].source));
});

test('seed hash mismatches and incomplete source inventories stop artifact creation', async () => {
  const { seedManifestText, factText } = await seedInputs();
  const tampered = JSON.parse(seedManifestText);
  tampered.sources['site/launch.md'].source = tampered.sources['site/launch.md'].source.replace('Starter is $30', 'Starter is $40');
  assert.throws(() => createPublicArtifact({ sourceCommit, mode: 'seed', seedManifestText: JSON.stringify(tampered), factText }), /Seed source hash mismatch/);
  const seed = JSON.parse(seedManifestText) as { sources: Record<string, { source: string }> };
  assert.throws(() => createPublicArtifact({ sourceCommit, mode: 'commit', seedManifestText, factText, sourceTexts: { 'site/launch.md': seed.sources['site/launch.md'].source } }), /inventory changed/);
});
