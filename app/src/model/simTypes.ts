/** Simulation shapes shared with the Rust backend (serde JSON). */

export type SignalKind = "voltage" | "current";

export interface UiAxis {
  label: string;
  unit: string;
  values: number[];
  log: boolean;
}

export interface UiSignal {
  /** ngspice vector name, lower case: "n3", "v1#branch", "v.xam1.vsense#branch". */
  id: string;
  kind: SignalKind;
  /** Real values; for AC, magnitude in dB. */
  values: number[];
  /** AC only: phase in degrees. */
  phase?: number[];
}

export interface PinNet {
  uid: string;
  pin: string;
  net: string;
}

export interface NetsData {
  pinNet: PinNet[];
  netPins: Record<string, { uid: string; pin: string }[]>;
  wireNet: Record<string, string>;
}

export interface UiResult {
  analysis: "op" | "tran" | "ac" | "dc";
  x: UiAxis | null;
  signals: UiSignal[];
  nets: NetsData;
}

export type ErrorCode =
  | "unknown_part" | "no_ground" | "unconnected_pin" | "invalid_param" | "template" | "model_file"
  | "bad_analysis" | "invalid_reference" | "duplicate_reference" | "ref_prefix_mismatch" | "invalid_rotation";

export interface NetlistError {
  code: ErrorCode;
  message: string;
  componentUid: string | null;
  pin?: string;
}

export type SimOutcome =
  | { status: "ok"; result: UiResult; elapsedMs: number }
  | { status: "netlist"; errors: NetlistError[] }
  | { status: "engine"; message: string; log: string[] }
  | { status: "stopped" }
  | { status: "timeout"; seconds: number }
  | { status: "busy" };

/** The ground net name. */
export const GROUND_NET = "0";
