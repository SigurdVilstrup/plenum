import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { writeBuildInfo } from '../electron/build-info.mjs';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
writeBuildInfo(path.join(root, 'electron', 'build-info.json'));
