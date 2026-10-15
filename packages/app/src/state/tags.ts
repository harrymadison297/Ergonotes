/** Tag colours (docs/brand-guidelines.md). A tag's colour comes from its top-level name, so every device agrees. */
export const TAG_COLORS = ['#2dbe60', '#1fa59a', '#3d8bd9', '#c04f9c', '#7ea320', '#d9667f', '#e8892f', '#c9a21f'] as const;

/** Inline style that exposes a tag's colour to CSS as `--c`. */
export const tagStyle = (tag: string) => ({ ['--c' as string]: tagColor(tag) });

export function tagColor(tag: string): string {
  const root = tag.split('/')[0].toLowerCase();
  let h = 2166136261;
  for (let i = 0; i < root.length; i++) { h ^= root.charCodeAt(i); h = Math.imul(h, 16777619); }
  return TAG_COLORS[(h >>> 0) % TAG_COLORS.length];
}
