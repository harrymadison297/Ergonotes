import type { MoodName } from '../state/mood';
import crown from '../assets/mood/crown.svg?raw';
import annoyed from '../assets/mood/annoyed.svg?raw';
import heartEyes from '../assets/mood/heart-eyes.svg?raw';
import angel from '../assets/mood/angel.svg?raw';
import surprised from '../assets/mood/surprised.svg?raw';
import sweat from '../assets/mood/sweat.svg?raw';
import sleeping from '../assets/mood/sleeping.svg?raw';
import relaxed from '../assets/mood/relaxed.svg?raw';
import sad from '../assets/mood/sad.svg?raw';
import delighted from '../assets/mood/delighted.svg?raw';

const SVG: Record<MoodName, string> = { crown, annoyed, 'heart-eyes': heartEyes, angel, surprised, sweat, sleeping, relaxed, sad, delighted };

/** A hand-drawn face, drawn in the text colour so it follows the theme. It says nothing a screen reader needs. */
export function Mood({ name, size = 44 }: { name: MoodName; size?: number }) {
  return <span className="mood" aria-hidden style={{ height: size, width: size }} dangerouslySetInnerHTML={{ __html: SVG[name] }} />;
}
