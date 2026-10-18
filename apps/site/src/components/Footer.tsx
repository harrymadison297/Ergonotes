import { REPO_URL, RELEASES_URL } from '../github';

export function Footer() {
  return (
    <footer className="footer">
      <div className="wrap footer-in">
        <div>
          <a className="brand" href="#top"><img src="/mark.svg" alt="" width="28" height="28" /> Ergonotes</a>
          <p>Your notes, on every device, readable by nobody else. Free and open source under the Apache License 2.0.</p>
        </div>
        <nav aria-label="Footer">
          <a href={REPO_URL} target="_blank" rel="noreferrer">GitHub</a>
          <a href={RELEASES_URL} target="_blank" rel="noreferrer">Releases</a>
          <a href={`${REPO_URL}/issues`} target="_blank" rel="noreferrer">Issues</a>
          <a href={`${REPO_URL}/blob/master/LICENSE`} target="_blank" rel="noreferrer">License</a>
          <a href="/demo/" target="_blank" rel="noreferrer">Demo</a>
        </nav>
      </div>
    </footer>
  );
}
