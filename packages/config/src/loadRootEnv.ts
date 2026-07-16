import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

export function loadRootEnv(callerModuleUrl: string): void {
  const callerDir = path.dirname(fileURLToPath(callerModuleUrl));
  dotenv.config({ path: path.resolve(callerDir, '../../../.env') });
}
