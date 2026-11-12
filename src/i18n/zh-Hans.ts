// Simplified Chinese (zh-Hans). English text is the key; see index.ts. Traditional Chinese is generated from this file.
import { content } from './hans/content';
import { docs } from './hans/docs';
import { extra } from './hans/extra';
import { nodes } from './hans/nodes';
import { ui } from './hans/ui';

export const zhHans: Record<string, string> = { ...nodes, ...content, ...docs, ...extra, ...ui };
