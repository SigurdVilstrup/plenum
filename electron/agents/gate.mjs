const TAIL = ' The user can change this in Plenum → Settings → Agents.';

/**
 * Decide whether an MCP tool call is allowed under the agent settings.
 * @returns {string | null} null when allowed, else the message to return to the agent.
 */
export function refusal(name, args, settings) {
  if (name === 'lane.up' && args?.force) {
    return "Refused: agents can't start a lane with force, because that skips the migration check. Ask the user to start this lane from the Plenum board.";
  }
  if (name === 'lane.remove' && args?.force) {
    return "Refused: agents can't remove a lane with force, because that discards uncommitted work. Ask the user to remove this lane from the Plenum board.";
  }
  if ((name === 'lane.up' || name === 'lane.down' || name === 'lane.test') && !settings.run) {
    return 'Refused: starting, stopping and testing lanes is turned off for agents.' + TAIL;
  }
  if (name === 'lane.create' && !settings.create) {
    return 'Refused: creating lanes is turned off for agents.' + TAIL;
  }
  if (name === 'lane.remove' && settings.remove !== 'allow') {
    return 'Refused: removing lanes is turned off for agents.' + TAIL;
  }
  if (name === 'repo.doctor' && args?.write && settings.writeSetup !== 'allow') {
    return 'Refused: writing lane setup is turned off for agents.' + TAIL;
  }
  return null;
}
