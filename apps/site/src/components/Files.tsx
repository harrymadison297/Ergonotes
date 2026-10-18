import { Check, File, FileText, Folder, FolderOpen } from 'lucide-react';
import { Reveal } from './motion';

export function Files() {
  return (
    <section className="section" id="files">
      <div className="wrap files">
        <Reveal>
          <span className="eyebrow">Your files, your folder</span>
          <h2 className="h2" style={{ marginTop: 16 }}>Delete the app and keep every note</h2>
          <p className="lead" style={{ marginTop: 16 }}>A vault is a directory. The Markdown files in it are the notes. Drop a pile of <code>.md</code> files in and they just work; edit them elsewhere and Ergonotes follows.</p>
          <ul className="tree" aria-label="An example vault">
            <li><FolderOpen aria-hidden /> Ergonotes vault</li>
            <li className="i1"><Folder aria-hidden /> Inbox <small>new notes land here</small></li>
            <li className="i1"><Folder aria-hidden /> Projects <small>PARA</small></li>
            <li className="i2"><FileText aria-hidden /> Ergonotes demo plan.md</li>
            <li className="i1"><Folder aria-hidden /> Areas · Resources · Archive</li>
            <li className="i1"><File aria-hidden /> .habits/Run.md <small>hidden, still plain text</small></li>
          </ul>
        </Reveal>
        <Reveal delay={0.1}>
          <div className="code" role="img" aria-label="A Markdown note with frontmatter, a task with a due date, an event and a formula">
            <div className="code-bar"><i /><i /><i /> Projects/Half marathon.md</div>
<pre>{`​`}<span className="c">---</span>{'\n'}
<span className="k">tags</span>: [<span className="s">project</span>, <span className="s">running</span>]{'\n'}
<span className="k">pinned</span>: <span className="p">true</span>{'\n'}
<span className="c">---</span>{'\n\n'}
<span className="h"># Half marathon</span>{'\n\n'}
Race day <span className="d">@event(2026-11-25)</span>{'\n\n'}
Pace: <span className="p">$t / d = 6300 / 21.0975$</span>{'\n\n'}
- [ ] Book the race hotel <span className="d">@due(2026-10-27)</span>{'\n'}
- [x] Long run, 14 km{'\n\n'}
<span className="c">```mermaid</span>{'\n'}
flowchart LR  Run --&gt; Rest --&gt; Run{'\n'}
<span className="c">```</span></pre>
          </div>
        </Reveal>
      </div>
      <div className="wrap">
        <Reveal>
          <ul className="points" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', display: 'grid', gap: 24 }}>
            {['Standard Markdown: toggles, diagrams, formulas and tasks have plain forms', 'What the app does not understand is kept byte for byte', 'Links are ordinary Markdown links, rewritten when you rename or move a note'].map(t => (
              <li key={t}><Check aria-hidden /> <span>{t}</span></li>
            ))}
          </ul>
        </Reveal>
      </div>
    </section>
  );
}
