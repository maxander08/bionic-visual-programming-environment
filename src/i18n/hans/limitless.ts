// Simplified Chinese for the numbers that have no limit: exact quotients that repeat (written with an ellipsis), Integers of any size,
// exact number bases and settings without a range.
export const limitless: Record<string, string> = {
  /* Precision, Divisor, Math, Combine, Random */
  'How many significant digits to work out for results that never end and never repeat (√2, sin, e^x). Ask for as many as you like. Results that end (1 ÷ 8 = 0.125) or repeat (1 ÷ 3 = 0.333...) are always exact, and never cut or padded.': '永不终止也不循环的结果（√2、sin、e^x）计算到多少位有效数字；可以要求任意多位。会终止（1 ÷ 8 = 0.125）或循环（1 ÷ 3 = 0.333...）的结果是精确的，绝不截断或补零。',
  'out = a ÷ b, or a ÷ divisor if nothing is connected to b. The answer is always exact. If it ends (1 ÷ 8 = 0.125), you get every digit. If it never ends, it repeats, and it’s kept as the repeating number it is: 1 ÷ 3 is 0.33333..., with an ellipsis after the repeating digits, and 1 ÷ 3 × 3 is exactly 1.': 'out = a ÷ b；b 未连接时为 a ÷ 除数。商是精确的，不论有多少位。会终止的商（1 ÷ 8 = 0.125）完整写出；不会终止的商是循环小数，并按循环小数原样保存：1 ÷ 3 是 0.33333...，循环的数字后面带省略号，而 1 ÷ 3 × 3 恰好等于 1。',
  'Applies the chosen function to a (and b) using exact decimals. abs, square, floor, round, ceil, min, max, mod, and powers with a whole-number exponent are exact. That includes negative exponents (3 to the power −1 = 0.33333...) and square roots that end or repeat. sqrt, sin, cos, tanh, exp, log, and powers with a fractional exponent go on forever without repeating, so they’re worked out to the Precision setting (50 significant digits by default, or any number you like). sin and cos use radians.': '用精确小数对 a（和 b）计算所选函数。abs、square、floor、round、ceil、min、max、mod 以及整数指数的幂（负指数也可以，例如 3 的 −1 次方 = 0.33333...）都是精确的，会终止或循环的平方根也是精确的；sqrt、sin、cos、tanh、exp、log 以及小数指数的幂既不终止也不循环，所以按“精度”设置计算（默认 50 位有效数字，可设任意位数）。sin 和 cos 使用弧度。',
  'Only inputs that are connected and carrying a signal are counted. The numeric modes are exact (a mean that never ends repeats, and is kept exactly: 0.33333...), and show a warning if they get something that isn’t a number.': '只有已连接且有信号的输入才参与。数值模式是精确的（除不尽的平均数是循环小数，并被精确保存：0.33333...），遇到非数值会给出警告并拒绝。',
  'Picks a random number between min and max every 1/rate seconds of simulation time, with every value equally likely. The limits can be any numbers, with as many digits as you like. The same seed gives you the same sequence every time you Stop and Run again.': '在仿真时间里每隔 1/频率 秒，在最小值与最大值之间均匀取一个数。上下界可以是任意数字，位数不限，取值会遍布整个范围。相同的种子在“停止 → 运行”后总会产生相同的序列。',
  'Any number, with as many digits as you like{unit}.': '任意数字，位数不限{unit}。',

  /* Integer */
  'Any whole number. Use as many digits as you like, because there’s no biggest or smallest.': '要输出的整数。位数不限：整数没有最大值或最小值。',
  'A whole number like 7, −3 or 0, of any size. Anything you give it gets turned into an integer.': '整数，例如 7、−3 或 0，大小不限。把收到的任何内容转换为整数。',
  'Sends out the Value (or the converted Input) as a whole number, plus the same number as text in the Base you chose. Every digit is kept, no matter how many, until your device runs out of memory. The Rounding setting decides what happens to fractions.': '把“值”（或转换后的输入）作为整数输出，并以所选“进制”输出同一个数的文本。整数没有最大值或最小值：每一位都会保留，不论有多少位，直到设备内存用完为止。小数部分由“取整”设置变成整数。',

  /* Base Converter */
  'The same number as a plain decimal, exactly, with every digit it needs. A fraction that never ends repeats, and is kept as the repeating number it is (0.33333...).': '同一个数字的普通十进制表示，完全精确：保留所需的每一位，不论多少位。不会终止的小数是循环小数，并按循环小数原样保存（0.33333...）。',
  'Round the fraction': '舍入小数部分',
  'Off: every digit is written out. A fraction that never ends repeats, so its repeating digits are followed by an ellipsis (0.1 in base 2 is 0.00011001100110011...). On: the fraction is rounded to Fraction digits places.': '关闭：写出数字的每一位，不论多少位；不会终止的小数是循环小数，其循环的数字后面带省略号（二进制的 0.1 是 0.00011001100110011...）。开启：把小数部分舍入到“小数位数”位。',
  'How many digits to keep after the point in the To base when Round the fraction is on. The last digit is rounded to the nearest, and trailing zeros are dropped. 0 gives you a whole number.': '开启“舍入小数部分”时，目标进制中小数点后保留多少位。最后一位按最近值舍入，末尾的零会去掉。0 表示整数。',
  'Reads the number on the Number pin (or the Value setting) as digits in the From base, and writes it out in the To base. Numbers of any size are converted exactly, before and after the point. If a fraction never ends in the To base, it repeats (0.1 in binary is 0.0001100110011...). It’s written with its repeating digits followed by an ellipsis, and you can read text written that way back in the From base. Turn on Round the fraction to round to Fraction digits places instead. The default symbols are 0-9, A-Z and a-d (40 in all). Bases up to 16 read as usual (FF), and bases up to 36 accept letters in either case. Edit Symbols to use other characters. Base 1 is tally marks: a number is that many marks (the second symbol), and zero is the first symbol. Every setting is also a pin on the left, so signals can pick the bases while the program runs.': '将数字引脚（或值设置）上的数位按源进制读取，并以目标进制输出。任意大小的数字都能精确转换，小数点前后的每一位都保留。在目标进制中不会终止的小数是循环小数（二进制的 0.1 是 0.0001100110011...），输出时写出其循环的数字并在后面加省略号；这样写出的文本可以在源进制中读回。开启“舍入小数部分”则改为把小数部分舍入到“小数位数”位。默认符号为 0-9、A-Z 和 a-d（共 40 个）：16 进制及以下按通常方式读取（FF），36 进制及以下的字母不区分大小写。可编辑数位符号以使用其他字符。1 进制使用计数符号：数字由相应数量的第二个符号表示，零使用第一个符号。每个设置在左侧也有引脚，因此程序运行时可通过信号选择进制。',

  /* guide */
  'The answer is always exact. If it ends (1 ÷ 8 = 0.125), you get every digit. If it never ends, it repeats (1 ÷ 3) and is kept as the repeating number it is, with an ellipsis after the repeating digits: 0.33333...': '商始终是精确的。会终止的商（1 ÷ 8 = 0.125）完整写出；不会终止的商是循环小数（1 ÷ 3），并按循环小数原样保存，循环的数字后面带省略号：0.33333...',
  'Only used while B isn’t connected. Can’t be 0. Every digit you type is kept.': '仅在 B 未连接时使用。不能为 0。保留你输入的每一位。',
  'abs, square, floor, round, ceil, min, max, mod and pow with a whole-number exponent are exact. sqrt, sin, cos, tanh, exp, log and pow with a fractional exponent never end and never repeat, so they’re worked out to the **Precision** setting. Set it to as many digits as you like.': 'abs、square、floor、round、ceil、min、max、mod 以及整数指数的 pow 都是精确的。sqrt、sin、cos、tanh、exp、log 以及小数指数的 pow 既不终止也不循环，所以按**精度**设置计算，位数随你设定。',
  'Significant digits for results that never end and never repeat (√2, sin 1). Exact results are never padded or cut.': '既不终止也不循环的结果（√2、sin 1）的有效数字位数。精确的结果绝不补零或截断。',
  'There’s no biggest or smallest integer. Use as many digits as you like.': '整数没有最大值或最小值：位数不限。',
  'An integer can be as big as your device’s memory allows. If it’s bigger than that, you’ll get an error.': '只有设备的内存限制整数能有多大；太大而装不下时会报错。',
  'Decimal places or significant digits, as many as you like. For significant digits, scientific and engineering, 0 keeps every digit.': '小数位数或有效数字，位数不限。对有效数字、科学记数和工程记数，0 表示保留每一位。',
  'Numbers of any size are converted exactly, every digit. If a fraction never ends in the new base, it repeats and is written with an ellipsis after the repeating digits: 0.1 in binary is 0.0001100110011...': '任意大小的数字都能精确转换，保留每一位。在新进制中不会终止的小数是循环小数，循环的数字后面带省略号：二进制的 0.1 是 0.0001100110011...',
  'Text written with an ellipsis (0.0001100110011...) is read back as the repeating number it stands for.': '带省略号写出的文本（0.0001100110011...）会被读回为它所代表的循环小数。',
  'Off writes every digit, with an ellipsis after the digits of a repeating fraction. On rounds the fraction to Fraction digits places.': '关闭时写出每一位，循环小数的循环数字后面带省略号。开启时把小数部分舍入到“小数位数”位。',
  'How many digits to keep after the point in the new base when Round the fraction is on. The last one is rounded.': '开启“舍入小数部分”时，新进制中小数点后保留的位数；最后一位会舍入。',

  /* messages */
  'The result needs more memory than your browser can spare.': '结果需要的内存超出了此浏览器所能提供的。',
  'This number needs more memory than your browser can spare.': '这个数字需要的内存超出了此浏览器所能提供的。',
  'That number needs more memory than your browser can spare.': '这个数字需要的内存超出了此浏览器所能提供的。',
  'e^x of that number has too many digits for your browser to hold in memory.': '该数字的 e^x 位数太多，此浏览器的内存装不下。',
  'That exponent is too large for your browser to handle.': '这个指数太大，此浏览器无法处理。',
  'The two numbers are too far apart in size for your browser to hold the result in memory.': '这两个数字大小相差太远，此浏览器的内存装不下结果。',
  'Couldn’t work out the sine or cosine of that angle. It’s too close to a multiple of π/2 for any working precision.': '无法算出该角度的正弦或余弦：它太接近 π/2 的整数倍，任何工作精度都不够。',
  'An ellipsis (...) has to follow the digits that repeat after the point, like 0.333...': '省略号（...）必须跟在小数点后循环的数字之后，例如 0.333...',
};
