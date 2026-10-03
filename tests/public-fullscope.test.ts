import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { createDeploymentMetadata, createPublicArtifact, REQUIRED_SOURCE_FILES } from '../lib/deployment/public-artifact';
import { hashRecord, sha256 } from '../lib/hash';

async function inputs() {
  const seed = JSON.parse(await readFile('content/seed.json', 'utf8'));
  const sources = Object.fromEntries(REQUIRED_SOURCE_FILES.map(file => {
    const source = seed.sources[file]?.source ?? seed.sources['site/launch.md'].source;
    return [file, { source, hash: sha256(source) }];
  }));
  const full = { ...seed, scope: 'required-22', sources, corpusHash: hashRecord(Object.entries(sources).map(([file, item]) => ({ file, hash: item.hash }))) };
  return { sourceCommit: 'a'.repeat(40), mode: 'seed' as const, seedManifestText: JSON.stringify(full), factText: await readFile('data/seed/facts.json', 'utf8') };
}

test('full public artifact binds exactly 20 web and two emails to metadata', async () => {
  const artifact = createPublicArtifact(await inputs());
  assert.equal(artifact.scope, 'required-22');
  assert.equal(artifact.routes.length, 22);
  assert.equal(artifact.routes.filter(route => route.kind === 'web').length, 19);
  assert.equal(artifact.routes.filter(route => route.kind === 'email').length, 2);
  assert.equal(artifact.routes.filter(route => route.kind === 'pricing').length, 1);
  assert.equal(artifact.assets.filter(asset => asset.editable).length, 21);
  assert.deepEqual(Object.keys(artifact.sourceHashes).sort(), [...REQUIRED_SOURCE_FILES]);
  assert.equal(createDeploymentMetadata(JSON.stringify(artifact)).inventoryHash, artifact.inventoryHash);
});

test('full scope rejects missing sources, route substitutions and extra hash entries', async () => {
  const input = await inputs();
  const seed = JSON.parse(input.seedManifestText);
  delete seed.sources['site/starter-offer.md'];
  assert.throws(() => createPublicArtifact({ ...input, seedManifestText: JSON.stringify(seed) }), /inventory changed/);
  const artifact = createPublicArtifact(input);
  artifact.routes[0].pathname = '/assets/email/not-in-scope';
  assert.throws(() => createDeploymentMetadata(JSON.stringify(artifact)), /source route mismatch/);
  const extra = createPublicArtifact(input);
  extra.sourceHashes['site/unmapped.md'] = 'f'.repeat(64);
  assert.throws(() => createDeploymentMetadata(JSON.stringify(extra)), /inventory hash mismatch/);
});
