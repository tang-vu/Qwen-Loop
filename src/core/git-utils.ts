import { spawn } from 'child_process';
import { logger } from '../logger.js';

/**
 * Run a command and return stdout
 */
function run(cmd: string, args: string[], cwd?: string): Promise<{ stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const proc = spawn(cmd, args, { cwd, shell: true, windowsHide: true });
    let stdout = '';
    let stderr = '';

    proc.stdout.on('data', (d: Buffer) => { stdout += d.toString(); });
    proc.stderr.on('data', (d: Buffer) => { stderr += d.toString(); });

    proc.on('close', (code) => {
      resolve({ stdout, stderr });
    });

    proc.on('error', (err) => {
      reject(err);
    });
  });
}

/**
 * Run git add + commit + push after each task
 */
export async function gitCommitPush(
  message: string,
  cwd: string
): Promise<{ success: boolean; output: string }> {
  try {
    // Check if there are changes to commit
    const { stdout: statusOut } = await run('git', ['status', '--porcelain'], cwd);

    if (!statusOut.trim()) {
      logger.info('No changes to commit');
      return { success: true, output: 'No changes to commit' };
    }

    // git add -A
    await run('git', ['add', '-A'], cwd);
    logger.info('Staged all changes');

    // git commit
    await run('git', ['commit', '-m', message], cwd);
    logger.info(`Committed: ${message}`);

    // git push
    const pushResult = await run('git', ['push'], cwd);
    logger.info('Pushed to remote');

    return { success: true, output: pushResult.stdout };
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    logger.error(`Git commit/push failed: ${msg}`);
    return { success: false, output: msg };
  }
}
