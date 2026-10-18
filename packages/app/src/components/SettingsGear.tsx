import { Settings as SettingsIcon } from 'lucide-react';
import { mcpNeedsAttention, useMcpInfo } from '../backend/desktopMcp';

/** The gear of Settings; a red dot when the agent endpoint is on but cannot run (its port is taken). */
export function SettingsGear({ size = 18 }: { size?: number }) {
  const bad = mcpNeedsAttention(useMcpInfo());
  return (
    <span className="gear">
      <SettingsIcon size={size} />
      {bad && <i className="red-dot" role="img" aria-label="The agent endpoint needs attention" />}
    </span>
  );
}
