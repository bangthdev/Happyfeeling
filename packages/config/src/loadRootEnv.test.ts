import { afterEach, describe, expect, it } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { pathToFileURL } from 'url';
import { loadRootEnv } from './loadRootEnv.js';

describe('loadRootEnv', () => {
  const ENV_VAR = 'LOAD_ROOT_ENV_TEST_VAR';

  afterEach(() => {
    delete process.env[ENV_VAR];
  });

  it('loads .env from three directories above the caller module', () => {
    const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'load-root-env-'));
    fs.writeFileSync(path.join(tmpRoot, '.env'), `${ENV_VAR}=hello\n`);
    const fakeCallerDir = path.join(tmpRoot, 'packages', 'example', 'src');
    fs.mkdirSync(fakeCallerDir, { recursive: true });
    const fakeCallerModuleUrl = pathToFileURL(
      path.join(fakeCallerDir, 'index.ts'),
    ).href;

    loadRootEnv(fakeCallerModuleUrl);

    expect(process.env[ENV_VAR]).toBe('hello');
  });
});
