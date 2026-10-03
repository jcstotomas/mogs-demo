import { readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createDeploymentMetadata } from '../../../lib/deployment/public-artifact';

const appRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const generatedRoot = path.join(appRoot, 'generated');
const artifactText = await readFile(path.join(generatedRoot, 'public-artifact.json'), 'utf8');
const metadata = createDeploymentMetadata(artifactText);
const temporary = path.join(generatedRoot, 'deployment-meta.json.tmp');
await writeFile(temporary, JSON.stringify(metadata, null, 2) + '\n', { flag: 'w' });
await rename(temporary, path.join(generatedRoot, 'deployment-meta.json'));
console.log(JSON.stringify(metadata));
