/**
 * Hand-written usage guidance for every module. Ports, settings, ranges and defaults are NOT repeated here: the
 * documentation reads those live from the module registry so they can never drift from the real editor.
 */
import { GROUP_BY_ID, PREFIXES, QUANTITIES, UNIT_BY_SYM } from '../../core/quantities';

export interface NodeGuide {
  /** One sentence: when would I reach for this? */
  when: string;
  /** Numbered quick-start steps. */
  steps: string[];
  tips?: string[];
  pitfalls?: string[];
  /** Module types that commonly feed this one / that this one commonly feeds. */
  up?: string[];
  down?: string[];
  /** Extra words people search for. */
  alias?: string;
  /** Practical advice per setting key. */
  settings?: Record<string, string>;
  /** Explanation of each choice, per setting key then option value. */
  options?: Record<string, Record<string, string>>;
}

export const GUIDE: Record<string, NodeGuide> = {
  /* ───── Sensors ───── */
  vision: {
    when: 'You need images or brightness: from a built-in test scene, your camera, or a picture file.',
    steps: ['Add **Vision** and leave **Source** on *Simulated scene* to start.', 'Connect **Image** to an Image or Projector to see it, or to Sense / Knowledge to analyze it.', 'Connect **Luma** (mean brightness, 0–1) to anything that takes a number.', 'To use the camera, set **Source** to *Camera*, press Run and allow access.'],
    tips: ['The simulated scene is a bright disc drifting across a gradient, so brightness changes in a repeatable way.', 'For a file, pick an image in the inspector. It is downscaled and stored inside the program, so it works offline.'],
    pitfalls: ['**Sample rate** only affects the simulated scene. A file emits once; the camera delivers about 10 frames per second.', 'Camera access needs https or localhost and your permission.'],
    down: ['sense', 'knowledge', 'image', 'projector', 'threshold'], alias: 'camera webcam picture photo eye sight brightness luma',
    settings: { source: 'Start simulated. Switch to the camera only once the wiring works.', rate: 'Applies to the simulated scene only. 5 Hz is plenty for brightness; raise it for smoother motion.' },
    options: { source: { sim: 'Built-in moving scene. No hardware, fully repeatable.', camera: 'Live camera frames (needs a device and permission).', file: 'One image you choose in the inspector.' } },
  },
  hearing: {
    when: 'You want loudness or pitch, from a built-in melody or your microphone.',
    steps: ['Add **Hearing**. The simulated melody needs no hardware.', 'Use **Level** (loudness 0–1) for amount-based reactions and **Pitch** (Hz) for note-based ones.', 'Wire Level into [[n:sense]] or [[n:threshold]]; wire Pitch into [[n:knowledge]] (*Musical note*) or [[n:audio]] Frequency.'],
    tips: ['Raise **Gain** if a quiet microphone never reaches your threshold. Level is clamped to 1 after gain.', 'The simulated melody steps through eight notes, one per second, with a loudness swell once a second.'],
    pitfalls: ['Nothing is recorded or stored; only level and pitch leave the sensor.', 'Pitch is 0 when silent and accurate to roughly ±10 Hz.'],
    down: ['sense', 'threshold', 'knowledge', 'meter', 'fear'], alias: 'microphone mic audio sound loudness volume pitch frequency listen',
    settings: { gain: 'Multiplies level (not pitch). 1 is unchanged; try 3–5 for quiet microphones.', rate: 'Applies to the simulated melody only. A real microphone reports as data arrives.' },
    options: { source: { sim: 'Repeating eight-note melody with a one-second swell.', mic: 'Live microphone (needs a device and permission).' } },
  },
  touch: {
    when: 'You want to interact with the program by pointing, dragging or tapping.',
    steps: ['Add **Touch**; it has a pad inside the node.', 'Press or drag on the pad with mouse, pen or finger.', 'Use **X** and **Y** (0–1) for position and **Press** for contact.'],
    tips: ['Wire X into [[n:audio]] Frequency (after a [[n:plastic]] remap) for a theremin-like pad.', 'There are no settings. Everything comes from the pad.'],
    down: ['plastic', 'audio', 'light', 'counter'], alias: 'pad pointer mouse finger tap drag xy',
  },
  motion: {
    when: 'You want a two-axis movement signal: simulated sway, the pointer, or a tilting phone.',
    steps: ['Add **Motion** and pick a **Source**.', 'Use **X** and **Y**, both −1 to 1.', 'Remap with [[n:plastic]] if you need 0–1 or another range.'],
    pitfalls: ['*Device orientation* needs a phone or tablet sensor; desktop browsers report that no events arrived. iOS asks permission when you press Run.'],
    down: ['plastic', 'sense', 'light'], alias: 'gyro tilt accelerometer orientation vestibular sway pointer',
    settings: { rate: 'Applies to the simulated sway only.' },
    options: { source: { sim: 'Smooth repeating sway. No hardware.', pointer: 'Pointer position over the page.', device: 'Device tilt (gamma/beta, ±90°).' } },
  },
  keys: {
    when: 'You want to react to the keyboard while the program runs.',
    steps: ['Add **Keys** and press Run.', 'Press keys outside text fields. **Key** holds the latest key name, **Down** is true while any key is held.', 'To react to one key, feed **Key** into [[n:compare]] with operator `==` and the key name as the fallback.'],
    pitfalls: ['Keys typed into text boxes and the inspector are ignored.', 'Editor shortcuts such as Space and `.` still fire; they do not stop Keys seeing the key.'],
    down: ['compare', 'counter', 'event', 'relay'], alias: 'keyboard typing press key',
  },
  info: {
    when: 'You need a typed-in text or number to feed a program.',
    steps: ['Add **Info** and select it.', 'Type into **Text** in the inspector (the node only displays it).', 'Use **Text** for text consumers and **Number** for numeric ones.'],
    tips: ['**Number** appears only when the **entire** text is numeric (`42`, `-3.5`).', 'A good test input for [[n:knowledge]] with *Text sentiment*.'],
    down: ['knowledge', 'text', 'compare', 'combine'], alias: 'text number manual input constant string',
  },
  switch: {
    when: 'You want a manual on/off control you can flip while the program runs.',
    steps: ['Add **Switch**.', 'Click the inner pad of the node to toggle it.', 'Connect **On** to a gate such as [[n:relay]] Open, [[n:nap]] Sleep or [[n:branch]] Condition.'],
    tips: ['Emits its state at start and every time it is toggled.', 'Its **On** setting also has a setting pin, so another signal can toggle it.'],
    down: ['relay', 'branch', 'nap', 'counter', 'vital'], alias: 'toggle button boolean manual on off',
  },
  device: {
    when: 'You want to know about the browser or whether it is online.',
    steps: ['Add **Device**.', '**Name** gives the platform and screen size; **Online** is true while the browser reports a network connection.', 'Show Name in a [[n:text]] display or branch on Online.'],
    tips: ['**Fallback label** is only used when the browser exposes no platform information.'],
    down: ['text', 'vital', 'branch'], alias: 'platform online network somatic browser screen',
  },

  /* ───── Nuclei ───── */
  sense: {
    when: 'A raw signal has an unknown scale and you need a clean 0–1 level, or you need image brightness.',
    steps: ['Add **Sense** and connect any number, boolean or image to **Input**.', 'Choose the **Feature**. *Auto-range* is the best default for numbers of unknown scale.', 'Use **Level** (0–1) downstream. Use **Onset** to get a true/false “it’s strong now”.'],
    tips: ['Auto-range tracks the signal’s recent minimum and maximum, so it adapts to quiet or loud sources.', 'For images pick *Brightness* (mean luma), *Contrast* or *Change* (frame-to-frame difference). *Change* is a simple motion detector.'],
    pitfalls: ['Text input produces a warning: the input is not numeric.', 'For a signal that is **already** 0–1, use *Raw* to avoid the auto-range stretching small movements.'],
    up: ['vision', 'hearing', 'motion'], down: ['threshold', 'fear', 'meter', 'vital'], alias: 'normalize feature extraction brightness loudness contrast motion detector onset autorange',
    settings: { feature: 'Start with Auto-range for numbers, Brightness for images.', gain: 'Applied before clamping to 0–1. Use it to amplify a weak signal.', decay: 'Auto-range memory. **Short** (a few seconds) adapts quickly to a changing environment; **long** keeps a stable scale.', onset: 'Where Onset turns true. It releases 0.1 lower, so it won’t chatter.' },
    options: { feature: { auto: 'Rescale the number into 0–1 using its own recent minimum and maximum.', raw: 'Use the value as it is, times Gain, clamped to 0–1.', brightness: 'Mean brightness of an image.', contrast: 'Spread of brightness in an image (standard deviation).', change: 'How much the brightness changed since the last frame.' } },
  },
  knowledge: {
    when: 'You want to classify or label something: name a colour or note, bucket a number, spot an outlier, read sentiment.',
    steps: ['Add **Knowledge** and pick a **Package** in the inspector. Extra settings for that package then appear.', 'Connect the input the package expects (see the package page).', 'Read **Label** (the result) and **Score** (0–1 confidence).'],
    tips: ['Each package is labelled honestly with its technique. Statistics, rules and lexicons are not presented as neural networks.', 'Browse everything in [[x:packages|Inference packages]].'],
    pitfalls: ['An *unavailable* package (for example MobileNet) errors and emits nothing in this build.', 'The Package choice has no setting pin because it decides which other settings exist.'],
    up: ['vision', 'hearing', 'info', 'sense'], down: ['text', 'projector', 'relay'], alias: 'classify classifier label recognize ml inference sentiment note colour color anomaly rules',
    settings: { package: 'Picks the technique. Switching it changes which other settings are shown.' },
  },
  imagination: {
    when: 'You want to predict the next values of a trend, score several inputs into one number, or generate smooth noise.',
    steps: ['Add **Imagination** and choose a **Package**.', 'For *Trend* and *Score*, connect numbers to **A**, **B**, **C** (all optional).', '*Smooth noise* needs no input; it generates values on its own.', 'Use **Output** and **Confidence**.'],
    tips: ['*Trend* fits a straight line to recent samples and predicts ahead. It extrapolates, it does not truly “know” the future.', '*Smooth noise* is great for organic-looking motion; set a **Seed** for repeatability.'],
    up: ['hearing', 'wave', 'random'], down: ['meter', 'projector', 'light'], alias: 'predict forecast generate generative score trend noise dream',
    settings: { package: 'Picks the technique. Switching it changes which other settings are shown.' },
  },
  attention: {
    when: 'Several candidates compete and you only want to follow the most salient one.',
    steps: ['Connect up to three numbers to **A**, **B**, **C**.', 'Optionally bias them with **Weight A/B/C**.', 'Read **Focus** (value of the winner) and **Index** (0, 1, 2 or −1 for none).'],
    tips: ['Salience = |value| × wire strength × weight. A wire’s [[a:connections|weight]] counts too.', 'Raise **Stickiness** to stop the focus bouncing between near-equal candidates.'],
    pitfalls: ['If nothing exceeds **Minimum salience**, Index is −1 and Focus is 0.'],
    up: ['sense', 'hearing', 'random'], down: ['relay', 'decision', 'projector'], alias: 'winner take all focus salience select compete',
    settings: { sticky: 'Higher means the current winner holds on longer. 0 switches instantly.', min: 'A noise floor. Anything weaker is ignored.' },
  },
  fear: {
    when: 'You want a response that builds quickly under threat and fades slowly afterwards.',
    steps: ['Connect a 0–1 **Threat** (for example loudness from [[n:sense]]).', 'Tune **Sensitivity**, **Threat floor** (ignore small threats), **Rise time** and **Decay time**.', 'Use **Fear** (0–1) for graded responses and **Alarm** for a yes/no trigger.'],
    tips: ['Make **Decay** much longer than **Rise** for “lingering anxiety”.', 'Chain into [[n:emotion]] or [[n:decision]] to build a startle response.'],
    pitfalls: ['Fear counts as state, so it can legally sit inside a feedback loop.'],
    up: ['sense', 'threshold', 'hearing'], down: ['emotion', 'decision', 'vital', 'light'], alias: 'threat startle anxiety alarm integrator leaky',
    settings: { sensitivity: 'Gain on threat above the floor. 1 is neutral.', floor: 'Threat below this is ignored. Use it to ignore background noise.', rise: 'Time constant while fear is increasing. Short = jumpy.', decay: 'Time constant while fear fades. 2500 ms is a startle; 15 000+ ms is lingering.', alarm: 'Fear level that raises Alarm. It releases 0.1 lower.' },
  },
  memory: {
    when: 'You want a value to leave a fading trace, or to look back at what came before.',
    steps: ['Connect a number to **Input**.', 'Leave **Store** unconnected to remember every change, or connect a boolean so values are stored only on its rising edge.', 'Read **Recall** (the smoothed trace), **Previous** (the value stored before the latest) and **Count**.'],
    tips: ['**Remember** = 1 and **Forget** = 0 makes Recall equal the latest value. Lower Remember averages many values.', 'Wire a boolean to **Clear**, or press the **CLEAR** button, to erase it.'],
    pitfalls: ['Non-numeric input is ignored with a warning.', 'The trace starts at 0.'],
    up: ['sense', 'hearing', 'pulse'], down: ['meter', 'threshold', 'compare'], alias: 'remember forget trace store recall history average buffer',
    settings: { remember: '1 replaces the trace with each new value; 0.1–0.3 averages over many.', forget: 'Trace decay per second. 0 never forgets.', capacity: 'How many recent values Previous and Count can see.', clearNow: 'A button. Erases the memory immediately.' },
  },
  emotion: {
    when: 'You want a simple mood word or two-axis mood from reward and fear signals.',
    steps: ['Connect **Reward** and/or **Fear** (both optional, 0–1).', 'Read **Mood** (word or emoji), **Valence** (−1 to +1) and **Arousal** (0–1).', 'Set **Inertia** for how quickly mood follows.'],
    tips: ['Valence = reward − fear; arousal = |reward| + fear, both smoothed by inertia.', 'Mood names: excited / alert / afraid at high arousal, content / neutral / sad at low.'],
    pitfalls: ['A computational sketch, not a model of human emotion.'],
    up: ['reward', 'fear'], down: ['text', 'projector', 'decision'], alias: 'mood valence arousal feeling affect',
    settings: { inertia: 'Time constant of mood changes. Larger = moodier and slower to shift.', style: 'Word for readable text, emoji for compact display.' },
    options: { style: { word: 'Mood as a word, such as “content”.', emoji: 'Mood as an emoji.' } },
  },
  reward: {
    when: 'You want to score progress against effort, and track how surprising the result is.',
    steps: ['Connect **Goal** (progress, usually 0–1) and optionally **Cost** (effort or penalty).', 'Use **Reward** for the score, **Expected** for what it has learned to anticipate, and **Error** for the surprise.', 'Tune **Gain**, **Cost weight** and **Learning rate**.'],
    tips: ['Reward = gain × goal − costWeight × cost, clamped to ±Limit.', 'Expected moves toward reward by the learning rate each time, so **Error** shrinks as the result becomes predictable.', 'Use **Refractory** to stop a stream of rewards from piling up.'],
    pitfalls: ['A non-numeric Goal warns and holds the outputs.'],
    up: ['sense', 'counter', 'threshold'], down: ['emotion', 'decision', 'meter'], alias: 'goal cost prediction error learning dopamine expected',
    settings: { gain: 'Scales the goal. Negative values invert it.', costWeight: 'How much cost subtracts. 0 ignores cost.', learn: 'How fast Expected follows reward. 0 never learns; 1 copies instantly.', refractory: 'After a positive reward, further positive rewards become 0 for this long.', limit: 'Reward is clamped to ± this value.' },
  },
  decision: {
    when: 'You need to choose between up to three options by score.',
    steps: ['Connect scores to **A**, **B**, **C**. Unconnected options are ignored.', 'Name the options in **Labels**, comma-separated.', 'Use **Choice** (0, 1, 2 or −1), **Label** (the name) and **Margin** (lead over the runner-up).'],
    tips: ['**Hysteresis** keeps the current choice unless a rival beats it by this margin. It prevents flicker.', '*Epsilon-greedy* sometimes picks at random with a seeded generator, so runs are repeatable.', 'Use **Margin** as a confidence signal.'],
    pitfalls: ['The winner must reach **Minimum score**, otherwise Choice is −1 and no label is emitted.'],
    up: ['sense', 'attention', 'imagination'], down: ['text', 'branch', 'state'], alias: 'choose pick select argmax epsilon greedy winner options',
    settings: { labels: 'Example: `Sound, Light, Touch`. Order matches A, B, C.', min: 'A score floor. Raise it to refuse weak decisions.', hysteresis: 'Raise it if the choice flips between near-equal options.', epsilon: 'Only used by Epsilon-greedy: the chance of a random pick (0–1).' },
    options: { policy: { argmax: 'Always pick the highest score.', epsilon: 'Pick the best score most of the time, a random option with probability Epsilon.' } },
  },
  state: {
    when: 'Behavior should move through named steps, driven by events.',
    steps: ['List your states in **States**, comma-separated. The first is the starting state.', 'Write one transition per line in **Transitions**.', 'Feed events into **Event**: a boolean true counts as the event `on`; any text or number counts as its text. Wire a boolean to **Reset** to return to the first state.', 'Use **State** (name) and **Index** (position).'],
    tips: ['Transition formats: `from>to` (any event), `from:event>to` (only that event), and `*` matches any state. The first matching line wins.', 'Use [[n:event]] to give triggers a name such as `next`.', 'Example:\n`idle:start>running`\n`running:stop>idle`\n`*:fault>error`'],
    pitfalls: ['A state name in Transitions that is not in States gives a warning and the machine stays put.'],
    up: ['event', 'pulse', 'switch'], down: ['text', 'compare', 'branch'], alias: 'fsm finite state machine mode transitions sequence steps',
    settings: { states: 'Example: `idle, active, done`.', transitions: 'One per line. `idle>active` or `idle:go>active`. `*` matches any state.' },
  },

  /* ───── Behaviors ───── */
  text: {
    when: 'You want to read any value as text.',
    steps: ['Add **Text** and connect any output to its **Input**.', 'Long text wraps and clips inside the node; select it to read the full value in the inspector.'],
    down: [], up: ['decision', 'state', 'emotion', 'knowledge'], alias: 'label display show string readout',
  },
  image: {
    when: 'You want to look at an image signal.',
    steps: ['Add **Image** and connect an image output such as [[n:vision]] **Image** or [[n:color]] **Swatch**.'],
    pitfalls: ['A non-image signal raises a warning. Use [[n:projector]] if you are unsure of the type.'],
    up: ['vision', 'color'], alias: 'picture show display photo',
  },
  projector: {
    when: 'You want one display that picks the right layout for anything: numbers, text, images, graphs, lists, and whole files.',
    steps: ['Add **Projector** and connect anything to **Input**.', 'For numbers, choose a **Number format**.', 'Click the expand icon in the node’s corner (or **Open full size** in the inspector) to see all of it in a large window.'],
    tips: ['If you are unsure what type is coming, use Projector rather than Text or Image.', 'Connect a Files node’s **File** output and the Projector shows the file itself: the words of a text, Word, web or CSV file, a picture, a presentation’s slide text. In the full-size window a PDF is paged, sound and video play, a web page can be read as source or as a safe preview, and a CSV can be read as a table.', 'In the inspector every signal has its own expand button, so you can open any value in the Projector window without wiring anything.', 'The window can go full screen, and its Copy and Download buttons keep what you read.'],
    pitfalls: ['The node itself shows only a short preview. A long text is cut there and complete in the window.', 'A shared program does not carry its files, so a Projector fed by a file shows the file’s name and a note until you drop the file on its Files node again.'],
    up: ['sense', 'counter', 'vision', 'decision', 'file-text', 'actor-fileconv', 'actor-unitconv', 'actor-numfmt'], alias: 'display show screen readout big number viewer preview view popup window full size file content text',
    settings: { format: 'Only affects numbers.' },
    options: { format: { auto: 'Shows the number as-is, trimmed sensibly.', int: 'Whole number.', fixed2: 'Always two decimals.', percent: 'A 0–1 value as a percentage.' } },
  },
  meter: {
    when: 'You want to watch a number over time, or graph an equation.',
    steps: ['Add **Meter** and connect a number, or an [[n:equation]] **Equation** output.', 'Run. Numbers are recorded as a plot each time the input changes.', 'Click the expand icon for a labelled full-size graph.'],
    tips: ['**Window** is how much history is drawn for numeric signals.', 'With **Auto scale** off, the vertical range is 0–1. Equations use the range set on the Equation node.', 'Put a Meter after any module you are debugging.'],
    pitfalls: ['An equation that cannot be parsed raises an error naming the problem.'],
    up: ['sense', 'wave', 'equation', 'random'], alias: 'plot graph chart scope oscilloscope monitor trace',
    settings: { window: 'More samples show a longer history but compress detail.', auto: 'On: fits the vertical range to the data. Off: fixed 0–1.' },
  },
  audio: {
    when: 'You want to hear a tone whose pitch or loudness follows a signal.',
    steps: ['Add **Audio** and press Run (browsers need a gesture before they play sound).', 'Connect a number to **Frequency** (Hz) and/or **Amplitude** (0–1), or leave them and use the **Default pitch** setting.', 'Pick a **Waveform** and keep **Volume** low.'],
    tips: ['Amplitude is multiplied by Volume. Drive Amplitude with an [[n:envelope]] for notes that fade.', 'Use **Mute** to silence it without stopping the program.'],
    pitfalls: ['Silent while paused or stopped.', 'If Web Audio is unavailable the node says so and stays silent.'],
    up: ['wave', 'envelope', 'plastic', 'hearing'], alias: 'sound tone speaker beep synth oscillator play',
    settings: { volume: 'Master level. Kept low by default (0.15); raise it carefully.', freq: 'Used only when Frequency has no wire.', mute: 'Silences output without stopping the clock.' },
    options: { wave: { sine: 'Pure, soft tone.', triangle: 'Mellow, slightly hollow.', square: 'Buzzy, hollow.', sawtooth: 'Bright and harsh.' } },
  },
  haptic: {
    when: 'You want the device to vibrate when something happens.',
    steps: ['Add **Haptic** and connect any trigger.', 'Any truthy arrival (true, non-zero, non-empty) vibrates the device for the **Duration**.'],
    pitfalls: ['Only Android browsers support vibration. iOS and desktops show “not supported”.'],
    up: ['threshold', 'pulse', 'hyponerve'], alias: 'vibrate vibration buzz rumble phone',
    settings: { ms: 'How long each vibration lasts.' },
  },
  vital: {
    when: 'You want a clear on/off or 0–1 dot indicator.',
    steps: ['Add **Vital** and connect a boolean or 0–1 level.', 'Booleans fill the dot (true) or leave it hollow (false). Numbers set the dot’s size.'],
    tips: ['State is shown by fill as well as colour, so it works for colour-blind users.'],
    up: ['threshold', 'sense', 'fear', 'switch'], alias: 'indicator led dot status lamp',
    settings: { color: 'Purely visual.' },
  },
  light: {
    when: 'You want a beam whose brightness follows a number.',
    steps: ['Add **Light** and connect a 0–1 number to **Level**.', 'Pick a beam colour.'],
    tips: ['Values are clamped to 0–1. Use [[n:plastic]] to remap other ranges.'],
    up: ['sense', 'wave', 'envelope', 'fear'], alias: 'lamp brightness beam glow dim',
    settings: { color: 'Purely visual.' },
  },
  notify: {
    when: 'You want a system notification when something happens, even if the tab is in the background.',
    steps: ['Add **Notify** and connect a trigger.', 'Press the permission button in the inspector and allow notifications.', 'Set **Title** and **Body**. An empty Body uses the triggering value.'],
    tips: ['**Minimum gap** drops notifications that arrive too soon after the last one. This avoids a flood from a noisy trigger.'],
    pitfalls: ['Without permission, nothing is shown and the node says so.'],
    up: ['threshold', 'fear', 'hyponerve'], alias: 'notification alert popup message toast',
    settings: { gap: 'Notifications closer together than this are dropped. 3000 ms is a sensible default.' },
  },
  color: {
    when: 'You want to produce a colour from hue, saturation and value, or sweep through colours.',
    steps: ['Add **Color** and connect 0–1 numbers to **H**, **S**, **V**, or set them as settings.', 'Use **Swatch** (an image) with an Image or Projector, and **Hex** (the `#rrggbb` text) elsewhere.'],
    tips: ['Drive **H** with a slow [[n:wave]] (offset 0.5, amplitude 0.5) to cycle through the rainbow.', 'Feed **Swatch** to [[n:knowledge]] with *Dominant color* to test it.'],
    up: ['wave', 'sense'], down: ['image', 'projector', 'knowledge'], alias: 'hsv rgb hue swatch palette hex css',
    settings: { h: 'Used only when H has no wire. 0 and 1 are both red.', s: '0 is grey, 1 is vivid.', v: '0 is black, 1 is brightest.' },
  },

  /* ───── Nodes ───── */
  constant: {
    when: 'You need a fixed value to feed an input.',
    steps: ['Add **Constant**, choose the **Kind**, then type the **Value**.', 'Connect **Output** to the input that needs it.'],
    tips: ['Emits when the program starts and whenever the value is edited.', 'For a number that you want to tweak while running, use a [[n:switch]] or the setting pin instead.'],
    pitfalls: ['Kind *Number* with non-numeric text raises an error.'],
    alias: 'fixed value number text boolean literal',
    settings: { value: 'Type `1.5`, `hello` or `true`, matching the Kind.' },
    options: { kind: { number: 'Value parsed as a number.', text: 'Value used as text.', bool: 'Value read as true or false.' } },
  },
  random: {
    when: 'You want repeatable pseudo-random numbers.',
    steps: ['Add **Random** and set **Minimum**, **Maximum** and **Rate**.', 'Connect **Output** wherever a number is needed.', 'Turn on **Integers** for integers (dice, indices).'],
    tips: ['Same **Seed** gives the same sequence after Stop → Run. Change the seed for a different one.', 'Smooth the output with [[n:inductor]] for a gentle wander.'],
    down: ['inductor', 'meter', 'attention'], alias: 'noise rng dice chance seed',
    settings: { seed: 'Change it to get a different, still repeatable, sequence.', rate: 'Values per second of simulation time.' },
  },
  pulse: {
    when: 'You need a clock, a metronome, or periodic triggers.',
    steps: ['Add **Pulse** and set the **Period**.', 'Connect **Pulse** to anything that reacts to triggers: [[n:counter]], [[n:event]], [[n:envelope]], [[n:register]] Store.', 'Use **Count** for how many have fired.'],
    tips: ['Width never goes below one simulation tick, so downstream modules can always see the pulse.', 'Set **Max pulses** to fire a fixed number of times, 0 means unlimited. **Offset** delays the first pulse.', 'Drive **Period** from a signal via its setting pin to speed the clock up and down.'],
    down: ['counter', 'event', 'envelope', 'sequence', 'register'], alias: 'clock timer metronome tick interval trigger periodic beat',
    settings: { period: 'Time between pulse starts.', width: 'How long it stays true. Capped below the period.', offset: 'Time of the first pulse.', max: '0 means unlimited.' },
  },
  add: {
    when: 'You need to add two numbers or shift a number by a constant.',
    steps: ['Connect a number to **A**. Optionally connect **B**.', 'Set **Offset** for a constant to add.', 'Result = A + B + Offset.'],
    tips: ['An unconnected B counts as 0, so with only A and Offset this just shifts A.', 'The sum is exact: every digit of every number is kept. 3 + 0.14159265 is 3.14159265, and 0.1 + 0.2 is 0.3. Nothing is rounded.'],
    pitfalls: ['If A has no signal the module stays idle even when B has one.'],
    up: ['wave', 'sense'], alias: 'plus sum addition offset shift',
  },
  mul: {
    when: 'You need to scale a number.',
    steps: ['Connect a number to **A**.', 'Set **Factor**, or connect a number to **B** to use that instead.', 'Result = A × (B or Factor).'],
    tips: ['Connecting B replaces the Factor setting, so you can scale one signal by another (amplitude modulation).'],
    alias: 'multiply times scale gain amplify product',
    settings: { factor: 'Used only while B is unconnected. Keeps every digit you type.' },
  },
  sub: {
    when: 'You need the difference between two numbers.',
    steps: ['Connect the starting value to **A** and the amount to subtract to **B**.', 'Optionally set **Offset** to subtract a constant as well.', 'Result = A − B − Offset.'],
    pitfalls: ['A is the *minuend*; swapping A and B flips the sign.'],
    alias: 'minus subtract difference delta',
  },
  div: {
    when: 'You need to divide one number by another, or scale down.',
    steps: ['Connect the dividend to **A**.', 'Set **Divisor**, or connect a number to **B**.', 'Result = A ÷ (B or Divisor).'],
    tips: ['A quotient that ends (1 ÷ 8 = 0.125) is exact. One that never ends (1 ÷ 3) is worked out to the **Precision** setting, 50 significant digits by default, up to 1000.'],
    pitfalls: ['A divisor of 0 raises an error (×) and emits nothing.'],
    alias: 'divide ratio quotient fraction',
    settings: { divisor: 'Used only while B is unconnected. Must not be 0.', precision: 'Significant digits of a quotient that never ends. A quotient that ends is exact whatever this says.' },
  },
  invert: {
    when: 'You need the opposite of a boolean or a number.',
    steps: ['Connect a boolean or number to **Input**.', 'Booleans are logically inverted. For numbers choose a **Mode**.'],
    alias: 'not negate flip opposite complement',
    options: { mode: { negate: 'Number becomes −x.', complement: 'Number becomes 1 − x (handy for 0–1 levels).' } },
  },
  math: {
    when: 'You need a mathematical function: abs, sqrt, sin, min, max, pow and more.',
    steps: ['Connect a number to **A**.', 'Pick a **Function**.', 'For *min*, *max*, *pow* and *mod* also connect **B**.'],
    tips: ['abs, square, floor, round, ceil, min, max, mod and pow with a whole exponent are exact. sqrt, sin, cos, tanh, exp, log and pow with a fractional exponent are worked out to the **Precision** setting.'],
    settings: { precision: 'Significant digits of a result that never ends (√2, sin 1). Exact results are never padded or cut.' },
    pitfalls: ['A result that is not finite (for example sqrt of a negative) raises an error and emits nothing.'],
    alias: 'abs sqrt sin cos tanh exp log floor round ceil min max pow mod function',
    options: { fn: { abs: 'Absolute value.', sqrt: 'Square root (A ≥ 0).', square: 'A × A.', sin: 'Sine of A (radians).', cos: 'Cosine of A (radians).', tanh: 'Squashes any number into −1…1.', exp: 'e to the power A.', log: 'Natural logarithm (A > 0).', floor: 'Round down.', round: 'Round to nearest.', ceil: 'Round up.', min: 'The smaller of A and B.', max: 'The larger of A and B.', pow: 'A to the power B.', mod: 'Remainder of A ÷ B.' } },
  },
  register: {
    when: 'You want to capture a value at a moment and hold it afterwards (sample-and-hold).',
    steps: ['Connect the value to **Input**.', 'Connect a boolean to **Store**. On its rising edge the input is copied to the output.', 'The output holds between triggers.'],
    tips: ['Without a Store wire, every change is latched, so it just mirrors the input (with a tick of delay).', 'Pair with [[n:pulse]] to sample a signal on a schedule.'],
    up: ['pulse', 'switch', 'threshold'], alias: 'sample hold latch store capture memory',
  },
  relay: {
    when: 'You want to let a signal through only while a condition is true.',
    steps: ['Connect the signal to **Input**.', 'Connect a boolean to **Open**. True lets values pass.', 'Leave Open unconnected to use **Open by default**.'],
    tips: ['Opening the gate forwards the current input immediately.', '**Invert control** passes while Open is false, which saves an [[n:invert]] module.', 'While closed, the output keeps its last value.'],
    up: ['switch', 'threshold', 'compare'], alias: 'gate valve allow block pass filter switch enable',
    settings: { openDefault: 'Used only when Open has no wire.', invert: 'Passes while Open is false.' },
  },
  inductor: {
    when: 'You want to smooth out a noisy number.',
    steps: ['Connect a number to **Input**.', 'Set the **Time constant**. Larger is smoother and slower.', 'Use **Output**.'],
    tips: ['It covers about 63% of the distance to the input in one time constant.', 'Starts at 0, so the first seconds climb toward the input.'],
    up: ['random', 'sense', 'hearing'], down: ['meter', 'threshold'], alias: 'smooth lowpass filter average damp inertia lag inductor',
    settings: { tau: '200 ms is light smoothing; 2000 ms is very smooth and sluggish.' },
  },
  threshold: {
    when: 'You want to turn a number into a clean true/false.',
    steps: ['Connect a number to **Input**.', 'Set the **Threshold** and (important) a small **Hysteresis**.', 'Use **Over** (true/false) and optionally **Delta** (how far past).'],
    tips: ['With threshold 0.5 and hysteresis 0.1: 0.55 → true, 0.45 → still true, 0.39 → false.', '*Below* mirrors the logic for “true while too low”.'],
    pitfalls: ['Hysteresis 0 can flicker if the input hovers around the limit.'],
    up: ['sense', 'hearing', 'inductor'], down: ['vital', 'relay', 'counter', 'haptic'], alias: 'limit trigger comparator schmitt level cross above below',
    settings: { threshold: 'The level that flips the output.', hysteresis: 'Margin beyond the threshold before it turns off again. 5–10% of the range is typical.' },
    options: { mode: { above: 'True when the input is at or above the threshold.', below: 'True when the input is at or below the threshold.' } },
  },
  compare: {
    when: 'You want to test how two values relate: equal, greater, less…',
    steps: ['Connect the left value to **A** and optionally the right value to **B**.', 'If B has no wire, type the right-hand value into **Fallback b**.', 'Pick a **Relation**. Output is true or false.'],
    tips: ['Numbers compare numerically; **Tolerance** sets the slack for `==` and `!=`.', 'Non-numbers compare as text, so you can match key names like `a`.'],
    up: ['keys', 'decision', 'state'], down: ['relay', 'branch', 'counter'], alias: 'equal greater less than equals test if condition match',
    settings: { fallback: 'Right operand when B is unconnected.', tolerance: 'Numbers closer than this count as equal.' },
  },
  combine: {
    when: 'You want to merge up to three signals into one.',
    steps: ['Connect signals to **A**, **B**, **C**.', 'Pick a **Mode**.', 'Only connected inputs that have a signal take part.'],
    tips: ['*Join* builds text such as a sentence from several parts. Set the **Separator**.', '*List* gathers values into one structured value.'],
    pitfalls: ['Numeric modes reject non-numeric values with a warning.'],
    alias: 'merge mix sum mean average max min product join concatenate list',
    options: { mode: { sum: 'Add them.', mean: 'Average of those present.', max: 'Largest.', min: 'Smallest.', product: 'Multiply them.', join: 'Join as text with the separator.', list: 'Collect into a list.' } },
    settings: { sep: 'Used only by Join.' },
  },
  delay: {
    when: 'You want a signal to arrive later, or you need to close a feedback loop.',
    steps: ['Connect a signal to **Input**.', 'Set **Delay**.', 'Pick a **Mode**.'],
    tips: ['Legal inside feedback loops.', 'A delay of 0 passes values straight through.'],
    alias: 'lag wait postpone debounce late time shift settle',
    options: { mode: { shift: 'Every value reappears, in order, exactly Delay ms later.', settle: 'Only the latest value, once the input has been quiet for Delay ms (a debounce).' } },
  },
  counter: {
    when: 'You want to count events, such as pulses, key presses or threshold crossings.',
    steps: ['Connect triggers to **Increment** (and optionally **Decrement**).', 'Set **Start**, **Step**, **Minimum** and **Maximum**.', 'Connect a boolean to **Reset** to return to the start value.'],
    tips: ['Each arrival of a *truthy* value counts once, so a pulse train counts one per pulse.', 'Turn on **Wrap around** for a cycling counter (0, 1, 2, 0, 1, 2…).'],
    pitfalls: ['Without wrap the count saturates at Minimum and Maximum.'],
    up: ['pulse', 'threshold', 'keys', 'hyponerve'], down: ['projector', 'compare', 'sequence'], alias: 'count tally increment decrement total',
    settings: { step: 'Amount added per event. Can be negative.', max: 'Upper limit (default 100).', wrap: 'On: wrap to the opposite limit. Off: saturate.' },
  },
  sequence: {
    when: 'You want to step through a list of values, one per trigger or on a timer.',
    steps: ['Type values into **Values**, comma-separated.', 'Connect a trigger to **Next**, or set **Auto advance** above 0 for a timer.', 'Use **Out** and **Index**.'],
    tips: ['Numbers and true/false are parsed. Everything else is text.', '**Loop** returns to the start after the last step; off stops on the last.', 'Example values: `220, 262, 330, 392` for a melody into [[n:audio]] Frequency.'],
    up: ['pulse', 'keys', 'switch'], down: ['audio', 'text', 'compare'], alias: 'step list melody playlist arpeggio cycle',
    settings: { values: 'Comma-separated.', auto: '0 means only advance on Next.' },
  },
  branch: {
    when: 'You want to send a value to one of two places depending on a condition.',
    steps: ['Connect the value to **Input** and a boolean to **Condition**.', 'Use **Then** for the true route and **Else** for false.'],
    tips: ['The output you are *not* routing to keeps its previous value.'],
    pitfalls: ['Both inputs are required.'],
    up: ['threshold', 'compare', 'switch'], alias: 'if else route split conditional switch case',
  },
  plastic: {
    when: 'You want to map a number from one range into another, such as 0–1 into 200–800 Hz.',
    steps: ['Connect a number to **Input**.', 'Set **Input min / max** to the range the signal really has.', 'Set **Output min / max** to the range you need.', 'Optionally choose a **Curve**.'],
    tips: ['Ranges may be inverted (Output min above max) to flip direction.', '**Clamp** keeps results inside the output range even if the input strays outside.', 'The standard partner for setting pins: remap a 0–1 signal into a setting’s valid range.'],
    pitfalls: ['Input min equal to Input max is an error.'],
    up: ['wave', 'sense', 'touch'], down: ['audio', 'light'], alias: 'map remap scale range rescale lerp convert normalize curve',
    settings: { inMin: 'Bottom of the incoming range.', inMax: 'Top of the incoming range.', outMin: 'Result at the bottom.', outMax: 'Result at the top.', clamp: 'Keep output inside the output range.' },
    options: { curve: { linear: 'Straight-line mapping.', 'ease-in': 'Starts slow, ends fast.', 'ease-out': 'Starts fast, ends slow.', smooth: 'Slow at both ends.' } },
  },
  hyponerve: {
    when: 'You want to react only when a signal changes, or crosses a level.',
    steps: ['Connect a signal to **Input**.', 'Pick an **Emit when** rule.', 'It emits only when the rule says the new value should pass.'],
    tips: ['*cross-up* emits once as the signal climbs through the threshold, then stays quiet.', '*delta* measures from the last **emitted** value, so slow drifts eventually fire.'],
    up: ['sense', 'wave'], down: ['counter', 'event', 'haptic'], alias: 'change detector edge detector derivative crossing rising falling delta',
    settings: { epsilon: 'Only for *delta*: minimum change to pass.', threshold: 'Only for the *cross* rules.' },
    options: { rule: { change: 'Pass whenever the value differs from the previous one.', delta: 'Pass only if it moved by at least Epsilon since the last pass.', rise: 'Pass only when the value went up.', fall: 'Pass only when the value went down.', 'cross-up': 'Pass once when the value crosses the threshold going up.', 'cross-down': 'Pass once when the value crosses the threshold going down.' } },
  },
  hypernerve: {
    when: 'Several sources compete for the same destination and you need to pick one.',
    steps: ['Connect candidates to **A**, **B**, **C**.', 'Pick a **Policy**.', 'Use **Out** and **Winner** (`a`, `b` or `c`).'],
    options: { policy: { priority: 'The first connected input with a signal wins (A, then B, then C).', strongest: 'Highest strength wins, then largest magnitude.', latest: 'The most recently updated input wins.', override: 'C beats everything while it has a signal.' } },
    alias: 'arbitrate merge priority override select winner multiplexer',
  },
  firing: {
    when: 'A signal updates too often and you want to cap how many values per second get through.',
    steps: ['Connect a signal to **Input**.', 'Set the **Max rate**.', 'Pick a **Mode**.'],
    tips: ['Insert one before [[n:notify]], [[n:haptic]] or any heavy consumer.'],
    alias: 'throttle rate limit limiter debounce slow down governor',
    options: { mode: { throttle: 'Holds the newest value and delivers it when the next slot opens. Nothing is lost permanently.', drop: 'Discards values that arrive too early.' } },
  },
  envelope: {
    when: 'You want a note-like level that rises, falls, holds and fades when a gate opens and closes.',
    steps: ['Connect a boolean to **Gate**. True starts attack and decay, false starts release.', 'Set **Attack**, **Decay**, **Sustain**, **Release** and **Peak**.', 'Use **Level** and **Phase** (`idle`, `attack`, `decay`, `sustain`, `release`).'],
    tips: ['For a percussive blip, set Sustain to 0.', 'Drive [[n:audio]] Amplitude or [[n:light]] Brightness for a natural fade.'],
    up: ['pulse', 'switch', 'threshold'], down: ['audio', 'light', 'meter'], alias: 'adsr attack decay sustain release note amplitude fade',
    settings: { sustain: 'Fraction of peak held while the gate stays true.', peak: 'Maximum level. 1 is full.' },
  },
  nap: {
    when: 'You want to ignore a signal for a while after it fires, or hold it while something else is true.',
    steps: ['Connect a signal to **Input**.', 'Pick a **Mode** and set the **Duration** or **Max sleep**.', 'In *Suspend* mode connect a boolean to **Sleep**.'],
    tips: ['*Refractory* is a one-shot debounce.'],
    alias: 'refractory cooldown debounce suspend hold pause ignore rest',
    options: { mode: { refractory: 'The first value passes, then inputs are ignored for the duration.', suspend: 'While Sleep is true the newest input is held, and released when it turns false or Max hold elapses.' } },
  },
  wave: {
    when: 'You need a slowly (or quickly) varying number: a sweep, a pulse train, a breathing rhythm.',
    steps: ['Add **Wave** and choose a **Shape**, **Frequency** and **Amplitude**.', 'Use **Output**. It is ±Amplitude around **Offset**.', 'Optionally drive Frequency or Amplitude from signals.'],
    tips: ['A 0–1 wave: Amplitude 0.5, Offset 0.5.', 'Frequencies above half the tick rate alias (for the default 50 ms tick, stay below 10 Hz).'],
    down: ['plastic', 'audio', 'meter', 'inductor'], alias: 'lfo oscillator sine triangle square saw sweep modulate cycle',
    settings: { freq: 'Used only while F has no wire.', amp: 'Used only while A has no wire.', offset: 'Added to the waveform.' },
    options: { shape: { sine: 'Smooth wave.', triangle: 'Linear ramp up and down.', square: 'Jumps between two levels.', saw: 'Ramps up, then snaps back.' } },
  },
  equation: {
    when: 'You want to graph a mathematical function, or compute y from x.',
    steps: ['Select **Equation** and type into **Equation** in the inspector.', 'Connect its **Equation** output to a [[n:meter]] and press Run to see the graph.', 'Use **y(x)** to evaluate the first equation at a number (from **X** or the **Evaluate at x** setting).'],
    tips: ['One equation per line, or separate with `;` to graph several curves.', 'A leading `y =` is allowed. `2x` and `3sin(x)` work.', '`t` is simulation time in seconds, so `sin(x - 2t)` animates.', 'Functions: abs, sqrt, square, sin, cos, tan, tanh, exp, log, ln, log10, log2, floor, round, ceil, min, max, pow, mod, asin, acos, atan, atan2, sinh, cosh, cbrt, sign, trunc, fract, hypot, clamp, step, saw, tri, sqr. Constants: pi, e, tau, phi.'],
    pitfalls: ['Syntax errors, unknown names and wrong argument counts raise an error naming the problem.', 'x max must be greater than x min.', 'If y(x) is not finite (sqrt of a negative) the graph shows a gap and y is cleared.'],
    down: ['meter'], alias: 'function graph plot math formula curve expression sin cos',
    settings: { expr: 'Examples: `sin(x)`, `x^2 - 3x + 1`, `sin(x); cos(x)`, `exp(-x^2/4) * cos(3x)`.', samples: 'More samples draw sharper curves.', yAuto: 'Off lets you fix the vertical range with y min and y max.' },
  },
  event: {
    when: 'You want to turn any trigger into a named event, mainly for a State machine.',
    steps: ['Connect a trigger to **Trigger**.', 'Set the **Event name**.', 'Connect **Event** to a [[n:state]] **Event** input.'],
    tips: ['Every truthy arrival emits the name, even if the previous one was identical.'],
    up: ['pulse', 'threshold', 'keys'], down: ['state'], alias: 'trigger signal message emit named',
    settings: { name: 'The text State machines match on, such as `next`.' },
  },
  setlanguage: {
    when: 'You want the editor itself to switch between English, Simplified Chinese and Traditional Chinese: from a program, a switch or a timer.',
    steps: ['Add **Set Language** from **Workspace Settings**, the last section of the library.', 'Pick the **Language** in the inspector: *English*, *简体中文* (Simplified) or *繁體中文* (Traditional).', 'Press **Run**. With **Apply when** on *Program starts or setting changes*, the whole editor switches at once.', 'To switch on demand instead, set **Apply when** to *Apply pin receives a signal* and connect a [[n:switch]] or [[n:pulse]] to **Apply**.', 'To choose the language from the program, connect text (`en`, `zh-Hans` or `zh-Hant`) to the **Language** setting pin on the left edge.'],
    tips: ['Every setting has a pin: **Language**, **Apply when**, **Remember choice** and **Show notice** can all be driven by signals.', 'The **Language** and **Name** outputs report the language the module is set to, so other modules can react to it. **Applied** fires once each time the module applies it.', 'The same choice is always available from the **Settings** button on the toolbar.', 'The language only changes the editor. Programs, saved files and share codes are identical in every language.'],
    pitfalls: ['A Language pin carrying an unknown code falls back to English.', 'With **Remember choice** off the language lasts for this session only; the next visit starts in the language saved in Settings.', 'In *Signal* mode nothing happens until a truthy value reaches **Apply**.'],
    up: ['switch', 'pulse', 'constant', 'keys'], down: ['text', 'comment'], alias: 'language locale translate translation chinese simplified traditional english interface i18n 中文 简体 繁體 workspace settings',
    settings: { language: 'The language to switch to. Codes for the pin: `en`, `zh-Hans`, `zh-Hant`.', mode: 'Auto is enough for a fixed choice. Use Signal to switch at a moment you control.', remember: 'Saved in this browser, like the choice in Settings.', notice: 'A small message confirming the switch. Turn off for silent switching.' },
    options: { language: { en: 'English.', 'zh-Hans': 'Simplified Chinese, as used in mainland China and Singapore.', 'zh-Hant': 'Traditional Chinese, as used in Taiwan, Hong Kong and Macau.' }, mode: { auto: 'Applies when the program starts and whenever the Language setting changes.', signal: 'Applies each time a truthy value reaches the Apply pin.' } },
  },
  comment: {
    when: 'You want to leave a note on the workspace.',
    steps: ['Add **Comment** and edit **Note** in the inspector.'],
    tips: ['It never takes part in execution. Long notes are clipped on the node; the full text is in the inspector.'],
    alias: 'note annotation label remark documentation',
  },
  clock: {
    when: 'You want the current local time of a city anywhere in the world, as text to show or as numbers to react to.',
    steps: ['Add **World Clock** and type a city in **City**. Suggestions appear as you type.', 'Use **Time** and **Date** (text) with a [[n:projector]] or [[n:text]] module.', 'Use **UTC offset** (the third pin on the bottom edge, beside **Date**) and **Hour**, **Minute**, **Seconds** or **Milliseconds** (numbers, on the right edge) to drive logic, for example a [[n:threshold]].', 'Choose the clock style with **Format**, **Show seconds** and **Show milliseconds**. Milliseconds appear after the seconds, as in `14:30:05.123`.', 'To choose the city from the program, connect text to the **City** pin.'],
    tips: ['The 30 most populous cities of every country are known, about 6,100 cities in 246 countries and territories.', 'Write the country after a comma, such as `Paris, France` or `Paris, FR`, when a name exists in several countries. A bare name picks the most populous one.', 'Accents and capitals are ignored: `sao paulo` finds São Paulo. A few old names work too, such as Bombay and Kiev.', 'Daylight saving time is applied automatically, so **UTC offset** changes during the year.'],
    pitfalls: ['A city outside the list (a small town, or the 31st city of a country) raises an error. Choose the nearest listed city instead.', 'It reads your device clock: if that clock is wrong, every city is wrong by the same amount.', 'With **Show milliseconds** on (the default) the display refreshes every tick, about 20 times a second, so the last digits move quickly. Turn it off to update once a second.'],
    up: ['constant', 'text'], down: ['projector', 'text', 'threshold', 'meter'], alias: 'world clock time zone timezone city country hour date local utc offset daylight saving watch',
    settings: { city: 'Examples: `Tokyo`, `Sydney, Australia`, `Springfield, US`.', format: 'Only changes the Time text. **Hour** is always 0–23.', seconds: 'Turn off for a calmer display that changes once a minute. The **Seconds** output keeps updating once a second either way.', millis: 'Also keeps the **Milliseconds** output refreshing every tick. With it off, that output only updates once a second.' },
    options: { format: { '24h': 'Like 14:30.', '12h': 'Like 2:30 PM.' } },
  },
  timer: {
    when: 'You want something to happen after a set time: a countdown to show, a delay to wait out, or a repeating interval.',
    steps: ['Add **Timer** and set **Duration** in seconds. With **Auto start** on (the default) it counts down as soon as you press Run.', 'Connect **Time** to a [[n:projector]] or [[n:text]] module to watch the countdown, to the millisecond (04:59.250).', 'Connect **Done** to what should happen at zero, for example a [[n:notify]] or a [[n:counter]].', 'To start it yourself, turn **Auto start** off and drive **Start** from a [[n:switch]], [[n:keys]] or any trigger. **Pause** holds it and **Reset** puts it back to the full time.'],
    tips: ['**Progress** goes from 0 to 1, so it can drive a [[n:meter]] or a [[n:light]] that fills as time runs out.', 'Take the time left apart with **Hour**, **Minute**, **Seconds** and **Milliseconds** (numbers, on the right edge), the same pins as [[n:clock]]. **Hour** counts whole hours, so it is not wrapped at 24.', 'Turn on **Repeat** for a steady interval: **Done** then becomes a short pulse every round, and **Completions** counts the rounds.', 'Drive **Duration** from a signal via its setting pin to make the countdown longer or shorter while the program runs.', 'The START, PAUSE / RESUME and RESET buttons in the inspector work the same as the pins.'],
    pitfalls: ['It counts simulation time, not the wall clock: pausing the program pauses the timer, and Stop → Run starts it over.', 'Changing **Duration** while the timer runs does not shorten the current countdown. It takes effect at the next start or after Reset.', 'With **Show milliseconds** off the Time text rounds up, so it shows 00:01 for the whole last second. The **Hour**, **Minute**, **Seconds** and **Milliseconds** pins stay exact either way.', 'The outputs refresh every tick (about 20 times a second by default) while the timer runs.'],
    up: ['switch', 'keys', 'threshold', 'pulse'], down: ['projector', 'text', 'notify', 'meter', 'counter'], alias: 'countdown count down timeout delay interval remaining egg cooking pomodoro',
    settings: { duration: 'Seconds. 90 is a minute and a half; 3600 is one hour.', autostart: 'Leave on for a countdown that begins with the program. Turn off to use Start.', repeat: 'Makes the timer an interval clock.', millis: 'On by default: shows 04:59.250. Off shows 05:00 and only changes the Time text.' },
  },
  alarm: {
    when: 'You want something to happen at a time of day, such as 07:30, in this device’s time zone or in another city.',
    steps: ['Add **Alarm** and type the **Time**, such as `07:30`, `19:45:30`, `19:45:30.250` or `7:30 pm`.', 'Choose which days it rings with **Repeat**. Leave **City** empty to use this device’s clock, or type a city to use its clock.', 'Connect **Ringing** to what should react, for example a [[n:light]], an [[n:audio]] or a [[n:notify]].', 'Press **TEST RING** in the inspector to try the connection without waiting.'],
    tips: ['**Time left** (to the millisecond, 07:12:30.250) and **Seconds left** count down to the next ring, and **Next ring** says when it is.', 'Take the time left apart with **Hour**, **Minute**, **Seconds** and **Milliseconds** (numbers, on the right edge), the same pins as [[n:clock]]. **Hour** counts whole hours, so a day and two hours is 26.', 'Wire a trigger to **Snooze** to silence the alarm for 5 minutes, or to **Dismiss** to silence it for good.', '**Ring time** sets how long **Ringing** stays true if nobody dismisses it.', 'Drive **Time** from text via its setting pin to set the alarm from the program.'],
    pitfalls: ['The program must be running when the time arrives. Starting it after the alarm time does not make the alarm ring.', '“Once” rings a single time and then waits until a setting changes.', 'It reads your device clock: if that clock is wrong, the alarm is wrong by the same amount.', 'Across a daylight-saving change the countdown can be off by an hour until that moment has passed.', 'The outputs refresh every tick, about 20 times a second by default. They have no value when the alarm will not ring again.'],
    up: ['switch', 'keys', 'timer', 'text'], down: ['light', 'audio', 'notify', 'projector', 'haptic'], alias: 'wake up ring bell reminder schedule snooze time of day clock buzzer',
    settings: { time: 'Written as 24-hour or with am/pm. Seconds and milliseconds are allowed: `07:30:15.250`. The alarm always shows its time, **Time left** and **Next ring** to the millisecond.', repeat: 'Weekdays means Monday to Friday, weekends Saturday and Sunday.', city: 'Same list as [[n:clock]]. Empty means this device.', ring: 'Seconds that Ringing stays true.' },
    options: { repeat: { once: 'Rings the next time the time is reached, then stays quiet until a setting changes.', daily: 'Rings every day.', weekdays: 'Rings Monday to Friday.', weekends: 'Rings on Saturday and Sunday.' } },
  },
  stopwatch: {
    when: 'You want to measure how long something takes, or know how much time has passed since an event.',
    steps: ['Add **Stopwatch**. With **Auto start** on (the default) it begins counting when you press Run.', 'Connect **Time** to a [[n:projector]] or [[n:text]] module (01:05.250), or **Elapsed** (seconds, to the millisecond) to a number consumer such as a [[n:threshold]].', 'Turn **Auto start** off and drive **Start**, **Stop**, **Lap** and **Reset** from triggers to control it yourself.', 'Use **Lap time** and **Laps** to read splits. The START / STOP, LAP and RESET buttons in the inspector do the same by hand.'],
    tips: ['A lap is the time since the previous lap, so lap times add up to the total.', 'Set **Stop at** to make the stopwatch stop by itself, for example after 30 seconds. Start then begins a new run.', '**Running** is true while it counts: use it to light a [[n:light]] or gate a [[n:relay]].', 'Take the elapsed time apart with **Hour**, **Minute**, **Seconds** and **Milliseconds** (numbers, on the right edge), the same pins as [[n:clock]].'],
    pitfalls: ['It counts simulation time, not the wall clock: pausing the program pauses the stopwatch, and Stop → Run starts it over.', '**Lap** is ignored while the stopwatch is stopped.', 'Its outputs change every tick, about 20 times a second, while it counts.', 'With **Show milliseconds** off only the Time text loses its milliseconds. The four time pins stay exact.'],
    up: ['switch', 'keys', 'threshold', 'pulse'], down: ['projector', 'text', 'threshold', 'meter'], alias: 'chronometer count up elapsed lap split measure duration race',
    settings: { autostart: 'Leave on to time from the moment the program runs.', millis: 'On by default. Turn off to show whole seconds in the Time text; the **Hour**, **Minute**, **Seconds** and **Milliseconds** pins stay exact.', limit: 'Seconds. 0 means no limit.' },
  },
  by: {
    when: 'You want to credit the author of a program.',
    steps: ['Add **By** and set **Author**.'],
    pitfalls: ['It is only text. It is not a signature and does not prove who made the program.'],
    alias: 'author credit signature owner biomark',
  },
};

/* ───── Quantities: one guide per module, written from the quantity table so it never drifts from the units on offer ───── */
for (const q of QUANTITIES) {
  const grp = GROUP_BY_ID.get(q.group)!;
  const first = q.units[0];
  const names = q.units.map((u) => `**${u}** (${UNIT_BY_SYM.get(u)!.name})`).join(', ');
  const sameGroup = QUANTITIES.filter((x) => x.group === q.group && x.id !== q.id).map((x) => `[[n:qty-${x.id}]]`);
  GUIDE[`qty-${q.id}`] = {
    when: `You want ${q.about} in your program written as <amount><unit> (for example 2.5${first}), or want to convert it between units and SI prefixes.`,
    steps: [
      `Add **${q.name}** and type an **Amount**. Pick the **Prefix** and the **Unit** (${q.units.join(', ')}).`,
      `Connect **Quantity** (text, such as 2.5${first}) to a [[n:projector]] or [[n:text]] module to read it, or **Amount** to anything that takes a number.`,
      `Connect **SI value** (in ${grp.baseName}, ${grp.base}) to [[n:compare]], [[n:math]] or [[n:threshold]] to calculate with it whatever unit it is written in.`,
      `To convert, wire the **Quantity** output of one ${q.name} module into the **Quantity** input of another and set its **Prefix** and **Unit** to what you want to read.`,
    ],
    tips: [
      `Units here: ${names}. Every one of them takes every SI prefix: q r y z a f p n μ m c d da h k M G T P E Z Y R Q.`,
      'Set **Prefix** to *auto* and the module picks the step of 1000 that keeps the amount between 1 and 999, so 0.0000025 s reads 2.5μs.',
      'Amount, Prefix and Unit also have setting pins on the left edge, so a signal can change them while the program runs. The module is made tall enough that the pins keep their distance.',
      'Text on the Quantity input is read as <amount><unit>: 90min, 1.5e3m, 4.7µF. A plain number is an amount in the unit chosen on this module.',
      ...(q.id === 'mass' ? ['The gram takes the prefix, so the module starts as 1 kg: Prefix k and Unit g.'] : []),
      ...(q.id === 'temperature' ? ['Celsius keeps its offset: 25 °C is 298.15 K in the SI value.'] : []),
      ...(sameGroup.length ? [`${sameGroup.join(', ')} measures the same thing and converts with this module.`] : []),
    ],
    pitfalls: [
      `The Quantity input only takes units of ${q.name.toLowerCase()}. Anything else (a mass given to a time module) raises an error that names the problem.`,
      'A few spellings fit two units: **cd** is the candela or a centiday, **au** an astronomical unit or an attodalton. The module that is reading decides, so 5cd is a candela in Luminous intensity and five centidays in Time.',
      'Prefix is case-sensitive: M is mega, m is milli; P is peta, p is pico. Write micro as μ or µ.',
      'Amount is held to 12 significant digits; the SI value of a prefixed Celsius amount cannot be more exact than the 273.15 it is added to.',
    ],
    up: ['constant', 'random', 'wave', 'switch'], down: ['projector', 'text', 'compare', 'math', 'meter'],
    alias: `quantity unit prefix ${q.words} ${q.units.join(' ')}`,
    settings: {
      amount: 'How much, in the prefix and unit below. Negative amounts are fine.',
      prefix: 'none is ×1. auto chooses the best fit. The other 24 are the SI prefixes from quecto (q, 10⁻³⁰) to quetta (Q, 10³⁰).',
      unit: `One of ${q.units.join(', ')}.`,
    },
    options: {
      prefix: { none: 'No prefix: the unit as it is.', auto: 'Pick the step of 1000 that keeps the amount between 1 and 999.', ...Object.fromEntries(PREFIXES.map((x) => [x.sym, `${x.name}: multiplies the unit by 10^${x.exp}.`])) },
      unit: Object.fromEntries(q.units.map((u) => [u, `${UNIT_BY_SYM.get(u)!.name}.`])),
    },
  };
}

/* ───── Base Data: the six basic data types ───── */
Object.assign(GUIDE, {
  integer: {
    when: 'You need a whole number: a count, a step, an index, a code.',
    steps: [
      'Add **Integer** and type a **Value**.',
      'Connect **Integer** to anything that takes a number, such as [[n:add]], [[n:compare]] or [[n:projector]].',
      'To turn another signal into a whole number, wire it into the **Input** pin on the left and pick a **Rounding**.',
      'Pick a **Base** to read the number as binary, octal or hexadecimal on the node face and on the **Text** output.',
    ],
    tips: [
      'Value, Rounding and Base each have a setting pin on the top edge, so a signal can change them while the program runs.',
      'Input also understands text such as 42 or 0xFF, and reads true as 1 and false as 0.',
      'The range is a signed 32-bit integer: −2 147 483 648 to 2 147 483 647.',
    ],
    pitfalls: [
      'A fraction is never kept: 2.7 becomes 2 with *Toward zero*, 3 with *Nearest*. Use [[n:decimal]] when the fraction matters.',
      'A number beyond the range is held at the limit and the node shows a warning.',
      'The Integer output is always a plain number. Base only changes how it is written, on the face and on Text.',
    ],
    up: ['constant', 'random', 'decimal', 'string'], down: ['add', 'compare', 'projector', 'character'],
    alias: 'int whole number counter hexadecimal binary octal base data type',
    settings: {
      value: 'Negative numbers are fine. Typing 3.9 here is made whole by Rounding.',
      rounding: 'Applies to the Input pin and to a Value that arrives on its setting pin.',
      base: 'Display only. 255 reads FF in hexadecimal, 11111111 in binary.',
    },
    options: {
      rounding: { trunc: 'Cut the fraction off: 2.7 → 2 and −2.7 → −2.', round: 'The nearest whole number: 2.5 → 3.', floor: 'Always down: 2.7 → 2 and −2.1 → −3.', ceil: 'Always up: 2.1 → 3 and −2.7 → −2.' },
      base: { dec: 'Ordinary digits, 0–9.', bin: 'Binary, written 0b101.', oct: 'Octal, written 0o17.', hex: 'Hexadecimal, written 0xFF.' },
    },
  },
  decimal: {
    when: 'You need a number with a fractional part and you want it kept exactly as typed, with as many digits as you like.',
    steps: [
      'Add **Decimal** and type a **Value** such as 3.14159265358979323846264338327950288.',
      'Connect **Text** to a [[n:projector]] to see every digit, or to a [[n:actor-numfmt]] to round or reformat it.',
      'Connect **Decimal** to an [[n:add]], [[n:mul]], [[n:math]] or any node that takes a number: it carries every digit, so nothing is lost on the way.',
    ],
    tips: [
      'A Decimal never rounds. Every digit you type, including trailing zeros (3.50), comes out on **Text**.',
      'To round to n places or n digits, or to write the number in scientific or engineering notation, use a [[n:actor-numfmt]] from the **Actors** section.',
      'The arithmetic nodes ([[n:add]], [[n:sub]], [[n:mul]], [[n:div]], [[n:math]]) work on all the digits, so 3 + 0.14159265358979323846 is exactly 3.14159265358979323846.',
      'Exponents are understood: 6.022e23 comes out as 602200000000000000000000.',
    ],
    pitfalls: [
      'Only the **Text** pin keeps trailing zeros (3.50): the **Decimal** pin is a number, and 3.50 and 3.5 are the same number.',
      'Input text that is not a number (for example “1,5” with a comma) raises an error.',
      'Numbers beyond about 1e308 are fine too, but a node that uses a double (a Meter plot, a Wave) can only follow them as far as a double goes.',
    ],
    up: ['constant', 'random', 'integer', 'wave', 'string'], down: ['actor-numfmt', 'mul', 'add', 'compare', 'projector', 'meter'],
    alias: 'float double real fraction floating point precision places arbitrary exact digits big pi base data type',
    settings: {
      value: 'Any number, with any number of digits (up to 5000 characters). Commas are not accepted; use a point.',
    },
  },
  string: {
    when: 'You need a piece of text: a message, a label, a name, a command.',
    steps: [
      'Add **String** and type the **Value**.',
      'Connect **String** to a [[n:projector]] or [[n:text]] module to show it.',
      'Connect **Length** to anything that takes a number to count its characters.',
      'To turn any other signal into text, wire it into the **Input** pin on the left.',
    ],
    tips: [
      'Case can change the text to capitals, small letters or Capitalize Words, and Trim removes stray spaces. Both have setting pins.',
      'Length counts characters the way a person does: an emoji is one, not two.',
      'Numbers arrive with every digit they have, and lists arrive as their JSON text. To shorten them, use a [[n:actor-numfmt]].',
    ],
    pitfalls: [
      'Text is not a number: “42” only becomes 42 when you send it to a module that takes numbers. Use [[n:integer]] or [[n:decimal]] to convert it.',
      'Capitalize Words only raises the first letter of each word; it never lowers the rest.',
    ],
    up: ['constant', 'integer', 'decimal', 'boolean', 'array'], down: ['projector', 'text', 'array', 'character'],
    alias: 'text words sentence message label characters case upper lower trim length base data type',
    settings: {
      value: 'Up to 2000 characters. Line breaks are kept.',
      case: 'Applies to the Value and to anything arriving on Input.',
      trim: 'Only removes whitespace at the two ends, never inside.',
    },
    options: { case: { keep: 'Exactly as typed.', upper: 'Every letter a capital.', lower: 'Every letter small.', title: 'The first letter of each word a capital.' } },
  },
  character: {
    when: 'You need exactly one letter, digit or symbol, or the code that stands for it.',
    steps: [
      'Add **Character** and type one character in **Value**.',
      'Connect **Character** to anything that takes text, or **Code** (its Unicode code point) to anything that takes a number.',
      'To pick the first letter of a word, wire a [[n:string]] into **Input**.',
      'To turn a number into a letter, set **Number input** to *As code point* and wire the number into **Input**: 65 gives A.',
    ],
    tips: [
      'Any Unicode character works: letters of any alphabet, digits, punctuation and emoji.',
      'The face shows the character and its code point in the usual U+0041 form.',
      'Value, Case and Number input have setting pins on the top edge.',
    ],
    pitfalls: [
      'Only one character is kept. If you type more, the first is used and the node shows a warning.',
      'An empty Value or Input is an error: a character cannot be nothing. Use [[n:string]] for text that may be empty.',
      'In code point mode a number must be a whole number from 0 to 1 114 111 and not one of the surrogate halves 55 296–57 343.',
    ],
    up: ['string', 'integer', 'constant', 'keys'], down: ['string', 'compare', 'projector'],
    alias: 'char letter symbol glyph unicode code point ascii emoji base data type',
    settings: {
      value: 'Exactly one character. Spaces count.',
      case: 'Only letters change. In a few languages a capital would be longer than one character; the character is then left alone.',
      numbers: 'Matters only for numbers arriving on Input. Text always uses its first character.',
    },
    options: {
      case: { keep: 'Exactly as typed.', upper: 'The capital form of a letter.', lower: 'The small form of a letter.' },
      numbers: { text: 'The number written out: 5 gives “5” and 42 gives “4”.', code: 'The number as a Unicode code point: 65 gives “A”.' },
    },
  },
  boolean: {
    when: 'You need a truth value: on or off, yes or no, true or false.',
    steps: [
      'Add **Boolean** and switch **Value** on or off.',
      'Connect **Boolean** to anything that takes true or false, such as [[n:relay]].',
      'Connect **Not** to get the opposite without a separate module.',
      'To turn another signal into true or false, wire it into **Input**.',
    ],
    tips: [
      'Words only changes how the value is written (yes / no, on / off, 1 / 0); the Boolean output stays true or false.',
      'Input reads 0, empty text, an empty list and the words false, no, off, n and f as false. Everything else is true.',
      'Value and Words have setting pins on the top edge.',
    ],
    pitfalls: [
      'A text such as “off” is false here but would be true in a module that only checks for empty text. Boolean is the safer converter.',
      'The Text output follows Words, so it can say “yes”. Use the Boolean output for logic.',
    ],
    up: ['compare', 'threshold', 'switch', 'pulse', 'string'], down: ['relay', 'combine', 'projector', 'string'],
    alias: 'bool true false yes no on off flag truth logic toggle base data type',
    settings: { value: 'The truth value emitted while Input is not connected.', words: 'Display and Text output only.' },
    options: { words: { tf: 'true and false.', yn: 'yes and no.', oo: 'on and off.', bit: '1 and 0.' } },
  },
  array: {
    when: 'You need a list of values kept together, in order: the readings of a day, the words of a sentence, a row of numbers.',
    steps: [
      'Add **Array** and type the **Items**: 1, 2, 3, or a JSON list such as [1, "a", true].',
      'Connect **Length** to anything that takes a number to count the items.',
      'Set **Index** to choose one item for the **Item** output. 0 is the first; −1 is the last.',
      'To split text into a list, wire a [[n:string]] into **Input** and set the **Separator**.',
    ],
    tips: [
      'Items as *Automatic* reads 12 as a number, true and false as booleans, and the rest as text. Choose *Text* to keep every item as typed.',
      'An empty Separator makes every character an item, so “hello” becomes five items.',
      'Items, Separator, Items as and Index all have setting pins on the top edge, so a signal can change the index to walk through the list.',
      'A list wired to a text input arrives as its JSON text, ready for a [[n:projector]].',
    ],
    pitfalls: [
      'Empty pieces are dropped: “1,,2” has two items, not three. Use a JSON list such as [1, "", 2] to keep an empty one.',
      'An Index outside the list leaves **Item** empty and shows a warning.',
      'A list holds at most 10 000 items.',
      'Items as *Numbers* raises an error on the first item that is not a number.',
    ],
    up: ['string', 'constant', 'integer', 'array'], down: ['projector', 'compare', 'array', 'math'],
    alias: 'list array items collection vector values index element length csv json split base data type',
    settings: {
      items: 'Comma-separated by default; write a JSON list to keep strings with commas.',
      separator: 'Up to 8 characters. Spaces around items are trimmed.',
      as: 'How each item is read when the text is split.',
      index: 'Negative counts from the end.',
    },
    options: { as: { auto: 'Numbers, true/false and text, each read as it looks.', number: 'Every item must be a number.', text: 'Every item stays text.' } },
  },
} satisfies Record<string, NodeGuide>);


/* ───── Actors ───── */
GUIDE['actor-fileconv'] = {
  when: 'You have a file in one category and need it in another: a picture as a PDF, a Word document as plain text, a CSV as an Excel workbook, a video as a still frame.',
  steps: [
    'Add a Files node (for example **Image**) from the **Files** section and drop a file on it.',
    'Add **File Converter** from the **Actors** section and connect the Files node’s **File** output to its **File** pin.',
    'In the inspector choose **Convert from** (the category of your file), **Convert to** and **Format**. Only conversions that really work are offered.',
    'Press **Run**. The node says “Converting…” and then shows the new file’s name and size. Use **Download result** in the inspector to save it, or connect **File** to a [[n:projector]] to look at it.',
  ],
  tips: [
    'Convert once, then convert again: the **File** output can feed another File Converter (for example Image → PDF → ZIP).',
    'Text and tables work in both directions where it makes sense: Text → Document (.DOCX), Document → Text, CSV ↔ XLSX, Web page → Text, Spreadsheet → Web page.',
    'Anything can be packed into a ZIP, including files that no other conversion takes.',
    'Every setting is also a pin on the left. A [[n:constant]] holding text like `webp` on **Format** switches the result type while the program runs.',
    '**Result name** renames the new file; leave it empty to keep the original name with the new extension.',
  ],
  pitfalls: [
    'The file’s category must match **Convert from**. A picture sent to a converter that takes text is refused with a message that names both.',
    'Changing **Convert from** can change **Convert to** and **Format**, because only valid pairs are offered. The first valid choice is used.',
    'PDF files cannot be read for their text, and old .DOC, .XLS and .PPT files cannot be opened in a browser, so they can only be packed into a ZIP.',
    'MP3 cannot be written (browsers cannot encode it). Sound becomes a .WAV, which is large; a very long recording is refused.',
    'Text with characters outside Western European languages (Chinese, for example) becomes a PDF made of page pictures, so its text cannot be selected.',
    'The converted file is not saved with the program; it is made again each time the program runs.',
  ],
  up: ['file-document', 'file-text', 'file-image', 'file-audio', 'file-video', 'file-spreadsheet', 'file-presentation', 'file-web', 'file-pdf', 'file-compressed'],
  down: ['projector', 'text', 'image', 'actor-fileconv', 'timer'],
  alias: 'convert converter file format transform change save as export import pdf docx png jpg jpeg webp bmp svg wav zip csv xlsx html txt md rtf image picture document audio video spreadsheet',
  settings: {
    from: 'The category of the file you will connect. Set it first: it decides what the other two settings offer.',
    to: 'The category you want. Choose Compressed to pack any file into a ZIP.',
    format: 'The file type of the result. The choice depends on the category you picked.',
    name: 'Without an extension. The extension always comes from **Format**.',
    quality: 'Only JPEG, WebP and pictures drawn into a PDF use it. 0.92 is a good balance; lower is smaller.',
  },
};

GUIDE['actor-unitconv'] = {
  when: 'You have a quantity in one unit and need it in another of the same kind: kilometres to miles, °C to °F, pounds to kilograms, litres to gallons.',
  steps: [
    'Add **Unit Converter** from the **Actors** section.',
    'Choose the **Quantity** (the kind: Length, Mass, Temperature …). Then choose the **From unit** and the **To unit**; only units of that kind are listed.',
    'Type an **Amount** in the inspector, or connect a number or text such as `5280ft` to the **Quantity** pin.',
    'Read the result on **Quantity** (text like `1.609344km`), **Amount** (the number) or **Unit**. Connect it to a [[n:projector]] to see it.',
  ],
  tips: [
    'Text on the **Quantity** pin brings its own unit: `26.2mi` is read as miles whatever **From unit** says. A plain number is read in the **From unit**.',
    'Use a prefix for metric units: **To unit** *m* with **To prefix** *k* gives kilometres. Set **To prefix** to *auto* to let the converter choose.',
    'Units like ft, lb, psi and mph take no prefix, so the prefix setting is ignored for them.',
    '**Swap units** in the inspector turns a conversion around.',
    'Every setting is also a pin on the left. Drive **To unit** with a [[n:switch]] or a [[n:constant]] to let the program choose the unit.',
    'The **SI value** output is the same quantity in the metre, kilogram, second or kelvin: handy for comparing quantities written in different units.',
  ],
  pitfalls: [
    'A length cannot be converted to a mass. A quantity of another kind on the **Quantity** pin (`5kg` into a length converter) raises an error that names both kinds.',
    'Changing the **Quantity** changes the units on offer; a unit that no longer fits is replaced by the first one of the new kind.',
    'The unit names are case-sensitive: *mm* is millimetres, *Mm* is megametres, and *Pa* is not *pa*.',
    'Temperatures convert by their scales, not by ratio: 0 °C is 32 °F, not 0.',
  ],
  up: ['constant', 'switch', 'random', 'qty-length', 'qty-mass', 'qty-temperature', 'qty-time'],
  down: ['projector', 'text', 'compare', 'meter'],
  alias: 'convert converter unit units measurement quantity metric imperial length mass temperature celsius fahrenheit kelvin feet inches miles kilometres kilometers pounds kilograms gallons litres liters speed mph pressure psi energy area',
  settings: {
    group: 'Pick this first: it decides which units are listed.',
    amount: 'Used when nothing is connected to the Quantity pin.',
    from: 'The unit your amount is written in.',
    fromPrefix: 'Optional SI prefix, for example *k* + *m* for kilometres.',
    to: 'The unit you want.',
    toPrefix: '*auto* keeps the result between 1 and 999 by choosing a prefix.',
  },
};

GUIDE['actor-numfmt'] = {
  when: 'You need a number rounded to some decimal places or digits, or written in scientific or engineering notation, for display or for the next step of your program.',
  steps: [
    'Add **Number Formatter** from the **Actors** section.',
    'Pick the **Format**: round to n decimal places, round to n significant digits, scientific notation, engineering notation, or exact.',
    'Set **Digits (n)**, and the **Rounding** rule if you need something other than the nearest.',
    'Type a **Value** in the inspector, or connect a number (or the **Text** of a [[n:decimal]]) to the **Number** pin.',
    'Read the result on **Formatted** (text), **Number**, **Mantissa** or **Exponent**. Connect it to a [[n:projector]] to see it.',
  ],
  tips: [
    'This is the only node that rounds. [[n:decimal]] keeps every digit, so you choose when and how much to round.',
    'Feed it a **Decimal**, or any number with more than 15 digits: it is rounded exactly, on every digit.',
    '**Digits (n)** means decimal places for *Round to n decimal places* and significant digits for everything else. In the digits and notation formats, 0 keeps every digit.',
    'Engineering notation keeps the exponent a multiple of 3 (12.35e+3), which lines up with the SI prefixes. **Exponent** gives that power for a Quantities prefix.',
    '**Trim trailing zeros** turns 3.100 into 3.1. **Exponent style** switches 1.5e+3 to 1.5 × 10³.',
    'Every setting is also a pin on the left, so a signal can change the number of digits while the program runs.',
  ],
  pitfalls: [
    'Rounding 2.5 to 0 places gives 3 with *Nearest* but 2 with *halves to even*. Pick the rule your field uses.',
    '**Number** carries the rounded value with every digit. **Formatted** is the same value as text, with the trailing zeros you asked for.',
    'A value that is not a number (“1,5”, “abc”) raises an error; the comma is not a decimal point.',
    'Rounding a number up can add a digit: 9.99 to 2 significant digits is 10, shown as 10.',
  ],
  up: ['decimal', 'integer', 'constant', 'random', 'string', 'qty-length'],
  down: ['projector', 'text', 'string', 'compare'],
  alias: 'number format formatter round rounding decimal places digits significant figures scientific engineering notation exponent mantissa precision truncate ceiling floor banker',
  settings: {
    value: 'Used when nothing is connected to the Number pin. Any number of digits.',
    mode: 'Decimal places and significant digits shorten the number; the notations write it with a power of ten; Exact only rewrites it.',
    n: 'Decimal places or significant digits, 0 to 1000. For significant digits, scientific and engineering, 0 keeps every digit.',
    rounding: 'Only matters when digits are cut off.',
    trim: 'Off keeps the zeros the digits count asks for (3.100); on removes them (3.1).',
    style: 'Only used by scientific and engineering notation.',
  },
  options: {
    mode: {
      places: 'Fixed number of digits after the point: 3.14159 at 2 places is 3.14.',
      digits: 'Fixed number of significant digits: 31415.9 at 3 digits is 31400.',
      sci: 'One digit before the point and a power of ten: 31415.9 is 3.14159e+4.',
      eng: 'One to three digits before the point and a power of ten that is a multiple of 3: 31415.9 is 31.4159e+3.',
      plain: 'Every digit, written out without an exponent. Nothing is rounded.',
    },
    rounding: {
      nearest: 'The closest value; a tie goes away from zero: 2.5 → 3, −2.5 → −3.',
      even: 'The closest value; a tie goes to the even digit: 2.5 → 2, 3.5 → 4.',
      up: 'Always toward +∞: 2.1 → 3, −2.9 → −2.',
      down: 'Always toward −∞: 2.9 → 2, −2.1 → −3.',
      zero: 'Cut the extra digits off: 2.9 → 2, −2.9 → −2.',
      away: 'Any leftover digit pushes the number away from zero: 2.1 → 3, −2.1 → −3.',
    },
    style: { e: 'The letter e and a signed exponent: 1.5e+3.', x10: 'Times ten to a superscript power: 1.5 × 10³.' },
  },
};

/* ───── Files: one guide per kind of file ───── */
const FILE_GUIDE: Record<string, Partial<NodeGuide> & { when: string }> = {
  'file-document': {
    when: 'A Word-style document is part of your program and you want its text, name or size.',
    down: ['text', 'projector', 'file-text'], alias: 'word docx doc letter report',
    tips: ['.DOCX is a zip of XML, so its plain text can be pulled out right in the browser. Headings, bold, pictures and table layout are not kept; paragraphs become lines.'],
    pitfalls: ['The old .DOC format is binary. It is stored and described, but **Content** stays empty. Save it as .DOCX to read it.'],
  },
  'file-text': {
    when: 'You want the words of a .MD, .TXT or .RTF file as data in your program.',
    down: ['text', 'projector', 'string', 'sense'], alias: 'markdown notes plain text read',
    tips: ['**Lines** counts the lines read, which is handy for a quick look at a log or a list.'],
    pitfalls: ['Only the first 1 000 000 characters are read; the node shows a warning when a file is longer.', '.RTF is sent as its raw markup (the `{\\rtf1 …}` commands), not as formatted text.'],
  },
  'file-pdf': {
    when: 'A PDF is part of your program and you want to know its name, size or type.',
    down: ['text', 'projector', 'threshold'], alias: 'pdf acrobat portable document',
    pitfalls: ['The text inside a PDF is not extracted. The node knows the file’s name, extension and size only.'],
  },
  'file-audio': {
    when: 'You have a recording and want to know how long it is, or to pass its details on.',
    down: ['timer', 'projector', 'meter'], alias: 'sound music song recording length',
    pitfalls: ['The audio is not played here. Use the [[n:audio]] speaker for a tone.', 'If the browser cannot read a format, **Duration** stays empty; the inspector explains.'],
  },
  'file-video': {
    when: 'You have a video clip and want its length, picture size or a still frame on the workspace.',
    down: ['timer', 'projector', 'meter'], alias: 'movie film clip length resolution',
    tips: ['The node shows a still frame from near the start of the clip when the browser can decode it.'],
    pitfalls: ['The video is not played. MKV and AVI are not decoded by most browsers, so their length and size stay empty; the file is still stored.'],
  },
  'file-image': {
    when: 'You want a picture file to feed an analysis, a display, or a size check.',
    steps: ['Add **Image** from the **Files** section and drop a picture on it.', 'Connect **Image** to [[n:image|Image Display]], [[n:projector]], [[n:sense]] or [[n:knowledge]].', 'Use **Width** and **Height** for the picture’s real pixel size.'],
    down: ['image', 'projector', 'sense', 'knowledge'], alias: 'picture photo jpg png gif svg webp tiff',
    tips: ['The picture on **Image** is scaled to at most 256 px on its long side, so analysis stays fast. **Width** and **Height** still report the original size.', 'Animated GIFs give their first frame.'],
    pitfalls: ['TIFF is decoded only by some browsers. When yours cannot, the file is kept but **Image** stays empty and the node warns.'],
  },
  'file-spreadsheet': {
    when: 'You have a table file and want its text (CSV, SQL) or details (XLSX, XLS, ACCDB).',
    down: ['array', 'text', 'projector'], alias: 'excel csv sql table database rows',
    tips: ['.CSV and .SQL are plain text, so **Content** holds the whole file and **Lines** counts its lines.'],
    pitfalls: ['Workbooks and databases (.XLSX, .XLS, .ACCDB) are stored and described only; their cells are not read.'],
  },
  'file-presentation': {
    when: 'You have a .PPTX deck and want its slide count or the words on the slides.',
    down: ['text', 'projector'], alias: 'powerpoint slides deck',
    pitfalls: ['Only text on slides is read, not pictures, charts or speaker notes.'],
  },
  'file-executable': {
    when: 'A program or script file is part of what your program lists or checks.',
    down: ['text', 'projector'], alias: 'exe msi app bat sh program installer script',
    pitfalls: ['Nothing is ever run. The node only describes the file.', 'Browsers may warn about a download of an executable; here the file is only read into the page.'],
  },
  'file-web': {
    when: 'You want the source of an .HTML, .CSS, .JS or .PHP file as text.',
    down: ['text', 'projector'], alias: 'html css javascript php website source code',
    pitfalls: ['The source is never run, rendered or fetched. A script stays inert text.'],
  },
  'file-compressed': {
    when: 'You have an archive and want to know how many files are inside, or its size.',
    down: ['text', 'projector', 'threshold'], alias: 'zip rar 7z tar gz archive',
    tips: ['For .ZIP files **Entries** counts the files inside (folders are not counted). Nothing is unpacked.', 'Connect **File** to a [[n:projector]] to browse the contents of .ZIP, .TAR, .GZ and .TGZ archives.'],
    pitfalls: ['.RAR and .7Z are stored and described but not looked into.'],
  },
  'file-font': {
    when: 'You have a font file (.TTF, .OTF or .WOFF2) and want to see it, read its name, or show a picture of it.',
    down: ['projector', 'text', 'image'], alias: 'font typeface ttf otf woff2 truetype opentype glyph typography family bold italic specimen',
    tips: [
      'Connect **File** to a [[n:projector]] for the full preview: type your own text in the font, see it from 10 px to 200 px, and browse every character it can draw. The inspector’s **Preview** button opens the same window without wiring anything.',
      '**Specimen** is a picture of the font drawn with the font itself. Send it to an [[n:image]] to see it on the workspace.',
      '**Family**, **Style** and **Glyphs** come from the tables inside the file. For .WOFF2 files they need a browser that can unpack Brotli; otherwise the family is taken from the file name.',
      'The font is installed for this page only, under a private name. It is never uploaded and never added to your computer.',
    ],
    pitfalls: ['Only .TTF, .OTF and .WOFF2 are taken. An older .WOFF or an .EOT goes to Miscellaneous (where the Projector shows it as bytes).', 'A file with a font extension that is not a font, or that the browser refuses, raises a warning and has no Specimen.'],
  },
  'file-misc': {
    when: 'You have a file that none of the other Files nodes takes.',
    down: ['text', 'projector', 'compare'], alias: 'other any unknown anything',
    tips: ['If you drop a file on empty workspace, the matching Files node is created for you, Miscellaneous included.'],
    pitfalls: ['A PDF, picture or any other listed type is turned away with a hint about the right node.'],
  },
};
for (const [type, g] of Object.entries(FILE_GUIDE)) {
  const name = type === 'file-misc' ? 'Miscellaneous' : type.slice(5);
  GUIDE[type] = {
    steps: [
      `Add **${name === 'pdf' ? 'PDF' : name[0].toUpperCase() + name.slice(1)}** from the **Files** section of the library.`,
      'Drag a file from your computer onto the node, or click the node to choose one. The inspector has the same two controls.',
      'Connect **File** (the file as a small record), **Name**, **Extension** or **Size** to anything that reads them, and the kind-specific pins to what you want to feed.',
    ],
    ...g,
    tips: [
      'You can also drop files on empty workspace: a node of the right kind appears under the pointer for each file.',
      'Only the file’s name, size and an id are saved with the program. The file itself stays in this browser, so a program you share or export comes back with empty-looking nodes that ask for the file again.',
      ...(g.tips ?? []),
    ],
    pitfalls: [
      'A node holds one file. Dropping another replaces it (Undo brings the first one back).',
      'A file that belongs to a different Files node is turned away with a message that names the right one.',
      ...(g.pitfalls ?? []),
    ],
    up: [],
    settings: {},
  };
}
