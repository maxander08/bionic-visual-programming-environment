// Simplified Chinese: text that is drawn on node faces (chips, glyph abbreviations, titles, unit names, runtime phrases).
//
// Keys starting with `face:` are single words, lower-case. `trFace()` in ../index.ts looks every word of a short face
// string up here, so "sine 1 Hz" becomes "正弦 1 Hz" without a dictionary entry per combination. Keys starting with
// `city:` are World Clock / Alarm city names (`trPlace()`), kept apart so a city such as “Nice” can never translate
// ordinary interface text.
import { cities } from './cities';

const words: Record<string, string> = {
  // sense titles
  'face:sense': '感觉', 'face:auto': '自动', 'face:brightness': '亮度', 'face:contrast': '对比度', 'face:change': '变化', 'face:raw': '原始',
  'face:level': '电平', 'face:onset': '起始', 'face:motion': '运动', 'face:edge': '边缘', 'face:color': '颜色', 'face:trend': '趋势',
  // glyph abbreviations on chips
  'face:by': '署名', 'face:int': '整数', 'face:dec': '小数', 'face:str': '文本', 'face:chr': '字符', 'face:bool': '布尔',
  'face:seq': '序列', 'face:env': '包络', 'face:zz': '休眠', 'face:hz': 'Hz',
  // chip words
  'face:hold': '保持', 'face:open?': '通?', 'face:block': '阻断', 'face:if': '若', 'face:suspend': '暂停', 'face:steps': '步', 'face:step': '步',
  'face:negate': '取反', 'face:complement': '补数', 'face:invert': '反相', 'face:reciprocal': '倒数',
  'face:rise': '上升', 'face:fall': '下降', 'face:delta': '差值', 'face:cross-up': '上穿', 'face:cross-down': '下穿',
  'face:sum': '求和', 'face:mean': '平均', 'face:product': '乘积', 'face:join': '连接', 'face:list': '列表', 'face:min': '最小', 'face:max': '最大',
  'face:latest': '最新', 'face:override': '覆盖', 'face:priority': '优先', 'face:strongest': '最强', 'face:first': '最先', 'face:weakest': '最弱',
  'face:sine': '正弦', 'face:square': '方波', 'face:saw': '锯齿', 'face:triangle': '三角', 'face:noise': '噪声',
  'face:browser': '浏览器', 'face:abs': '绝对值', 'face:sqrt': '平方根',
  'face:am': '上午', 'face:pm': '下午',
  // port types
  'face:any': '任意', 'face:num': '数值', 'face:text': '文本', 'face:image': '图像', 'face:data': '数据',
};

const text: Record<string, string> = {
  // runtime phrases drawn on faces
  'This device': '本设备', 'in {t}': '{t}后',
  // default descriptive text of modules that never take part in execution
  'Note to self': '给自己的备注', 'anonymous': '匿名',
  // unit names shown under quantity faces
  'steradian': '球面度', 'becquerel': '贝克勒尔', 'candela': '坎德拉', 'coulomb': '库仑', 'siemens': '西门子', 'sievert': '希沃特',
  'gram (kg = kilogram)': '克（kg = 千克）', 'weber': '韦伯', 'tesla': '特斯拉', 'henry': '亨利', 'lumen': '流明', 'lux': '勒克斯',
  'gray': '戈瑞', 'katal': '开特', 'ohm': '欧姆', 'farad': '法拉', 'volt': '伏特', 'watt': '瓦特', 'joule': '焦耳', 'pascal': '帕斯卡',
  'newton': '牛顿', 'hertz': '赫兹', 'radian': '弧度', 'mole': '摩尔', 'kelvin': '开尔文', 'ampere': '安培', 'kilogram': '千克',
  'metre': '米', 'second': '秒',
};

export const faces: Record<string, string> = { ...words, ...text, ...cities };
