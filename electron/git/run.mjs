import { spawn } from 'node:child_process';

/** Run git; reject on non-zero. Read stdout/stderr in parallel to avoid pipe stalls. */
export function git(args, cwd) {
  return new Promise((resolve, reject) => {
    const child = spawn('git', ['--no-pager', '-c', 'core.quotepath=false', ...args], {
      cwd,
      env: {
        ...process.env,
        GIT_TERMINAL_PROMPT: '0',
        GIT_OPTIONAL_LOCKS: '0',
      },
    });
    let out = '';
    let err = '';
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (d) => { out += d; });
    child.stderr.on('data', (d) => { err += d; });
    child.on('error', reject);
    child.on('close', (code) => {
      if (code === 0) resolve(out);
      else reject(new Error((err || out || `git ${args.join(' ')} failed`).trim()));
    });
  });
}

export async function gitOk(args, cwd) {
  try {
    await git(args, cwd);
    return true;
  } catch {
    return false;
  }
}
