import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import type { PublicArtifact, PublicRoute, DeploymentMetadata } from '../../../lib/deployment/public-artifact';

const generatedRoot = path.resolve(process.cwd(), 'generated');

export async function readGenerated(): Promise<{ artifact: PublicArtifact; deployment: DeploymentMetadata }> {
  const [artifactText, metadataText] = await Promise.all([
    readFile(path.join(generatedRoot, 'public-artifact.json'), 'utf8'),
    readFile(path.join(generatedRoot, 'deployment-meta.json'), 'utf8'),
  ]);
  const artifact = JSON.parse(artifactText) as PublicArtifact;
  const deployment = JSON.parse(metadataText) as DeploymentMetadata;
  const actualHash = createHash('sha256').update(artifactText).digest('hex');
  if (artifact.format !== 'mogs-public-artifact-v1' || deployment.format !== 'mogs-deployment-meta-v1' || deployment.artifactHash !== actualHash) throw new Error('Public artifact metadata mismatch.');
  if (artifact.contractVersion !== 2 || deployment.contractVersion !== 2 || artifact.repository !== deployment.repository || artifact.sourceCommit !== deployment.sourceCommit || artifact.factsHash !== deployment.factsHash || artifact.factsFileHash !== deployment.factsFileHash || artifact.inventoryHash !== deployment.inventoryHash) throw new Error('Public deployment identity mismatch.');
  return { artifact, deployment };
}

export async function readRoute(pathname: string): Promise<{ route: PublicRoute; deployment: DeploymentMetadata } | null> {
  const { artifact, deployment } = await readGenerated();
  const route = artifact.routes.find(item => item.pathname === pathname);
  return route ? { route, deployment } : null;
}
