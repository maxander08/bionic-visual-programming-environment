// Simplified Chinese (zh-Hans). English text is the key; see index.ts. Traditional Chinese is generated from this file.
import { content } from './hans/content';
import { docs } from './hans/docs';
import { extra } from './hans/extra';
import { nodes } from './hans/nodes';
import { ui } from './hans/ui';
import { faces } from './hans/faces';
import { docsUi } from './hans/docsui';
import { files } from './hans/files';
import { actors } from './hans/actors';
import { numfmt } from './hans/numfmt';

export const zhHans: Record<string, string> = { ...actors, ...numfmt, ...files, ...nodes, ...content, ...docs, ...extra, ...ui, ...faces, ...docsUi };
