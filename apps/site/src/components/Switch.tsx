import { ArrowRight, FolderInput, Gem } from 'lucide-react';
import { REPO_URL } from '../github';
import { Reveal } from './motion';

const CARDS = [
  { tone: 'purple', icon: Gem, title: 'Coming from Obsidian', lead: 'Your vault is already a folder of Markdown, so there is nothing to convert.', steps: ['Copy the vault, as you would before trying any new tool', 'Choose that folder in Ergonotes', 'Tags, [[wiki links]] and folders are read as they are; embeds, comments, callouts and Dataview blocks are kept byte for byte'], note: 'Plugins do not carry over, and there is no graph view yet.', href: `${REPO_URL}#moving-from-obsidian` },
  { tone: 'green', icon: FolderInput, title: 'Coming from Evernote', lead: 'Get your notes out of a database and into files you own.', steps: ['Export your notebooks as .enex', 'Convert them to Markdown with a tool such as evernote2md', 'Drop the folder in your vault: notebooks become folders, tags become frontmatter'], note: '.enex import is not built in yet.', href: `${REPO_URL}#moving-from-evernote` },
] as const;

export function Switch() {
  return (
    <section className="section" id="switch">
      <div className="wrap">
        <Reveal style={{ textAlign: 'center', display: 'grid', gap: 16, justifyItems: 'center' }}>
          <span className="eyebrow">An open alternative</span>
          <h2 className="h2">A free alternative to <span className="gradient-text">Obsidian and Evernote</span></h2>
          <p className="lead">Files in a folder like Obsidian, everything in one place like Evernote, with no account and no lock-in.</p>
        </Reveal>
        <div className="switch-grid">
          {CARDS.map((c, i) => {
            const Icon = c.icon;
            return (
              <Reveal key={c.title} delay={i * 0.1}>
                <article className={`switch-card tone-${c.tone}`}>
                  <span className="ico"><Icon aria-hidden /></span>
                  <h3>{c.title}</h3>
                  <p>{c.lead}</p>
                  <ol>{c.steps.map(s => <li key={s}>{s}</li>)}</ol>
                  <small>{c.note}</small>
                  <a className="go" href={c.href} target="_blank" rel="noreferrer">Read the steps <ArrowRight size={16} aria-hidden /></a>
                </article>
              </Reveal>
            );
          })}
        </div>
      </div>
    </section>
  );
}
