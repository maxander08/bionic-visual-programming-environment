// Core data model for Neural Studio. Pure data, no browser objects.

export type PortType = 'num' | 'bool' | 'text' | 'image' | 'data' | 'any';
export type Side = 'top' | 'bottom' | 'left' | 'right';

export interface PortDef {
  id: string;
  label: string;
  type: PortType;
  side?: Side;
  doc: string;
  /** Input only. Optional inputs never block evaluation when they have no signal. */
  optional?: boolean;
  /** Input only. Set on a "setting pin": the key of the parameter this pin overrides while it carries a signal. */
  param?: string;
}

export interface SelectOption {
  value: string;
  label: string;
}

interface ParamBase {
  key: string;
  label: string;
  doc: string;
  hidden?: boolean;
  /** Set to false for parameters that must not get a setting pin (e.g. ones that change the pin set itself). */
  pin?: false;
}
export type ParamDef =
  | (ParamBase & { kind: 'number'; min: number; max: number; step: number; default: number; unit?: string })
  | (ParamBase & { kind: 'select'; options: SelectOption[]; default: string })
  | (ParamBase & { kind: 'text'; default: string; multiline?: boolean; maxLength?: number; placeholder?: string; /** Autocomplete suggestions offered by the inspector. The value is still free text. */ suggest?: () => string[] })
  | (ParamBase & { kind: 'bool'; default: boolean })
  | (ParamBase & { kind: 'action'; command: string });

export type Params = Record<string, unknown>;

export interface ImageSig {
  w: number;
  h: number;
  data: Uint8ClampedArray; // RGBA
}

/** A value travelling on a connection. `s` is signal strength (0..1+), `t` the simulation time of emission. */
export interface Signal {
  v: unknown;
  s: number;
  t: number;
}

export interface NodeInst {
  id: string;
  type: string;
  x: number;
  y: number;
  params: Params;
  disabled?: boolean;
}

export interface Edge {
  id: string;
  from: string;
  fromPort: string;
  to: string;
  toPort: string;
  /** Strength multiplier applied to every signal on this connection. */
  weight: number;
  /** Propagation latency in simulation milliseconds. */
  delay: number;
  enabled: boolean;
}

export interface Graph {
  nodes: Record<string, NodeInst>;
  edges: Record<string, Edge>;
}

export interface CompoundPort {
  id: string;
  label: string;
  type: PortType;
  nodeId: string;
  port: string;
}
export interface ExposedParam {
  key: string;
  label: string;
  nodeId: string;
  param: string;
}
export interface CompoundDef {
  id: string;
  name: string;
  description: string;
  graph: Graph;
  inputs: CompoundPort[];
  outputs: CompoundPort[];
  exposed: ExposedParam[];
}

export interface Project {
  format: 'neural-studio';
  version: 1;
  id: string;
  name: string;
  description: string;
  author: string;
  created: number;
  modified: number;
  graph: Graph;
  compounds: Record<string, CompoundDef>;
  view?: { x: number; y: number; k: number };
}

export type Diagnostic = {
  level: 'error' | 'warn' | 'info';
  nodeId?: string;
  message: string;
};

export type NodeSize = 'chip' | 'small' | 'square' | 'tall' | 'wide';
export const SIZES: Record<NodeSize, { w: number; h: number }> = {
  chip: { w: 144, h: 36 },
  small: { w: 144, h: 84 },
  square: { w: 144, h: 132 },
  tall: { w: 144, h: 180 },
  wide: { w: 300, h: 132 },
};
export const GRID = 12;

export type Family =
  | 'sensor'
  | 'sense'
  | 'knowledge'
  | 'attention'
  | 'fear'
  | 'memory'
  | 'apparatus'
  | 'emotion'
  | 'behavior'
  | 'projector'
  | 'node'
  | 'info';

export type Category = 'Sensor' | 'Nucleus' | 'Behavior' | 'Node' | 'Info';

export interface ModuleDoc {
  summary: string;
  runtime: string;
  errors?: string[];
  examples?: string[];
}

export interface Ctx {
  readonly time: number;
  /** ms since this node last ran. */
  readonly dt: number;
  readonly tickMs: number;
  readonly reason: 'init' | 'input' | 'wake' | 'inject' | 'command';
  readonly params: Params;
  readonly state: Record<string, any>;
  readonly injected: Record<string, unknown> | undefined;
  readonly command: string | undefined;
  /** Aggregate strength of the present inputs (max), 1 when none. */
  readonly strength: number;
  get(port: string): any;
  sig(port: string): Signal | undefined;
  has(port: string): boolean;
  changed(port: string): boolean;
  num(key: string): number;
  str(key: string): string;
  bool(key: string): boolean;
  emit(port: string, value: unknown, strength?: number, event?: boolean): void;
  emitLater(port: string, value: unknown, ms: number, strength?: number): void;
  wake(ms: number): void;
  rand(): number;
  view(v: Record<string, unknown>): void;
  warn(msg: string): void;
  fail(msg: string): void;
}

export interface ModuleDef {
  type: string;
  name: string;
  caption: string;
  category: Category;
  family: Family;
  glyph: string;
  size: NodeSize;
  /** Short title shown on the node. Defaults to name. */
  title?: (p: Params) => string;
  chip?: (p: Params) => string;
  inputs: PortDef[];
  outputs: PortDef[];
  params: ParamDef[];
  dynamicParams?: (p: Params) => ParamDef[];
  /** Module holds state or time: feedback loops through it are legal. */
  delaying?: boolean;
  /** Evaluate once on start even without input (sources/constants). */
  source?: boolean;
  run: (c: Ctx) => void;
  doc: ModuleDoc;
  /** Sensor source needing browser permission/hardware. */
  keywords?: string;
  /** Derived (registry): rendered size when setting pins make the node larger than its `size` preset. */
  dim?: { w: number; h: number };
  /** Derived (registry): the setting pins appended to `inputs`. */
  paramPins?: PortDef[];
}

export interface FlatEdge extends Edge {
  orig: string;
  deferred?: boolean;
  blocked?: boolean;
}
export interface FlatGraph {
  nodes: Record<string, NodeInst>;
  edges: FlatEdge[];
  diagnostics: Diagnostic[];
}
