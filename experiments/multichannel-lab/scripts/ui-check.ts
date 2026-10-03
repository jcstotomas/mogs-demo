import { readFileSync } from 'node:fs';
import { auditCss } from './base-ui-check.ts';
// Lab owns its font root; use the existing root-style rules without weakening them.
const source=readFileSync(new URL('../public/styles.css',import.meta.url),'utf8');
const issues=auditCss('app/globals.css',source);
if(issues.length){console.error(issues);process.exitCode=1;}else console.log('Lab CSS passes the existing UI guardrails.');
