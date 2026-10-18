import { Demo } from './components/Demo';
import { Download } from './components/Download';
import { Features, Strip } from './components/Features';
import { Files } from './components/Files';
import { Footer } from './components/Footer';
import { Hero } from './components/Hero';
import { Nav } from './components/Nav';
import { Showcase } from './components/Showcase';
import { StarCta } from './components/StarCta';
import { Switch } from './components/Switch';
import { Sync } from './components/Sync';

export function App() {
  return (
    <>
      <Nav />
      <main>
        <Hero />
        <Strip />
        <Features />
        <Showcase />
        <Files />
        <Sync />
        <Demo />
        <Switch />
        <Download />
        <StarCta />
      </main>
      <Footer />
    </>
  );
}
