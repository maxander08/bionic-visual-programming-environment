import type { Ctx, ModuleDef, PortDef } from '../types';
import { FILE_KINDS, descriptorOf, fileState, getFileInfo, type FileKind, type FileKindId } from '../files';
import { out, txt } from './kit';

// The Files section: twelve nodes, each holding one file of its kind. You put the file in by dragging it onto the node or by
// clicking the node (the inspector has the same controls). Only the file's name, size and type are saved in the program; the file
// itself stays in this browser (see runtime/files.ts), so a shared program arrives with the nodes but without the files.

const hidden = (key: string, label: string, doc: string) => txt(key, label, '', doc, { hidden: true, maxLength: 300 });
const PARAMS = [
  hidden('fileId', 'File id', 'Key of the file kept in this browser.'),
  hidden('fileName', 'File name', 'Name of the file in this node.'),
  hidden('fileExt', 'File extension', 'Extension of the file in this node.'),
  hidden('fileSize', 'File size', 'Size of the file in bytes.'),
  hidden('fileMime', 'File type', 'MIME type reported by the browser.'),
  hidden('fileModified', 'File modified', 'Last-modified time of the file.'),
];

const FILE = out('file', 'File', 'data', 'The file as a small record (name, extension, size, type, modified time). It never contains the file’s bytes.', 'bottom');
const LOADED = out('loaded', 'Loaded', 'bool', 'True, as an event, when the program starts with a file in the node or a new file arrives. Cleared when the node is emptied.', 'bottom');
const NAME = out('name', 'Name', 'text', 'The file name, for example report.pdf.', 'right');
const EXT = out('ext', 'Extension', 'text', 'The file extension in lower case, without the dot: pdf.', 'right');
const SIZE = out('size', 'Size', 'num', 'The size of the file in bytes.', 'right');

interface Spec {
  bottom?: PortDef[];
  right?: PortDef[];
  keywords: string;
  summary: string;
  runtime: string;
  errors?: string[];
  examples?: string[];
}

const CONTENT = (what: string) => out('content', 'Content', 'text', what, 'bottom');

const SPECS: Record<FileKindId, Spec> = {
  document: {
    bottom: [CONTENT('The text of a .DOCX document: paragraphs separated by new lines. Empty for the old binary .DOC format, which cannot be read here.')],
    keywords: 'word docx doc letter report paperwork microsoft writer',
    summary: 'Holds a word-processor document: .DOCX or .DOC.',
    runtime: 'Drag a document onto the node, or click the node to choose one. For .DOCX the plain text is pulled out of the file and sent on the Content pin (formatting, pictures and tables’ layout are not kept). The old binary .DOC format is stored and described but its text is not readable in the browser. The file stays in this browser.',
    errors: ['A .DOCX that is damaged or password-protected gives a warning and no Content.'],
    examples: ['Document Content → Text Display: read a letter inside the program.', 'Document Name → Projector: show which document is loaded.'],
  },
  text: {
    bottom: [CONTENT('The whole text of the file (the first 1 000 000 characters). RTF is sent as its raw markup.')],
    right: [out('lines', 'Lines', 'num', 'Number of lines in the text.', 'right')],
    keywords: 'markdown md txt rtf plain notes read string',
    summary: 'Holds a text file: .MD, .TXT or .RTF.',
    runtime: 'Drag a text file onto the node, or click it to choose one. The text is read (as UTF-8) and sent on the Content pin, with the number of lines on Lines. Very long files are cut at 1 000 000 characters and the node says so. RTF files are sent as their raw markup, not as formatted text.',
    errors: ['A file that is cut off at the limit raises a warning.'],
    examples: ['Text Content → String: use a file’s words as data.', 'Text Content → Sense (sentiment package): score the mood of a document.'],
  },
  pdf: {
    keywords: 'pdf portable document paper acrobat',
    summary: 'Holds a PDF file.',
    runtime: 'Drag a PDF onto the node, or click it to choose one. The node reports the file’s name, extension and size and sends the File record. The text inside the PDF is not extracted.',
    examples: ['PDF Size → Threshold: react when a file is large.', 'PDF File → another program’s Files node: pass the record along.'],
  },
  audio: {
    bottom: [out('duration', 'Duration', 'num', 'Length of the recording in seconds, when the browser can read it.', 'bottom')],
    keywords: 'sound music song mp3 wav m4a flac aac ogg recording',
    summary: 'Holds an audio file: .MP3, .WAV, .M4A, .FLAC, .AAC or .OGG.',
    runtime: 'Drag a recording onto the node, or click it to choose one. The browser reads the file’s header to find its length, which is sent on Duration. The audio is not played by this node. Codecs the browser cannot read leave Duration empty and say so in the inspector.',
    errors: ['A format this browser cannot decode (FLAC or OGG on some systems) has no Duration; the node still holds the file.'],
    examples: ['Audio Duration → Timer: count down the length of a track.'],
  },
  video: {
    bottom: [
      out('duration', 'Duration', 'num', 'Length of the video in seconds, when the browser can read it.', 'bottom'),
      out('width', 'Width', 'num', 'Picture width in pixels.', 'bottom'),
      out('height', 'Height', 'num', 'Picture height in pixels.', 'bottom'),
    ],
    keywords: 'movie film clip mp4 mov mkv webm avi recording',
    summary: 'Holds a video file: .MP4, .MOV, .MKV, .WEBM or .AVI.',
    runtime: 'Drag a video onto the node, or click it to choose one. The browser reads the file’s header for the length and picture size, and a still frame is shown on the node. The video is not played. Formats the browser cannot read (MKV and AVI in most browsers) are still stored; their Duration, Width and Height stay empty.',
    errors: ['A format this browser cannot decode has no Duration, Width, Height or still frame; the node still holds the file.'],
    examples: ['Video Duration → Meter: plot clip lengths.'],
  },
  image: {
    bottom: [
      out('image', 'Image', 'image', 'The picture, scaled down to at most 256 px on its longer side so it stays quick to pass around.', 'bottom'),
      out('width', 'Width', 'num', 'Original picture width in pixels.', 'bottom'),
      out('height', 'Height', 'num', 'Original picture height in pixels.', 'bottom'),
    ],
    keywords: 'picture photo jpg jpeg png gif svg webp tiff tif graphic',
    summary: 'Holds a picture: .JPG/.JPEG, .PNG, .GIF, .SVG, .WEBP or .TIFF.',
    runtime: 'Drag a picture onto the node, or click it to choose one. It is decoded by the browser, shown on the node, and sent on Image (scaled to at most 256 px on the long side) with its real Width and Height. Animated GIFs give their first frame. TIFF is only decoded by some browsers; if yours cannot, the file is kept but Image stays empty.',
    errors: ['A picture the browser cannot decode (TIFF in most browsers, a broken file) gives a warning and no Image.'],
    examples: ['Image Image → Sense or Knowledge: analyze a picture.', 'Image Image → Image Display: see the picture elsewhere on the workspace.'],
  },
  spreadsheet: {
    bottom: [CONTENT('The text of a .CSV or .SQL file (the first 1 000 000 characters). Empty for .XLSX, .XLS and .ACCDB, which are binary workbooks and databases.')],
    right: [out('lines', 'Lines', 'num', 'Number of lines in a .CSV or .SQL file.', 'right')],
    keywords: 'excel xlsx xls csv sql database table accdb access rows workbook',
    summary: 'Holds a spreadsheet or table file: .XLSX, .XLS, .CSV, .SQL or .ACCDB.',
    runtime: 'Drag a table file onto the node, or click it to choose one. Plain-text tables (.CSV and .SQL) are read: the text goes to Content and the line count to Lines. Workbooks and databases (.XLSX, .XLS, .ACCDB) are stored and described but their cells are not read.',
    errors: ['A file that is cut off at the limit raises a warning.'],
    examples: ['Spreadsheet Content → Array: split rows into a list.'],
  },
  presentation: {
    bottom: [CONTENT('The text on the slides of a .PPTX file, with a heading line for each slide.')],
    right: [out('slides', 'Slides', 'num', 'Number of slides in the presentation.', 'right')],
    keywords: 'powerpoint pptx slides deck keynote slideshow',
    summary: 'Holds a slide presentation: .PPTX.',
    runtime: 'Drag a presentation onto the node, or click it to choose one. The slide count is sent on Slides and the text found on the slides (not pictures or notes) on Content, one block per slide.',
    errors: ['A damaged .PPTX gives a warning and no Content.'],
    examples: ['Presentation Slides → Projector: show the slide count.'],
  },
  executable: {
    keywords: 'exe msi app bat sh program installer script binary command',
    summary: 'Holds a program or script file: .EXE, .MSI, .APP, .BAT or .SH.',
    runtime: 'Drag a program onto the node, or click it to choose one. The file is only described (name, extension, size). It is never run, opened or sent anywhere: the browser cannot run it, and this node does not try.',
    examples: ['Executable Name → Text Display: list the programs in a bundle.'],
  },
  web: {
    bottom: [CONTENT('The source text of the file (the first 1 000 000 characters). It is text only: nothing is run or rendered.')],
    keywords: 'html css js javascript php website page source code script stylesheet',
    summary: 'Holds a web file: .HTML, .CSS, .JS or .PHP.',
    runtime: 'Drag a web file onto the node, or click it to choose one. The source is read as text and sent on Content. It is never run, rendered or fetched: a script stays inert text.',
    errors: ['A file that is cut off at the limit raises a warning.'],
    examples: ['Web Content → Text Display: read a page’s source.'],
  },
  compressed: {
    right: [out('entries', 'Entries', 'num', 'Number of files inside a .ZIP archive. Empty for the other archive types.', 'right')],
    keywords: 'zip rar 7z tar gz gzip archive bundle package compress',
    summary: 'Holds an archive: .ZIP, .RAR, .7Z, .TAR or .GZ.',
    runtime: 'Drag an archive onto the node, or click it to choose one. For .ZIP files the number of files inside is sent on Entries (nothing is unpacked). The other types are stored and described but not opened.',
    errors: ['A damaged .ZIP gives a warning and no Entries.'],
    examples: ['Compressed Entries → Threshold: react to a bulky bundle.'],
  },
  misc: {
    keywords: 'other any unknown anything else file binary data',
    summary: 'Holds any file that none of the other Files nodes takes.',
    runtime: 'Drag any file onto the node, or click it to choose one. Files that belong to another Files node (a PDF, a picture…) are turned away with a hint about which node to use. The file is described by its name, extension and size.',
    examples: ['Miscellaneous Extension → Compare: branch on the file type.'],
  },
};

const ALL_OUT_IDS = (def: { outputs: PortDef[] }) => def.outputs.map((p) => p.id);

function runFor(kind: FileKind, outIds: string[]) {
  return (c: Ctx) => {
    const none = () => outIds.forEach((id) => c.emit(id, undefined));
    const id = c.str('fileId');
    const name = c.str('fileName');
    if (!id) { none(); c.state.last = ''; c.view({ state: 'empty' }); return; }
    const info = getFileInfo(id);
    if (!info) {
      none();
      c.state.last = '';
      const st = fileState(id);
      c.view({ state: st === 'loading' ? 'loading' : 'missing', name });
      if (st !== 'loading') c.warn(`“${name}” is not in this browser. Programs that were shared or imported do not carry their files: drop it on the node again.`);
      return;
    }
    c.emit('file', descriptorOf(kind, info));
    c.emit('name', info.name);
    c.emit('ext', info.ext);
    c.emit('size', info.size);
    if (c.state.last !== id) { c.state.last = id; c.emit('loaded', true, c.strength, true); }
    switch (kind.id) {
      case 'document': case 'text': case 'spreadsheet': case 'presentation': case 'web': c.emit('content', info.text); break;
      case 'image': case 'video': c.emit('width', info.width); c.emit('height', info.height); break;
    }
    if (kind.id === 'image') c.emit('image', info.image);
    if (kind.id === 'audio' || kind.id === 'video') c.emit('duration', info.duration);
    if (kind.id === 'text' || kind.id === 'spreadsheet') c.emit('lines', info.lines);
    if (kind.id === 'presentation') c.emit('slides', info.slides);
    if (kind.id === 'compressed') c.emit('entries', info.entries);
    if (info.warn) c.warn(info.warn);
    c.view({ state: 'ready', name: info.name });
  };
}

export const files: ModuleDef[] = FILE_KINDS.map((kind): ModuleDef => {
  const s = SPECS[kind.id];
  const outputs = [FILE, LOADED, ...(s.bottom ?? []), NAME, EXT, SIZE, ...(s.right ?? [])];
  return {
    type: kind.type, name: kind.name, caption: kind.caption, category: 'Files', family: 'file', glyph: kind.glyph, size: 'square',
    keywords: `file ${kind.exts.join(' ')} ${s.keywords}`,
    source: true,
    inputs: [],
    outputs,
    params: PARAMS,
    run: runFor(kind, ALL_OUT_IDS({ outputs })),
    doc: {
      summary: s.summary,
      runtime: s.runtime,
      errors: s.errors,
      examples: s.examples,
    },
  };
});
