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
import { exact } from './hans/exact';
import { time } from './hans/time';
import { pinnames } from './hans/pinnames';
import { newModules } from './hans/newmodules';
import { geo } from './hans/geo';
import { color } from './hans/color';
import { engines } from './hans/engines';

export const zhHans: Record<string, string> = { ...engines, ...color, ...geo, ...newModules, ...actors, ...time, ...pinnames, ...numfmt, ...exact, ...files, ...nodes, ...content, ...docs, ...extra, ...ui, ...faces, ...docsUi };
