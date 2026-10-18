import { Moon, Star, Sun } from 'lucide-react';
import { useTheme } from '../theme';
import { REPO_URL, useStars } from '../github';

export function Nav() {
  const [theme, flip] = useTheme();
  const stars = useStars();
  return (
    <header className="nav">
      <div className="wrap nav-in">
        <a className="brand" href="#top" aria-label="Ergonotes, back to the top"><img src="/mark.svg" alt="" width="28" height="28" /> Ergonotes</a>
        <nav className="nav-links" aria-label="Sections">
          <a href="#features">Features</a><a href="#showcase">Tour</a><a href="#files">Your files</a><a href="#demo">Demo</a><a href="#download">Download</a>
        </nav>
        <div className="nav-end">
          <button className="icon-btn" onClick={flip} aria-label={theme === 'dark' ? 'Switch to the light theme' : 'Switch to the dark theme'}>{theme === 'dark' ? <Sun size={20} /> : <Moon size={20} />}</button>
          <a className="btn btn-star btn-sm" href={REPO_URL} target="_blank" rel="noreferrer" aria-label={stars === null ? 'Star Ergonotes on GitHub' : `Star Ergonotes on GitHub, ${stars} stars`}>
            <Star size={16} aria-hidden /> <span className="hide-sm">Star on GitHub</span><span className="sm-only">GitHub</span>{stars !== null && <span className="count">{stars}</span>}
          </a>
          <a className="btn btn-primary btn-sm hide-sm" href="#demo">Try the demo</a>
        </div>
      </div>
    </header>
  );
}
