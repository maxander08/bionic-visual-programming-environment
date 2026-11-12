// Workspace Settings: modules that change how the editor itself behaves, rather than what the program computes.
// Their effect on the editor is carried out by the runtime (see runtime/outputs.ts); the module only decides *when*.
import type { ModuleDef } from '../types';
import { LANGS, langInfo, normalizeLang } from '../../i18n';
import { toBool } from '../util';
import { bol, inp, out, sel } from './kit';

export const workspace: ModuleDef[] = [
  {
    type: 'setlanguage', name: 'Set Language', caption: 'Set Language', category: 'Workspace Settings', family: 'workspace', glyph: '文A', size: 'small',
    keywords: 'language locale translate translation chinese simplified traditional english interface i18n 中文 简体 繁體 语言 語言',
    source: true,
    inputs: [inp('apply', 'Apply', 'any', 'A truthy arrival applies the language now. Connect a switch, a button or a pulse to it.', 'top', true)],
    outputs: [
      out('language', 'Language', 'text', 'Code of the language this module is set to: en, zh-Hans or zh-Hant.'),
      out('name', 'Name', 'text', 'The language written in itself, for example 简体中文.', 'right'),
      out('applied', 'Applied', 'bool', 'True, as an event, every time the module applies its language to the workspace.', 'right'),
    ],
    params: [
      sel('language', 'Language', 'en', LANGS.map((l): [string, string] => [l.code, l.native]), 'The interface language the workspace switches to: English, Simplified Chinese (zh-Hans) or Traditional Chinese (zh-Hant).'),
      sel('mode', 'Apply when', 'auto', [['auto', 'Program starts or setting changes'], ['signal', 'Apply pin receives a signal']], 'Auto switches the language when the program starts and whenever the Language setting changes. Signal waits for a truthy arrival on the Apply pin.'),
      bol('remember', 'Remember choice', true, 'Keep the language the next time this browser opens the editor. Off: it only lasts for this session.'),
      bol('notice', 'Show notice', true, 'Show a short message when the language actually switches.'),
    ],
    run(c) {
      const s = c.state;
      const lang = normalizeLang(c.str('language')) ?? 'en';
      const pulse = c.has('apply') && c.changed('apply') && toBool(c.get('apply'));
      const auto = c.str('mode') === 'auto' && s.last !== lang;
      c.emit('language', lang);
      c.emit('name', langInfo(lang).native);
      if (pulse || auto) {
        s.n = (s.n ?? 0) + 1;
        s.last = lang;
        c.emit('applied', true, c.strength, true);
      }
      // The runtime watches `n` and switches the editor when it grows.
      c.view({ lang, n: s.n ?? 0, remember: c.bool('remember'), notice: c.bool('notice'), mode: c.str('mode') });
    },
    doc: {
      summary: 'Switches the language of the whole editor: English, Simplified Chinese or Traditional Chinese.',
      runtime: 'In Auto mode the language is applied when the program starts and again whenever the Language setting (or its pin) changes. In Signal mode it is applied each time a truthy value reaches Apply. It changes the editor, not the program: signals, saved programs and share codes are identical in every language. The language is also available in Settings on the toolbar.',
      errors: ['A Language pin that carries an unknown code falls back to English.'],
      examples: ['Auto, Language = zh-Hant: the editor switches to Traditional Chinese when you press Run.', 'Signal mode with a Switch on Apply: flip the switch to change language.'],
    },
  },
];
