import data from './changelog.json' with { type: 'json' };
import { validateChangelog } from '../packages/contracts/src/changelog.ts';

export const CHANGELOG = validateChangelog(data);
