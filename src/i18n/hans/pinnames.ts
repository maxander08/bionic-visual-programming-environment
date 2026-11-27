// Simplified Chinese for “Show details” (the setting that adds a module's secondary lines to its face, and its setting pin)
// and for the “Setting pin names” workspace setting. Traditional Chinese is generated from this file (see zh-Hans.ts).
// The English keys of the module hints are built by the same sentence as `details()` in core/modules/kit.ts.
const hint = (what: string) => `Also show ${what} on the node. Leave it off to keep the node’s face short, since the same information is always there on the output pins and in the inspector.`;
const hintZh = (what: string) => `在节点上同时显示${what}。关闭时节点表面保持简洁；这些信息始终可以从模块的输出引脚和检查器中获得。`;

export const pinnames: Record<string, string> = {
  'Show details': '显示详情',
  [hint('the date and the UTC offset')]: hintZh('日期和 UTC 偏移'),
  [hint('the progress bar and the number of completions')]: hintZh('进度条和完成次数'),
  [hint('the latest lap')]: hintZh('最近一圈'),
  [hint('the time left and the place')]: hintZh('剩余时间和地点'),
  [hint('the name of the file being converted')]: hintZh('正在转换的文件名'),
  [hint('the quantity that was converted')]: hintZh('被换算的原始数量'),
  [hint('how the number is being formatted')]: hintZh('数字的格式说明'),
  [hint('the file’s type and size, and the kinds of file it takes')]: hintZh('文件的类型和大小，以及它接受的文件种类'),

  'Setting pin names': '设置引脚名称',
  'While a module is highlighted (pointed at, or selected with a tap), each of its setting pins shows what it’s for.': '高亮模块（指向它，或轻点选中）时，其每个设置引脚都会显示自己的用途名称。',
};
