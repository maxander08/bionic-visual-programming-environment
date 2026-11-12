// Simplified Chinese: patterns for generated text (Quantities modules) and the Workspace Settings module.
const what: Record<string, string> = {
  'a span of time': '一段时间', 'a length or distance': '长度或距离', 'a mass': '质量', 'an electric current': '电流', 'a temperature': '温度',
  'an amount of substance': '物质的量', 'a luminous intensity': '发光强度', 'a plane angle': '平面角', 'a solid angle': '立体角', 'a frequency': '频率',
  'a rotational speed': '转速', 'a force': '力', 'a pressure': '压强', 'an amount of energy': '能量', 'a power': '功率', 'an electric charge': '电荷',
  'an electric potential': '电势（电压）', 'a capacitance': '电容', 'an electric resistance': '电阻', 'an electric conductance': '电导',
  'a magnetic flux': '磁通量', 'a magnetic flux density': '磁通密度', 'an inductance': '电感', 'a luminous flux': '光通量', 'an illuminance': '照度',
  'a radioactivity': '放射性活度', 'an absorbed radiation dose': '吸收剂量', 'an equivalent radiation dose': '当量剂量', 'a catalytic activity': '催化活性',
  'a volume': '体积', 'a magnetic field strength': '磁场强度', 'a kinematic viscosity': '运动粘度', 'a dynamic viscosity': '动力粘度',
  'an acceleration': '加速度', 'an exposure to ionizing radiation': '电离辐射照射量', 'a speed': '速度',
};

export const extra: Record<string, string> = {
  ...what,
  'Holds {what} as an amount with a unit, such as {ex}, and converts it between units and SI prefixes.': '将{what}保存为带单位的数值，例如 {ex}，并可在各单位和 SI 前缀之间转换。',
  'How much of {what}, in the prefix and unit chosen below.': '{what}的数值，使用下方选择的前缀和单位。',
  'The unit of the amount: {list}.': '数值的单位：{list}。',
  'SI prefix, a power of ten placed in front of the unit: every unit takes every one of the 24 prefixes. “auto” picks the step of 1000 that keeps the amount between 1 and 999.': 'SI 前缀，即放在单位前面的 10 的幂：每个单位都可使用全部 24 个前缀。“auto”会选取使数值保持在 1 到 999 之间的 1000 倍步长。',
  'Free text shown on the workspace. It has no effect on execution.': '显示在工作区上的自由文本。它不影响执行。',
  'Credit shown on the program. It is a label, not a verified identity.': '显示在程序上的署名。它只是一个标签，并非经过验证的身份。',
  'None. Long notes wrap and are clipped inside the node; the full text is in the inspector.': '无。较长的备注会换行并在节点内被裁剪；完整文本在检查器中。',
  'None. This is plain text: it is not a signature and does not prove who made the program.': '无。这只是纯文本：它不是签名，也不能证明程序的作者。',

  // Set Language module
  'A truthy arrival applies the language now. Connect a switch, a button or a pulse to it.': '收到真值时立即应用语言。可连接开关、按钮或脉冲。',
  'Code of the language this module is set to: en, zh-Hans or zh-Hant.': '此模块所设语言的代码：en、zh-Hans 或 zh-Hant。',
  'The language written in itself, for example 简体中文.': '以该语言自身书写的语言名称，例如 简体中文。',
  'True, as an event, every time the module applies its language to the workspace.': '每当模块把语言应用到工作区时，以事件形式输出为真。',
  'The interface language the workspace switches to: English, Simplified Chinese (zh-Hans) or Traditional Chinese (zh-Hant).': '工作区要切换到的界面语言：英语、简体中文 (zh-Hans) 或繁体中文 (zh-Hant)。',
  'Auto switches the language when the program starts and whenever the Language setting changes. Signal waits for a truthy arrival on the Apply pin.': '“自动”会在程序启动时以及“语言”设置更改时切换语言。“信号”则等待“应用”引脚收到真值。',
  'Keep the language the next time this browser opens the editor. Off: it only lasts for this session.': '下次在此浏览器中打开编辑器时保留该语言。关闭：仅在本次会话中有效。',
  'Show a short message when the language actually switches.': '语言实际切换时显示一条简短提示。',
  'Switches the language of the whole editor: English, Simplified Chinese or Traditional Chinese.': '切换整个编辑器的语言：英语、简体中文或繁体中文。',
  'In Auto mode the language is applied when the program starts and again whenever the Language setting (or its pin) changes. In Signal mode it is applied each time a truthy value reaches Apply. It changes the editor, not the program: signals, saved programs and share codes are identical in every language. The language is also available in Settings on the toolbar.': '在“自动”模式下，语言会在程序启动时应用，并在“语言”设置（或其引脚）更改时再次应用。在“信号”模式下，每当有真值到达“应用”时就应用一次。它改变的是编辑器而不是程序：信号、已保存的程序和分享代码在所有语言下都完全相同。也可以在工具栏的“设置”中选择语言。',
  'A Language pin that carries an unknown code falls back to English.': '“语言”引脚传来未知代码时，会回退为英语。',
  'Auto, Language = zh-Hant: the editor switches to Traditional Chinese when you press Run.': '自动，语言 = zh-Hant：按下“运行”时，编辑器切换为繁体中文。',
  'Signal mode with a Switch on Apply: flip the switch to change language.': '信号模式，并在“应用”上连接一个开关：拨动开关即可切换语言。',
};
