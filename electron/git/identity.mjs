import { git } from './run.mjs';

async function read(args, cwd) {
  try {
    return (await git(['config', ...args], cwd)).trim();
  } catch {
    return ''; // unset: git config exits 1
  }
}

async function scope(flag, cwd) {
  return { name: await read([flag, 'user.name'], cwd), email: await read([flag, 'user.email'], cwd) };
}

/** Global identity, plus the repo's own override when `root` is given. */
export async function getIdentity(root) {
  return {
    global: await scope('--global', root || undefined),
    local: root ? await scope('--local', root) : null,
  };
}

function clean(v, label) {
  const s = String(v ?? '').trim();
  if (/[\r\n\0]/.test(s) || s.startsWith('-')) throw new Error(`Invalid ${label}.`);
  return s;
}

/** Empty value removes the key. */
export async function setIdentity(root, { scope: where, name, email }) {
  if (where !== 'global' && where !== 'local') throw new Error('Invalid scope.');
  if (where === 'local' && !root) throw new Error('No repository open.');
  const flag = where === 'global' ? '--global' : '--local';
  for (const [key, value] of [['user.name', clean(name, 'name')], ['user.email', clean(email, 'email')]]) {
    if (value) await git(['config', flag, key, value], root || undefined);
    else await git(['config', flag, '--unset', key], root || undefined).catch(() => {}); // exit 5 when already unset
  }
  return getIdentity(root);
}
