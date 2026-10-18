// The skill file that teaches an agent (Claude Code, ...) how to use the Ergonotes MCP endpoint without the plugin.
// docs/agents/ergonotes-skill/SKILL.md is the same text (regenerate it with `tools/n node tools/write-skill.mjs`); a test keeps them equal.
// The conventions are the endpoint's own guide (guide.ts), so the skill, the server instructions and the plugin say the same.
import { ERGONOTES_GUIDE } from './guide.ts';

const CONNECT = `
## Connect

The desktop app serves the endpoint while it runs (Settings -> Agents (MCP) shows the address and the tokens):

\`\`\`
claude mcp add --transport http ergonotes http://127.0.0.1:7424/mcp --header "Authorization: Bearer <token>"
\`\`\`

On a server peer the address is \`https://<your-server>/mcp\`. One token per agent; revoke it when you stop using it. The Claude Code plugin
(\`plugins/ergonotes\` in the Ergonotes repository) finds the address and the token by itself and adds skills for writing, capturing, planning,
triage, meetings, questions, review, upkeep, elements, tags, attachments and drawing.
`;

export const ERGONOTES_SKILL_MD = `---
name: ergonotes
description: Search, read and write the user's Ergonotes notes through the Ergonotes MCP server. Use when the user asks to find, summarise, write, edit, tag, draw in or organise notes, tasks or daily notes.
---

${ERGONOTES_GUIDE}${CONNECT}`;
