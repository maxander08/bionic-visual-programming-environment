// Simplified Chinese for the Color module (HSV, CMYK, Pantone and Hex models) and its pins and settings.
// Traditional Chinese is generated from this dictionary by scripts/i18n/gen-hant.ts.
export const color: Record<string, string> = {
  // module
  'Color': '颜色',
  'Generates a color from HSV, CMYK, a Pantone code or a hex code.': '根据 HSV、CMYK、潘通编号或十六进制代码生成颜色。',
  'The Color model setting chooses how the color is written: HSV (hue, saturation, value), CMYK (cyan, magenta, yellow, black, in percent), Pantone (a code such as 485 C or 19-4052 TCX, or a name such as Classic Blue) or Hex (#rrggbb). Each model has its own setting pins, and the pins of the others are hidden. The color leaves as a swatch image, as hex text, as cyan, magenta, yellow and black numbers, and as the Pantone color it is or is closest to. Screens show CMYK and Pantone as approximations of the printed ink.':
    '“颜色模型”设置决定颜色的表示方式：HSV（色相、饱和度、明度）、CMYK（青、品红、黄、黑，以百分比表示）、潘通（编号如 485 C 或 19-4052 TCX，或名称如 Classic Blue）或十六进制（#rrggbb）。每种模型都有各自的设置引脚，其他模型的引脚会被隐藏。颜色会以色板图像、十六进制文本、青/品红/黄/黑数值，以及与之相同或最接近的潘通颜色输出。屏幕上的 CMYK 和潘通颜色只是印刷油墨的近似效果。',
  'A hex code that is not #rgb or #rrggbb raises an error.': '不是 #rgb 或 #rrggbb 的十六进制代码会报错。',
  'A Pantone code or name the program does not know raises an error.': '程序不认识的潘通编号或名称会报错。',
  '“{q}” is not a Pantone color the program knows. Try a code such as 485 C or 19-4052 TCX, or a name such as Classic Blue.': '“{q}”不是程序认识的潘通颜色。请尝试 485 C 或 19-4052 TCX 这样的编号，或 Classic Blue 这样的名称。',
  '“{q}” is not a hex color. Write it as #rrggbb or #rgb, for example #0a7aff.': '“{q}”不是十六进制颜色。请写成 #rrggbb 或 #rgb，例如 #0a7aff。',
  // pins and settings
  'Color model': '颜色模型',
  'HSV': 'HSV', 'CMYK': 'CMYK', 'Pantone': '潘通',
  'Magenta': '品红', 'Black': '黑色',
  'How the color is written: HSV, CMYK, Pantone or Hex. Each model has its own settings.': '颜色的表示方式：HSV、CMYK、潘通或十六进制。每种模型都有各自的设置。',
  'Hue 0–1. Used in the HSV model.': '色相 0–1。在 HSV 模型中使用。',
  'Saturation 0–1. Used in the HSV model.': '饱和度 0–1。在 HSV 模型中使用。',
  'Value 0–1. Used in the HSV model.': '明度 0–1。在 HSV 模型中使用。',
  'A solid 8×8 image of the color.': '该颜色的 8×8 纯色图像。',
  'The color as #rrggbb.': '以 #rrggbb 表示的颜色。',
  'The cyan of the color in CMYK, 0–100 %.': '颜色的 CMYK 青色值，0–100 %。',
  'The magenta of the color in CMYK, 0–100 %.': '颜色的 CMYK 品红值，0–100 %。',
  'The yellow of the color in CMYK, 0–100 %.': '颜色的 CMYK 黄色值，0–100 %。',
  'The black (key) of the color in CMYK, 0–100 %.': '颜色的 CMYK 黑色（K）值，0–100 %。',
  'The Pantone color: the one asked for in the Pantone model, otherwise the closest Pantone color, as text such as PANTONE 19-4052 TCX Classic Blue.': '潘通颜色：潘通模型下为所设定的颜色，否则为最接近的潘通颜色，文本形式如 PANTONE 19-4052 TCX Classic Blue。',
  'Amount of cyan ink, 0–100 %. Used when the model is CMYK.': '青色油墨的用量，0–100 %。模型为 CMYK 时使用。',
  'Amount of magenta ink, 0–100 %. Used when the model is CMYK.': '品红油墨的用量，0–100 %。模型为 CMYK 时使用。',
  'Amount of yellow ink, 0–100 %. Used when the model is CMYK.': '黄色油墨的用量，0–100 %。模型为 CMYK 时使用。',
  'Amount of black ink, 0–100 %. Used when the model is CMYK.': '黑色油墨的用量，0–100 %。模型为 CMYK 时使用。',
  'A Pantone code such as 485 C or 19-4052 TCX, or a name such as Classic Blue. Used when the model is Pantone.': '潘通编号（如 485 C 或 19-4052 TCX）或名称（如 Classic Blue）。模型为潘通时使用。',
  'A hex color: #rrggbb or #rgb. Used when the model is Hex.': '十六进制颜色：#rrggbb 或 #rgb。模型为十六进制时使用。',
};
