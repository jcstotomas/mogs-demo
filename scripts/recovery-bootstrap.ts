import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { loadLocalEnv } from '../lib/providers/env';
import { githubAppConfig, localGitHubAppTokenProvider } from '../lib/submission/github-config';

// This setup operation is deliberately restricted to the separately approved recovery target.
const REPOSITORY = 'jcstotomas/mogs-demo';
const REPOSITORY_ID = 1403606624;
const BRANCH = 'codex/recovery-base';
const PARENT = '308d64631320acf022ceef9620eb161369305c2f';
const AUDIT_PATH = 'docs/recovery-target.md';
const JOURNAL_PATH = 'data/evidence/remote1/recovery/bootstrap-branch.json';
const API_VERSION = '2022-11-28';
const MAX_BYTES = 4_000_000;
const HASH = /^[a-f0-9]{40}$/;
const PRESERVED_PATHS = [
  'content/email/eligible.md', 'content/email/onboarding.md', 'content/site/launch.md',
  'data/facts.json', 'content/seed.json', 'data/seed/facts.json',
  'apps/public/package.json', 'apps/public/next.config.ts', 'package.json',
  'package-lock.json', 'scripts/public-bootstrap.ts', 'vercel.json',
] as const;

type Json = Record<string, unknown>;
type Leaf = { path: string; mode: string; type: 'blob' | 'commit'; sha: string };
type Journal = {
  format: 'mogs-recovery-bootstrap-v1'; operationId: string; createdAt: string;
  repository: typeof REPOSITORY; repositoryId: typeof REPOSITORY_ID;
  branch: typeof BRANCH; parentSha: typeof PARENT; auditPath: typeof AUDIT_PATH;
  authorization: string; purpose: 'isolated-remote-test'; correctionCredit: false;
  auditContent: string; auditContentSha256: string; expectedBlobSha: string;
  commitMessage: string; commitDate: string;
  gitIdentity: { name: string; email: string; date: string };
  expectedTreeSha?: string; expectedCommitSha?: string; parentTreeSha?: string;
  mainBeforeSha?: string; mainAfterSha?: string;
  parentLeaves?: Leaf[]; expectedPreservedHashes?: Record<string, string>;
  verifiedPreservedHashes?: Record<string, string>;
  branchSha?: string; passed: boolean; stages: { at: string; stage: string; sha?: string }[];
  commitEncodingCorrection?: { previousExpectedSha: string; correctedExpectedSha: string; reason: string; failedAt: string };
  failure?: string;
};

const asRecord = (value: unknown): Json => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Unexpected GitHub response shape.');
  return value as Json;
};
const sha = (value: unknown): string => {
  if (typeof value !== 'string' || !HASH.test(value)) throw new Error('Unexpected Git object identity.');
  return value;
};
const sha256 = (bytes: string | Buffer) => createHash('sha256').update(bytes).digest('hex');
function gitHash(type: 'blob' | 'tree' | 'commit', content: Buffer | string): string {
  const bytes = Buffer.isBuffer(content) ? content : Buffer.from(content, 'utf8');
  return createHash('sha1').update(Buffer.from(type + ' ' + bytes.length + '\0')).update(bytes).digest('hex');
}

/** Reproduce Git's tree identity before any remote object is created. */
function treeHash(leaves: Leaf[]): string {
  type Directory = Map<string, Leaf | Directory>;
  const root: Directory = new Map();
  for (const leaf of leaves) {
    const segments = leaf.path.split('/'); let directory = root;
    for (const segment of segments.slice(0, -1)) {
      const current = directory.get(segment);
      if (current && !(current instanceof Map)) throw new Error('Tree contains a conflicting path.');
      const child = current ?? new Map(); directory.set(segment, child); directory = child as Directory;
    }
    const name = segments.at(-1)!;
    if (directory.has(name)) throw new Error('Tree contains a duplicate path.');
    directory.set(name, leaf);
  }
  function hash(directory: Directory): string {
    const entries = [...directory].sort(([a, av], [b, bv]) => Buffer.compare(Buffer.from(a + (av instanceof Map ? '/' : '')), Buffer.from(b + (bv instanceof Map ? '/' : ''))));
    const bytes = entries.map(([name, value]) => {
      const mode = value instanceof Map ? '40000' : value.mode.replace(/^0+/, '');
      const objectSha = value instanceof Map ? hash(value) : value.sha;
      return Buffer.concat([Buffer.from(mode + ' ' + name + '\0'), Buffer.from(objectSha, 'hex')]);
    });
    return gitHash('tree', Buffer.concat(bytes));
  }
  return hash(root);
}

function commitHash(journal: Journal, trailingNewline = false): string {
  const seconds = Math.floor(Date.parse(journal.commitDate) / 1000);
  const person = `${journal.gitIdentity.name} <${journal.gitIdentity.email}> ${seconds} +0000`;
  // The Git database REST endpoint preserves the supplied message's lack of a final LF.
  return gitHash('commit', `tree ${journal.expectedTreeSha}\nparent ${PARENT}\nauthor ${person}\ncommitter ${person}\n\n${journal.commitMessage}${trailingNewline ? '\n' : ''}`);
}

loadLocalEnv();
const option = process.argv.slice(2);
if (option.length !== 1 || !['--plan', '--apply'].includes(option[0])) throw new Error('Run recovery-bootstrap.ts with --plan or --apply.');
const config = githubAppConfig();
if (config.repository !== REPOSITORY || config.appId !== 5179329 || config.appSlug !== 'memberofgtmstaff') throw new Error('Recovery setup credentials do not match the approved target.');
const provider = localGitHubAppTokenProvider({ repository: REPOSITORY, appId: config.appId, appSlug: config.appSlug });
const prefix = '/repos/' + REPOSITORY;

class ApiError extends Error {
  constructor(readonly status: number) { super('GitHub recovery setup returned HTTP ' + status + '.'); }
}
async function api(method: 'GET' | 'POST', route: string, body?: unknown, optional = false): Promise<Json | null> {
  const token = await provider.getToken();
  let response: Response;
  try {
    response = await fetch('https://api.github.com' + route, {
      method, redirect: 'error', cache: 'no-store', signal: AbortSignal.timeout(20_000),
      headers: { Accept: 'application/vnd.github+json', Authorization: 'Bearer ' + token, 'X-GitHub-Api-Version': API_VERSION, ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
  } catch { throw new Error('GitHub recovery setup response was not received; rerun to inspect the journaled identity.'); }
  if (!response.ok) {
    await response.body?.cancel();
    if (optional && response.status === 404) return null;
    throw new ApiError(response.status);
  }
  if (!response.body) throw new Error('GitHub recovery setup returned an empty response.');
  const reader = response.body.getReader(), chunks: Uint8Array[] = []; let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read(); if (done) break;
      total += value.byteLength;
      if (total > MAX_BYTES) { await reader.cancel(); throw new Error('GitHub recovery setup response exceeded its bound.'); }
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
  try { return asRecord(JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks)))); }
  catch { throw new Error('GitHub recovery setup returned invalid bounded JSON.'); }
}
async function required(method: 'GET' | 'POST', route: string, body?: unknown): Promise<Json> {
  const value = await api(method, route, body); if (!value) throw new Error('Missing required GitHub recovery response.'); return value;
}
async function ref(branch: string): Promise<string | null> {
  const value = await api('GET', prefix + '/git/ref/heads/' + branch, undefined, true);
  if (!value) return null;
  if (value.ref !== 'refs/heads/' + branch || asRecord(value.object).type !== 'commit') throw new Error('Recovery ref identity is invalid.');
  return sha(asRecord(value.object).sha);
}
async function leaves(treeSha: string): Promise<Leaf[]> {
  const tree = await required('GET', prefix + '/git/trees/' + treeSha + '?recursive=1');
  if (tree.sha !== treeSha || tree.truncated !== false || !Array.isArray(tree.tree)) throw new Error('Recovery tree is incomplete.');
  const result = tree.tree.map(asRecord).filter(item => item.type !== 'tree').map(item => {
    if (typeof item.path !== 'string' || !item.path || item.path.includes('\0') || item.path.split('/').some(segment => !segment || ['.', '..'].includes(segment)) || !['blob', 'commit'].includes(String(item.type)) || !['100644', '100755', '120000', '160000'].includes(String(item.mode))) throw new Error('Invalid recovery tree leaf.');
    return { path: item.path, sha: sha(item.sha), mode: String(item.mode), type: item.type as Leaf['type'] };
  }).sort((a, b) => a.path.localeCompare(b.path));
  if (treeHash(result) !== treeSha) throw new Error('Recovery tree does not reproduce its exact Git identity.');
  return result;
}
async function blob(blobSha: string): Promise<Buffer> {
  const value = await required('GET', prefix + '/git/blobs/' + blobSha);
  if (value.sha !== blobSha || value.encoding !== 'base64' || typeof value.content !== 'string') throw new Error('Recovery blob encoding is invalid.');
  const bytes = Buffer.from(value.content, 'base64');
  if (value.size !== bytes.length || gitHash('blob', bytes) !== blobSha) throw new Error('Recovery blob bytes do not match the requested identity.');
  return bytes;
}

let journal: Journal;
try { journal = JSON.parse(await readFile(JOURNAL_PATH, 'utf8')) as Journal; }
catch (error) {
  if (!(error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT')) throw new Error('Existing recovery journal could not be read; preserve it and resolve before continuing.');
  const operationId = randomUUID(), createdAt = new Date().toISOString();
  const commitDate = createdAt.replace(/\.\d{3}Z$/, 'Z');
  const auditContent = '# MOGS recovery test target\n\nThis isolated target serves fictional MOGS pages and repository-backed email previews for remote recovery drills. It does not send email and its results have zero live correction credit.\n\nProduction branch: `' + BRANCH + '`\nBaseline parent: `' + PARENT + '`\nOperation: `' + operationId + '`\n\nThis bootstrap commit adds this audit file only. Mapped content, canonical facts, pristine seed data and public build inputs are preserved from the verified parent. Human GitHub merge remains a separate decision for test restoration PRs.\n';
  journal = {
    format: 'mogs-recovery-bootstrap-v1', operationId, createdAt,
    repository: REPOSITORY, repositoryId: REPOSITORY_ID, branch: BRANCH, parentSha: PARENT, auditPath: AUDIT_PATH,
    authorization: 'The user explicitly approved the separate public mogs-recovery project and isolated GitHub recovery branch on 2026-10-03.',
    purpose: 'isolated-remote-test', correctionCredit: false,
    auditContent, auditContentSha256: sha256(auditContent), expectedBlobSha: gitHash('blob', auditContent),
    commitMessage: 'Bootstrap isolated MOGS recovery target\n\nOperation: ' + operationId,
    commitDate, gitIdentity: { name: 'MOGS Recovery Test', email: 'mogs-recovery@example.invalid', date: commitDate },
    passed: false, stages: [],
  };
}
if (journal.format !== 'mogs-recovery-bootstrap-v1' || journal.repository !== REPOSITORY || journal.repositoryId !== REPOSITORY_ID || journal.branch !== BRANCH || journal.parentSha !== PARENT || journal.auditPath !== AUDIT_PATH || journal.purpose !== 'isolated-remote-test' || journal.correctionCredit !== false || sha256(journal.auditContent) !== journal.auditContentSha256 || gitHash('blob', journal.auditContent) !== journal.expectedBlobSha || journal.commitMessage !== 'Bootstrap isolated MOGS recovery target\n\nOperation: ' + journal.operationId || journal.gitIdentity.name !== 'MOGS Recovery Test' || journal.gitIdentity.email !== 'mogs-recovery@example.invalid' || journal.gitIdentity.date !== journal.commitDate) throw new Error('Recovery journal identity differs from the restricted operation.');

async function save(): Promise<void> {
  await mkdir(dirname(JOURNAL_PATH), { recursive: true });
  const temporary = JOURNAL_PATH + '.tmp';
  await writeFile(temporary, JSON.stringify(journal, null, 2) + '\n', { mode: 0o600 });
  await rename(temporary, JOURNAL_PATH);
}
async function stage(name: string, objectSha?: string): Promise<void> {
  journal.stages.push({ at: new Date().toISOString(), stage: name, ...(objectSha ? { sha: objectSha } : {}) });
  await save();
}
async function verifyCommit(commitSha: string): Promise<void> {
  const value = await required('GET', prefix + '/git/commits/' + commitSha);
  const matchesPerson = (person: unknown) => {
    const record = asRecord(person);
    return record.name === journal.gitIdentity.name && record.email === journal.gitIdentity.email && record.date === journal.gitIdentity.date;
  };
  if (value.sha !== journal.expectedCommitSha || asRecord(value.tree).sha !== journal.expectedTreeSha || !Array.isArray(value.parents) || value.parents.length !== 1 || asRecord(value.parents[0]).sha !== PARENT || value.message !== journal.commitMessage || !matchesPerson(value.author) || !matchesPerson(value.committer)) throw new Error('Recovery commit does not match the journaled parent, tree, message and identity.');
  const actualLeaves = await leaves(journal.expectedTreeSha!);
  const expectedLeaves = [...journal.parentLeaves!, { path: AUDIT_PATH, sha: journal.expectedBlobSha, mode: '100644', type: 'blob' as const }].sort((a, b) => a.path.localeCompare(b.path));
  if (JSON.stringify(actualLeaves) !== JSON.stringify(expectedLeaves)) throw new Error('Recovery commit changed a file beyond the audit record.');
  const bytes = await blob(journal.expectedBlobSha);
  if (!bytes.equals(Buffer.from(journal.auditContent))) throw new Error('Recovery audit bytes differ from the journal.');
  const preserved: Record<string, string> = {};
  for (const file of PRESERVED_PATHS) {
    const leaf = actualLeaves.find(item => item.path === file);
    if (!leaf || leaf.type !== 'blob' || leaf.mode !== '100644') throw new Error('Recovery preserved file is missing or irregular.');
    preserved[file] = sha256(await blob(leaf.sha));
  }
  if (JSON.stringify(preserved) !== JSON.stringify(journal.expectedPreservedHashes)) throw new Error('Recovery content, facts, seed or build bytes changed.');
  journal.verifiedPreservedHashes = preserved;
}

try {
  // Persist intended identity before effects; never replace a pre-existing unrelated ref.
  await stage('operation-journaled');
  const repository = await required('GET', prefix);
  if (repository.id !== REPOSITORY_ID || repository.full_name !== REPOSITORY || repository.private !== false || repository.default_branch !== 'main') throw new Error('Recovery repository differs from the approved public source.');
  const currentMain = await ref('main');
  if (currentMain !== PARENT) throw new Error('Main differs from the approved merged baseline; recapture and coordinate before setup.');
  journal.mainBeforeSha ??= currentMain;
  const parent = await required('GET', prefix + '/git/commits/' + PARENT);
  if (parent.sha !== PARENT) throw new Error('Recovery parent identity is invalid.');
  const parentTreeSha = sha(asRecord(parent.tree).sha), parentLeaves = await leaves(parentTreeSha);
  if (parentLeaves.some(leaf => leaf.path === AUDIT_PATH)) throw new Error('The approved parent already contains a recovery audit path.');
  const expectedTreeSha = treeHash([...parentLeaves, { path: AUDIT_PATH, mode: '100644', type: 'blob', sha: journal.expectedBlobSha }]);
  if ((journal.parentTreeSha && journal.parentTreeSha !== parentTreeSha) || (journal.expectedTreeSha && journal.expectedTreeSha !== expectedTreeSha) || (journal.parentLeaves && JSON.stringify(journal.parentLeaves) !== JSON.stringify(parentLeaves))) throw new Error('Recovery parent or expected tree changed since journaling.');
  journal.parentTreeSha = parentTreeSha; journal.parentLeaves = parentLeaves; journal.expectedTreeSha = expectedTreeSha;
  const expectedCommitSha = commitHash(journal);
  if (journal.expectedCommitSha && journal.expectedCommitSha !== expectedCommitSha) {
    if (journal.expectedCommitSha !== commitHash(journal, true) || journal.failure !== 'Created audit commit has an unexpected identity; no branch was created.' || await ref(BRANCH)) throw new Error('Recovery commit identity changed since journaling.');
    journal.commitEncodingCorrection = {
      previousExpectedSha: journal.expectedCommitSha, correctedExpectedSha: expectedCommitSha,
      reason: 'Initial precomputed commit encoding added a final LF. The GitHub Git database endpoint preserved the exact supplied message without LF. Readback confirmed the exact parent/tree/message/author and no branch had been created.',
      failedAt: journal.stages.findLast(entry => entry.stage === 'setup-failed')?.at ?? new Date().toISOString(),
    };
    await stage('rest-commit-message-encoding-corrected', expectedCommitSha);
  }
  journal.expectedCommitSha = expectedCommitSha;
  const preserved: Record<string, string> = {};
  for (const file of PRESERVED_PATHS) {
    const leaf = parentLeaves.find(item => item.path === file);
    if (!leaf || leaf.type !== 'blob' || leaf.mode !== '100644') throw new Error('The approved parent has a missing or irregular protected file.');
    preserved[file] = sha256(await blob(leaf.sha));
  }
  if (journal.expectedPreservedHashes && JSON.stringify(journal.expectedPreservedHashes) !== JSON.stringify(preserved)) throw new Error('Parent protected bytes changed since journaling.');
  journal.expectedPreservedHashes = preserved;
  await stage('expected-object-and-byte-identities-recorded', expectedCommitSha);
  const existing = await ref(BRANCH);
  if (existing && existing !== expectedCommitSha) throw new Error('Recovery branch already exists at an unknown head; it was not overwritten.');
  if (option[0] === '--plan') {
    if (existing) await verifyCommit(existing);
    console.log(JSON.stringify({ mode: 'plan', repository: REPOSITORY, branch: BRANCH, parentSha: PARENT, expectedCommitSha, expectedTreeSha, existingBranchSha: existing, changedFiles: [AUDIT_PATH], preservedTreeLeaves: parentLeaves.length, preservedFileHashes: preserved }, null, 2));
  } else {
    if (!existing) {
      // Content-addressed object writes are safe to recover by their journaled exact hashes.
      if (!await api('GET', prefix + '/git/blobs/' + journal.expectedBlobSha, undefined, true)) {
        await stage('creating-audit-blob', journal.expectedBlobSha);
        const created = await required('POST', prefix + '/git/blobs', { content: journal.auditContent, encoding: 'utf-8' });
        if (created.sha !== journal.expectedBlobSha) throw new Error('Created audit blob has an unexpected identity.');
      }
      if (!await api('GET', prefix + '/git/trees/' + expectedTreeSha, undefined, true)) {
        await stage('creating-audit-tree', expectedTreeSha);
        const created = await required('POST', prefix + '/git/trees', { base_tree: parentTreeSha, tree: [{ path: AUDIT_PATH, mode: '100644', type: 'blob', sha: journal.expectedBlobSha }] });
        if (created.sha !== expectedTreeSha) throw new Error('Created audit tree has an unexpected identity.');
      }
      if (!await api('GET', prefix + '/git/commits/' + expectedCommitSha, undefined, true)) {
        await stage('creating-audit-commit', expectedCommitSha);
        const created = await required('POST', prefix + '/git/commits', { message: journal.commitMessage, tree: expectedTreeSha, parents: [PARENT], author: journal.gitIdentity, committer: journal.gitIdentity });
        if (created.sha !== expectedCommitSha) throw new Error('Created audit commit has an unexpected identity; no branch was created.');
      }
      await verifyCommit(expectedCommitSha);
      await stage('creating-isolated-branch', expectedCommitSha);
      // Recheck immediately before ref creation. POST creates only; there is no PATCH/force path.
      const raced = await ref(BRANCH);
      if (raced && raced !== expectedCommitSha) throw new Error('Recovery branch appeared at an unknown head; it was not overwritten.');
      if (!raced) await required('POST', prefix + '/git/refs', { ref: 'refs/heads/' + BRANCH, sha: expectedCommitSha });
    }
    const actual = await ref(BRANCH);
    if (actual !== expectedCommitSha) throw new Error('Recovery branch readback did not match the journaled commit.');
    await verifyCommit(actual);
    journal.mainAfterSha = (await ref('main')) ?? undefined;
    if (journal.mainAfterSha !== journal.mainBeforeSha) throw new Error('Main moved during recovery setup; inspect independent changes before claiming preservation.');
    journal.branchSha = actual; journal.passed = true; delete journal.failure;
    await stage(existing ? 'existing-branch-verified' : 'isolated-branch-created-and-verified', actual);
    console.log(JSON.stringify({ passed: true, purpose: journal.purpose, correctionCredit: false, repository: REPOSITORY, branch: BRANCH, headSha: actual, parentSha: PARENT, changedFiles: [AUDIT_PATH], preservedTreeLeaves: parentLeaves.length, protectedBytesUnchanged: true, mainUnchanged: true, evidence: JOURNAL_PATH }, null, 2));
  }
} catch (error) {
  // All API/authentication errors are sanitized; no credentials or response bodies enter evidence.
  journal.passed = false;
  journal.failure = error instanceof Error ? error.message : 'Recovery setup failed.';
  await stage('setup-failed');
  console.error(journal.failure);
  process.exitCode = 1;
}
