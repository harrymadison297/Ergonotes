// The vault of the public demo (apps/site): a made-up person, Harry, and his notes, tasks, events and habits, written as the
// files a real vault holds (ADR 0010, 0014). Every date is worked out from `today`, so Home, the Calendar and the heat map
// always look lived in. Nothing here is real.

export interface SeedFile { path: string; text: string; /** ms since epoch */ mtime: number }

const DAY = 86_400_000;
const pad = (n: number) => String(n).padStart(2, '0');
const isoDay = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

/** A stable id for a file, in the shape of a UUID, so tabs and links survive a reload. */
export function seedId(key: string): string {
  let out = '';
  for (let k = 0; k < 4; k++) {
    let h = 0x811c9dc5 ^ (k * 0x9e3779b1);
    for (let i = 0; i < key.length; i++) { h ^= key.charCodeAt(i); h = Math.imul(h, 0x01000193); }
    out += (h >>> 0).toString(16).padStart(8, '0');
  }
  return `${out.slice(0, 8)}-${out.slice(8, 12)}-4${out.slice(13, 16)}-8${out.slice(17, 20)}-${out.slice(20, 32)}`;
}

/** A small deterministic random number generator: the same demo every time. */
function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

interface NoteSpec {
  path: string;
  body: string;
  tags?: string[];
  pinned?: boolean;
  private?: boolean;
  template?: boolean;
  /** days since the note was last changed, and since it was made */
  edited: number;
  made?: number;
}

export function buildSeed(now: Date = new Date()): SeedFile[] {
  const base = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const day = (n: number) => isoDay(new Date(base.getFullYear(), base.getMonth(), base.getDate() + n));
  const at = (n: number, hm: string) => `${day(n)}T${hm}`;
  const stamp = (n: number, hour = 9) => new Date(base.getFullYear(), base.getMonth(), base.getDate() + n, hour, 12).toISOString();
  const weekday = (n: number) => new Date(base.getFullYear(), base.getMonth(), base.getDate() + n).getDay();

  const notes: NoteSpec[] = [
    {
      path: 'Inbox/Welcome to the Ergonotes demo.md', pinned: true, tags: ['demo'], edited: 0, made: 2,
      body: `# Welcome to the Ergonotes demo

This is the real Ergonotes app, running in your browser with the notes of a made-up person, Harry. Nothing you do here leaves this tab.

## Things to try

- [ ] Open **Home** and rearrange the widgets (Edit in the corner of Home)
- [ ] Check in a habit from **Habits today**
- [ ] Open [[Ergonotes demo plan]] and look at the diagram
- [ ] Press **Ctrl+K** and search for *hydration*
- [ ] Open the **Assistant** in the right sidebar and ask it about the plan
- [ ] Write something in the **Scratch pad** on Home, then send it to the Inbox

Every note is a plain Markdown file in a folder. The installed apps keep it on your device and sync it, end-to-end encrypted, through storage you own.

<details><summary>What does the demo leave out?</summary>

Sync, choosing a vault folder and a password need the installed apps. The assistant gives canned replies here; in the app it uses your own OpenRouter or Anthropic key.

</details>
`,
    },
    {
      path: 'Inbox/Idea - a sleep widget for Home.md', tags: ['idea'], edited: 1, made: 1,
      body: `A small widget that shows last night's sleep next to the habits. Only a number typed by hand, no sensors: a habit records what was done and nothing else ([[Habits are not notes]]).\n`,
    },
    {
      path: 'Inbox/Buy trail shoes.md', tags: ['errand', 'running'], edited: 3, made: 3,
      body: `Size 43, wide toe box. The road pair is done after about 700 km.\n\n- [ ] Try on two pairs at the shop @due(${at(2, '18:00')}) @remind(${at(2, '16:30')})\n- [ ] Order the second pair if they fit @due(${day(3)})\n`,
    },
    {
      path: 'Inbox/Book the dentist.md', tags: ['errand'], edited: 0, made: 0,
      body: `- [ ] Call the dentist for a check-up @due(${at(0, '17:00')}) @remind(${at(0, '12:00')}) @flag\n`,
    },
    {
      path: 'Projects/Ergonotes demo/Ergonotes demo plan.md', pinned: true, tags: ['project', 'demo'], edited: 0, made: 20,
      body: `# Ergonotes demo plan

**Goal:** a static page anyone can open to feel the app in two minutes, with no sign-up and no server.

## How it works

\`\`\`mermaid
flowchart LR
  A[Visitor opens /demo] --> B[Seed builds Harry's vault]
  B --> C[(Memory folder)]
  C --> D[Ergonotes app]
  D --> E{Edits}
  E -->|kept in this tab| C
  E -->|Reset demo| B
\`\`\`

## Milestones

- [x] Seed vault with notes, tasks and habits
- [x] Canned replies for the assistant
- [x] Landing page with the live demo @done(${day(-2)})
- [ ] Record a short habit check-in clip @due(${day(2)})
- [ ] Ask five friends to try it @due(${day(4)})
- [ ] Post it @due(${at(5, '10:00')}) @flag

## Decisions

<details><summary>Why not screenshots only?</summary>

A person believes a notes app after typing in it. Screenshots stay on the landing page for people who do not want to click.

</details>

| Part | Owner | State |
|---|---|---|
| Seed | Harry | done |
| Landing | Harry | in progress |
| Release | Harry | next |

Related: [[Landing page copy]], [[Launch checklist]], [[Release notes v0.1.0]], [[Design review]].
`,
    },
    {
      path: 'Projects/Ergonotes demo/Landing page copy.md', tags: ['project', 'writing'], edited: 1, made: 12,
      body: `# Landing page copy

> Your notes, on every device, readable by nobody else.

Three promises, in this order:

1. **Plain files.** Your notes are Markdown in a folder you choose.
2. **Yours alone.** Synced through storage you own, encrypted before it leaves.
3. **Calm.** No feed, no streak guilt, no account.

Keep the voice quiet. Never joke at the reader's expense. See [[Brand colours]].
`,
    },
    {
      path: 'Projects/Ergonotes demo/Launch checklist.md', tags: ['project', 'demo'], edited: 0, made: 8,
      body: `# Launch checklist

- [x] Domain and hosting
- [x] Open Graph image @done(${day(-3)})
- [ ] Read every sentence out loud @due(${day(1)})
- [ ] Test on a phone @due(${at(1, '15:00')}) @remind(${at(1, '14:30')})
- [ ] Tell the three people who asked @due(${day(5)})

Launch day: Ergonotes demo goes live @event(${at(5, '10:00-11:00')})
`,
    },
    {
      path: 'Projects/Ergonotes demo/Release notes v0.1.0.md', tags: ['project', 'release'], edited: 4, made: 6,
      body: `# Release notes v0.1.0

## New

- Home is a dashboard of widgets you arrange on each device
- Habits with streaks, misses and a heat map
- Export to Word, PDF, HTML and Markdown
- A VS Code extension for the same files

## Fixed

- The habit heat map opens at today
- A note card title is no longer squeezed out of a small card

\`\`\`
Windows setup, Windows portable, Linux .deb, AppImage, Android .apk
\`\`\`
`,
    },
    {
      path: 'Projects/Ergonotes demo/Design review.md', tags: ['meeting', 'project'], edited: 6, made: 6,
      body: `# Design review

**Date:** ${day(-6)} 14:00
**Attendees:** Harry, Mai, Tuan

## Agenda

- Landing page hero
- Dark theme contrast

## Notes

Mai likes the green but wants the headline larger. Tuan found two grey-on-grey labels in dark mode.

## Action items

- [x] Raise the label contrast @done(${at(-4, '16:40')})
- [ ] Try a bigger headline @due(${day(1)})
`,
    },
    {
      path: 'Projects/Half marathon.md', tags: ['project', 'running'], edited: 2, made: 40,
      body: `# Half marathon

Race day @event(${day(38)})

Target time **1:45:00** for 21.0975 km, so a pace of $t / d = 6300 / 21.0975 \\approx 298.6$ seconds per kilometre, about 4:59.

| Week | Long run | Easy runs | Notes |
|---|---|---|---|
| 1 | 10 km | 2 × 5 km | build |
| 2 | 12 km | 2 × 6 km | build |
| 3 | 14 km | 2 × 6 km | hills |
| 4 | 10 km | 2 × 5 km | rest week |

- [ ] Book the race hotel @due(${day(9)})
- [ ] Long run, 14 km @due(${day(3)})

Logs are in [[Running log]]. Shoes: [[Buy trail shoes]].
`,
    },
    {
      path: 'Areas/Health/Running log.md', tags: ['health', 'running'], edited: 1, made: 100,
      body: `# Running log

| Date | Distance | Time | Feeling |
|---|---|---|---|
| ${day(-1)} | 6.2 km | 33:10 | easy |
| ${day(-3)} | 12 km | 1:09:40 | tired after 9 |
| ${day(-5)} | 5 km | 26:30 | good |
| ${day(-8)} | 10 km | 55:15 | strong |

Rule of thumb: add no more than 10 % a week, and take the rest week when the legs say so. The plan is in [[Half marathon]].
`,
    },
    {
      path: 'Areas/Health/Hydration.md', tags: ['health'], edited: 9, made: 60,
      body: `# Hydration

Goal: 2 litres a day. A 700 ml bottle on the desk, filled three times.

- Glass of water before the first coffee
- Bottle empty by lunch, again by 4 pm, again by 8 pm
- More on run days: roughly $0.5\\,\\text{L}$ per hour of running

Tracked as a habit on Home, not here.
`,
    },
    {
      path: 'Areas/Finance/Budget 2026.md', tags: ['finance'], edited: 5, made: 90,
      body: `# Budget 2026

| Item | Monthly |
|---|---|
| Rent | 520 |
| Food | 260 |
| Transport | 40 |
| Running (races, shoes) | 60 |
| Software | 25 |

Total: $520 + 260 + 40 + 60 + 25 = 905$ a month.

- [ ] Review subscriptions @due(${day(7)})
`,
    },
    {
      path: 'Areas/Home/Apartment.md', tags: ['home'], edited: 12, made: 80,
      body: `# Apartment

Lease ends in March. Landlord is open to a 12-month renewal at the same rent.

- [ ] Ask about the balcony light @due(${day(6)})
- [x] Replace the shower head @done(${at(-10, '19:20')})

Dinner with the neighbours @event(${at(3, '19:30-21:30')})
`,
    },
    {
      path: 'Areas/Journal/Private journal.md', private: true, tags: ['journal'], edited: 2, made: 50,
      body: `This note is marked private: it never reaches an AI assistant or an agent, whatever is connected.\n\nNervous about the race, in a good way.\n`,
    },
    {
      path: 'Resources/Reading/Atomic Habits.md', tags: ['reading', 'habits'], edited: 7, made: 45,
      body: `# Atomic Habits

**Author:** James Clear

## Summary

Small changes compound. Make the cue obvious, the habit attractive, the action easy and the reward satisfying.

## Quotes

> You do not rise to the level of your goals. You fall to the level of your systems.

## My thoughts

Fits how I run: shoes by the door, same route, same time. The habit page here only records what I did; the streaks work themselves out. See [[Habits are not notes]].
`,
    },
    {
      path: 'Resources/Reading/Habits are not notes.md', tags: ['habits', 'ergonotes'], edited: 14, made: 30,
      body: `A habit is a file in a hidden \`.habits/\` folder with a target such as 3 runs in 7 days. It stores only what was done. Streaks, misses and rates are computed, never stored, so two devices can check in on the same day without losing a line.\n\nMention one from a note with \`@\`: [Run](.habits/Run.md "type_habit").\n`,
    },
    {
      path: 'Resources/Dev/Markdown cheatsheet.md', tags: ['dev', 'reference'], edited: 20, made: 70,
      body: `# Markdown cheatsheet

- **bold**, *italic*, \`code\`, ~~strike~~
- [link](https://example.com) and [[wiki links]]
- Tasks: \`- [ ] text @due(2026-12-01)\`
- Event: \`Team sync @event(2026-12-01T09:00-10:00)\`
- Formula: \`$x^2$\`
- Diagram: a \`mermaid\` fence

\`\`\`ts
const sum = (a: number, b: number) => a + b;
\`\`\`
`,
    },
    {
      path: 'Resources/Dev/Git recipes.md', tags: ['dev', 'reference'], edited: 26, made: 75,
      body: `# Git recipes\n\n\`\`\`sh\ngit switch -c feat/demo\ngit commit -m "feat: seed the demo vault"\ngit rebase -i origin/main\n\`\`\`\n\nUndo the last commit, keep the changes: \`git reset --soft HEAD~1\`.\n`,
    },
    {
      path: 'Resources/Design/Brand colours.md', tags: ['design', 'reference'], edited: 8, made: 33,
      body: `# Brand colours\n\n| Role | Hex |\n|---|---|\n| Brand green | #2dbe60 |\n| Primary fill | #008629 |\n| Selection | #4d64ff |\n| Tasks | #7d3ebe |\n\nSee [[Landing page copy]].\n`,
    },
    {
      path: 'Archive/Trip to Da Nang.md', tags: ['travel'], edited: 28, made: 110,
      body: `# Trip to Da Nang\n\nFour days, one rented scooter, too much seafood. Best part: running along the beach at 5:30 am.\n\n- [x] Book flights @done(${at(-100, '10:05')})\n- [x] Pack the trail shoes @done(${at(-92, '21:00')})\n`,
    },
    {
      path: 'Archive/Old budget 2025.md', tags: ['finance'], edited: 29, made: 120,
      body: `# Old budget 2025\n\nSuperseded by [[Budget 2026]].\n`,
    },
    {
      path: 'Templates/Meeting notes.md', template: true, tags: ['meeting'], edited: 29, made: 120,
      body: '**Date:** {{date}} {{time}}\n**Attendees:**\n\n## Agenda\n\n- \n\n## Notes\n\n## Action items\n\n- [ ] \n',
    },
    {
      path: 'Templates/Reading note.md', template: true, tags: ['reading'], edited: 29, made: 120,
      body: '**Source:**\n**Author:**\n\n## Summary\n\n{{cursor}}\n\n## Quotes\n\n## My thoughts\n\n',
    },
  ];

  const files: SeedFile[] = [];
  const t0 = now.getTime();
  notes.forEach((n, i) => {
    const fm: string[] = [`id: ${seedId(n.path)}`];
    if (n.tags?.length) fm.push(`tags: [${n.tags.join(', ')}]`);
    if (n.pinned) fm.push('pinned: true');
    if (n.private) fm.push('private: true');
    if (n.template) fm.push('template: true');
    // the notes edited today carry the time of the load, so they sort the way a live vault does
    const updated = n.edited === 0 ? new Date(t0 - i * 61_000).toISOString() : stamp(-n.edited, 8 + (i % 9));
    fm.push(`created: ${stamp(-(n.made ?? n.edited + 1), 10)}`, `updated: ${updated}`);
    // the title is the file name, so a heading that repeats it is dropped; `@done(...)` belongs to habits, a plain task is just ticked
    const body = n.body.replace(/^# .*\n+/, '').replace(/ @done\([^)]*\)/g, '');
    files.push({ path: n.path, text: `---\n${fm.join('\n')}\n---\n\n${body}`, mtime: t0 - n.edited * DAY - i * 1000 });
  });

  // ---------------------------------------------------------------- habits (ADR 0013, 0014)
  const rand = rng(297);
  const HABITS: { name: string; target: number; per: 1 | 3 | 5 | 7; why: string; hour: [number, number]; odds: (back: number) => number; skip: number[]; remarks: [number, string][] }[] = [
    { name: 'Run', target: 3, per: 7, why: 'Three runs a week, any distance.', hour: [6, 7], odds: b => (weekday(-b) === 1 || weekday(-b) === 0 ? 0.12 : 0.55) + (b < 50 ? 0.12 : 0), skip: [0], remarks: [[9, 'Rain, used the treadmill'], [31, 'Race week, short and slow']] },
    { name: 'Drink 2L of water', target: 1, per: 1, why: 'Three bottles on the desk.', hour: [20, 22], odds: b => 0.74 + (b < 40 ? 0.17 : 0), skip: [], remarks: [[16, 'Forgot on the train']] },
    { name: 'Read 20 pages', target: 5, per: 7, why: 'Evenings, before the phone.', hour: [21, 23], odds: b => 0.6 + (b < 30 ? 0.1 : 0), skip: [0], remarks: [] },
    { name: "Write the day's journal", target: 1, per: 1, why: 'Three lines are enough.', hour: [22, 23], odds: b => 0.52 + (b < 20 ? 0.18 : 0), skip: [0, 1], remarks: [[1, 'Late flight home']] },
  ];
  for (const h of HABITS) {
    const lines: string[] = [];
    for (let back = 119; back >= 0; back--) {
      for (const [r, text] of h.remarks) if (r === back) lines.push(`- ${day(-back)}: ${text}`);
      if (h.skip.includes(back)) continue;
      if (rand() < h.odds(back)) {
        const hh = h.hour[0] + Math.floor(rand() * (h.hour[1] - h.hour[0] + 1));
        const mm = Math.floor(rand() * 60);
        lines.push(`- [x] @done(${day(-back)}T${pad(hh)}:${pad(mm)})`);
      }
    }
    // the water is already drunk today, so Home shows both a done habit and some that still want a check-in
    if (h.name.startsWith('Drink')) lines.push(`- [x] @done(${day(0)}T06:40)`);
    const path = `.habits/${h.name}.md`;
    files.push({
      path,
      text: `---\nid: ${seedId(path)}\nhabit: true\ntarget: ${h.target}\nper: ${h.per}\nstart: ${day(-119)}\n---\n\n${h.why}\n\n## Log\n\n${lines.join('\n')}\n`,
      mtime: t0 - 3_600_000,
    });
  }
  return files;
}

/** The arrangement of Home on this Device, to show habits and tasks on the first look. */
export const DEMO_DASHBOARD = {
  widgets: [
    { id: 'greeting', kind: 'greeting', size: 'S' }, { id: 'pinned', kind: 'pinned', size: 'S' }, { id: 'habit-streaks', kind: 'habit-streaks', size: 'S' },
    { id: 'tasks-due', kind: 'tasks-due', size: 'M' }, { id: 'habits-today', kind: 'habits-today', size: 'M' }, { id: 'events', kind: 'events', size: 'M' },
    { id: 'notes', kind: 'notes', size: 'M' }, { id: 'habit-calendar', kind: 'habit-calendar', size: 'M' }, { id: 'scratch', kind: 'scratch', size: 'M' },
    { id: 'notes-edited', kind: 'notes-edited', size: 'M' }, { id: 'habit-heat', kind: 'habit-heat', size: 'L' },
  ],
  layouts: {
    1: [['greeting', 'tasks-due', 'habits-today', 'notes', 'scratch', 'pinned', 'events', 'habit-streaks', 'habit-calendar', 'notes-edited', 'habit-heat']],
    2: [['greeting', 'notes', 'scratch', 'habit-calendar', 'notes-edited'], ['tasks-due', 'habits-today', 'events', 'pinned', 'habit-streaks']],
    3: [['greeting', 'pinned', 'habit-streaks', 'habit-calendar'], ['tasks-due', 'habits-today', 'events', 'notes-edited'], ['notes', 'scratch', 'habit-heat']],
  },
};
