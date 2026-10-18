// Writes docs/agents/ergonotes-skill/SKILL.md from the text the app serves (packages/core/src/ai/skill.ts).
// Run: tools/n node tools/write-skill.mjs
import { writeFileSync } from 'node:fs';
import { ERGONOTES_SKILL_MD } from '../packages/core/src/ai/skill.ts';

writeFileSync(new URL('../docs/agents/ergonotes-skill/SKILL.md', import.meta.url), ERGONOTES_SKILL_MD);
console.log('docs/agents/ergonotes-skill/SKILL.md written');
