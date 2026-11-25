// Simplified Chinese for the Map and Globe modules, the full-size windows of the Meter and Image, the Projector's Font size, and the names of units.
// Traditional Chinese is generated from this dictionary by scripts/i18n/gen-hant.ts.
const hint = (what: string) => `Also show ${what} on the node. Off keeps the node's face short; the same information is always available from the module's output pins and the inspector.`;
const PLACE = 'a city, a country, a province, a district, a street address or a landmark, or coordinates such as 35.68, 139.76.';

export const geo: Record<string, string> = {
  // modules
  'Map': '地图', 'Map Display': '地图显示', 'Globe': '地球仪', 'Globe Display': '地球仪显示',
  'A street-level map that shows exactly where a place is.': '街道级地图，精确显示一个地点所在的位置。',
  'Reads a place from the Place pin (or the Default place setting) and shows it on an OpenStreetMap map with a pin on the spot. A city, a country, a province, a district, an address or a landmark anywhere on Earth is understood, in English, Simplified or Traditional Chinese; coordinates such as 35.68, 139.76 work too. Cities and countries the program knows appear at once; everything else is looked up with OpenStreetMap Nominatim, which also brings the outline of an area, drawn on the map. The node shows the map; the expand button opens a window where it can be dragged and zoomed down to single buildings. The latitude, longitude and name leave on the right. Map tiles and lookups need an internet connection and are the only network use of this module.':
    '从“地点”引脚（或“默认地点”设置）读取地点，并在 OpenStreetMap 地图上用图钉标出确切位置。可以识别地球上任何地方的城市、国家、省份、区县、地址或地标，支持英文、简体中文和繁体中文；也可以直接输入 35.68, 139.76 这样的坐标。程序已知的城市和国家会立即显示，其他地点则通过 OpenStreetMap Nominatim 查询，同时取回区域轮廓并画在地图上。节点上显示地图；点击展开按钮会打开一个窗口，可在其中拖动并放大到单栋建筑。纬度、经度和名称从右侧输出。地图图块和查询需要联网，这是本模块唯一的网络用途。',
  'A place that is not found raises an error naming it.': '找不到的地点会报错并指出其名称。',
  'Without a connection only the cities, countries and coordinates the program knows can be shown; the map itself stays blank.': '没有网络时，只能显示程序已知的城市、国家和坐标；地图本身保持空白。',
  'Text “Eiffel Tower” → Map: see the tower on the street map.': '文本“埃菲尔铁塔”→ 地图：在街道地图上看到铁塔。',
  'Constant “Bavaria” → Map and Globe: the same place on a map and on the planet.': '常量“巴伐利亚”→ 地图和地球仪：同一个地点在地图和星球上的位置。',
  'Map Latitude and Longitude → Projector: read the coordinates of a place.': '地图的纬度和经度 → 投影器：读出一个地点的坐标。',
  'A wire-frame globe that turns to face a place and marks where it is.': '线框地球仪，会转向一个地点并标出它的位置。',
  'Reads a place from the Place pin (or the Default place setting), turns the globe to face it and marks the spot; an area such as a country or a province is outlined. Coastlines and borders are drawn as thin white lines on black, like the rest of the Behavior modules. Cities and countries the program knows appear at once; everything else is looked up with OpenStreetMap Nominatim, which needs an internet connection. The expand button opens a window where the globe can be turned by dragging and zoomed with the wheel. The latitude, longitude and name leave on the right.':
    '从“地点”引脚（或“默认地点”设置）读取地点，将地球仪转向它并标出位置；国家或省份等区域会画出轮廓。海岸线和边界以黑底细白线绘制，与其他行为模块风格一致。程序已知的城市和国家会立即显示，其他地点则通过 OpenStreetMap Nominatim 查询，需要联网。点击展开按钮会打开一个窗口，可拖动旋转地球仪并用滚轮缩放。纬度、经度和名称从右侧输出。',
  'Text “Antarctica” → Globe: see where it is on the planet.': '文本“南极洲”→ 地球仪：看到它在星球上的位置。',
  'Clock City → Globe: follow the city of a clock.': '时钟城市 → 地球仪：跟随时钟所在的城市。',
  // pins and settings
  'Place': '地点', 'Latitude': '纬度', 'Longitude': '经度',
  [`Any place on Earth: ${PLACE}`]: `地球上的任何地点：城市、国家、省份、区县、街道地址或地标，或 35.68, 139.76 这样的坐标。`,
  'Latitude of the place in degrees, north positive.': '地点的纬度，单位为度，北纬为正。',
  'Longitude of the place in degrees, east positive.': '地点的经度，单位为度，东经为正。',
  'The name of the place as it was found, with its country.': '找到的地点名称，附带所在国家。',
  'Default place': '默认地点',
  'The place to show when the Place pin has no signal: a city, a country, a province, a district, an address or a landmark anywhere on Earth, in English, 简体中文 or 繁體中文 (for example “Paris, France”, “Bavaria”, “Eiffel Tower” or “东京”), or coordinates such as 35.68, 139.76.':
    '“地点”引脚没有信号时显示的地点：地球上任何地方的城市、国家、省份、区县、地址或地标，可用英文、简体中文或繁体中文（例如“Paris, France”、“巴伐利亚”、“埃菲尔铁塔”或“东京”），或 35.68, 139.76 这样的坐标。',
  'e.g. Kyoto, Texas, 1 Infinite Loop, 35.68 139.76': '例如 京都、德克萨斯、无限循环路 1 号、35.68 139.76',
  'Fit to place': '适应地点', 'Zoom so that the whole place is in view: a country shows all of it, a city its streets. Off uses the Zoom setting.': '缩放到能看到整个地点：国家显示全貌，城市显示街道。关闭时使用“缩放”设置。',
  'Zoom': '缩放', 'Used when Fit to place is off. 3 is a continent, 10 a city, 16 shows the streets and buildings, 19 is as close as the map goes.': '“适应地点”关闭时使用。3 是大洲，10 是城市，16 可看到街道和建筑，19 是地图的最大放大倍数。',
  'Show pin': '显示图钉', 'Draw a pin on the exact spot.': '在确切位置画一枚图钉。',
  'Draw a marker on the exact spot, and the outline of the area when the place is one.': '在确切位置画标记；地点是一片区域时同时画出其轮廓。',
  'Appearance': '外观', 'Dark matches the rest of the program; Light is the usual OpenStreetMap colouring.': '深色与程序其他部分一致；浅色是常见的 OpenStreetMap 配色。',
  'Dark': '深色', 'Light map': '浅色地图',
  [hint('the name and the coordinates of the place')]: '在节点上同时显示地点的名称和坐标。关闭时节点表面保持简洁；这些信息始终可以从模块的输出引脚和检查器中获得。',
  'Show borders': '显示边界', 'Draw the borders between countries, dimmer than the coastlines.': '绘制国家之间的边界，比海岸线更暗。',
  'Show grid': '显示网格', 'Draw the lines of latitude and longitude every 30 degrees.': '每 30 度绘制一条纬线和经线。',
  'Auto-rotate': '自动旋转', 'Turn the globe slowly. Off keeps the place facing you.': '让地球仪缓慢转动。关闭时地点始终正对着你。',
  // Projector font size
  'Font size': '字号', 'px': '像素',
  'Size of numbers and text, in pixels, on the node and in the full-size window. 0 keeps the automatic size, which follows the length of the value.': '节点和全尺寸窗口中数字与文本的大小，单位为像素。0 表示保持自动大小，会随数值长度变化。',
  // interface
  'Zoom in': '放大', 'Zoom out': '缩小', 'Back to the place': '回到该地点', 'Globe showing {place}': '显示 {place} 的地球仪',
  'Open the image full size': '全尺寸打开图像', 'Open the map full size': '全尺寸打开地图', 'Open the globe full size': '全尺寸打开地球仪',
  'Image': '图像', 'Image, full size': '图像（全尺寸）', 'Meter, full size': '仪表（全尺寸）', 'Map, full size': '地图（全尺寸）', 'Globe, full size': '地球仪（全尺寸）',
  'No image yet': '还没有图像', 'Nothing has arrived at this Image Display yet.': '这个图像显示还没有收到任何内容。',
  'Nothing has arrived at this Meter yet.': '这个仪表还没有收到任何内容。', 'Press Run to see what this Meter receives.': '按“运行”查看这个仪表收到的内容。',
  'History of the signal': '信号的历史', 'oldest': '最早', 'latest': '最新', 'Latest': '最新值', 'Lowest': '最低值', 'Highest': '最高值', '{n} samples': '{n} 个采样',
  'Looking up…': '正在查找…', 'Looking up the place…': '正在查找地点…', 'No place to show yet.': '还没有可显示的地点。', 'Press Run to show a place.': '按“运行”显示地点。', 'Copy coordinates': '复制坐标',
  // messages of the engine
  'No place given. Type a city, a country or an address in the inspector, or connect text to the Place pin.': '没有给出地点。请在检查器中输入城市、国家或地址，或将文本连接到“地点”引脚。',
  '“{q}” is not a place this program knows, and looking up other places needs a browser.': '“{q}”不是本程序已知的地点，查找其他地点需要浏览器。',
  '“{q}” was not found. Try the name of a city, a country, a province or an address, or write coordinates like 35.68, 139.76.': '找不到“{q}”。请试试城市、国家、省份或地址的名称，或输入 35.68, 139.76 这样的坐标。',
  'The place could not be looked up: the map service did not answer. Check the connection, or use a city or country the app knows, or coordinates.': '无法查找该地点：地图服务没有响应。请检查网络连接，或改用程序已知的城市或国家，或输入坐标。',
  // names of units, prefixes and derived units (shown under a Quantities face and in the Unit Converter)
  'degree Celsius': '摄氏度', 'minute': '分钟', 'hour': '小时', 'day': '天', 'year (Julian, 365.25 d)': '年（儒略年，365.25 天）', 'tonne': '吨', 'litre': '升',
  'electronvolt': '电子伏特', 'unified atomic mass unit': '统一原子质量单位', 'dalton': '道尔顿', 'astronomical unit': '天文单位', 'parsec': '秒差距', 'ångström': '埃',
  'bar': '巴', 'standard atmosphere': '标准大气压', 'calorie (thermochemical)': '卡路里（热化学）', 'dyne': '达因', 'erg': '尔格', 'gauss': '高斯', 'maxwell': '麦克斯韦',
  'oersted': '奥斯特', 'stokes': '斯托克斯', 'poise': '泊', 'gal': '伽', 'curie': '居里', 'roentgen': '伦琴', 'rem': '雷姆', 'torr': '托', 'millimetre of mercury': '毫米汞柱',
  'knot': '节', 'mile per hour': '英里每小时', 'revolution per minute': '转每分钟', 'inch': '英寸', 'foot': '英尺', 'yard': '码', 'mile': '英里', 'nautical mile': '海里',
  'light-year': '光年', 'pound': '磅', 'ounce': '盎司', 'stone': '英石', 'week': '周', 'degree Fahrenheit': '华氏度', 'cubic metre': '立方米', 'US gallon': '美制加仑',
  'US quart': '美制夸脱', 'US pint': '美制品脱', 'US cup': '美制杯', 'cubic foot': '立方英尺', 'cubic inch': '立方英寸', 'metre per second': '米每秒', 'kilometre per hour': '千米每小时',
  'foot per second': '英尺每秒', 'pound per square inch': '磅每平方英寸', 'kilowatt-hour': '千瓦时', 'British thermal unit': '英热单位', 'horsepower (mechanical)': '马力（机械）',
  'pound-force': '磅力', 'kilogram-force': '千克力', 'degree of arc': '角度', 'revolution': '转', 'square metre': '平方米', 'hectare': '公顷', 'square kilometre': '平方千米',
  'acre': '英亩', 'square foot': '平方英尺', 'square inch': '平方英寸', 'square yard': '平方码', 'square mile': '平方英里', 'byte': '字节', 'bit': '比特',
  'ampere per metre': '安培每米', 'square metre per second': '平方米每秒', 'pascal second': '帕斯卡秒', 'metre per second squared': '米每二次方秒', 'coulomb per kilogram': '库仑每千克',
  'quetta': '昆', 'ronna': '容', 'yotta': '尧', 'zetta': '泽', 'exa': '艾', 'peta': '拍', 'tera': '太', 'giga': '吉', 'mega': '兆', 'kilo': '千', 'hecto': '百', 'deca': '十',
  'deci': '分', 'centi': '厘', 'milli': '毫', 'micro': '微', 'nano': '纳', 'pico': '皮', 'femto': '飞', 'atto': '阿', 'zepto': '仄', 'yocto': '幺', 'ronto': '柔', 'quecto': '亏',
};
