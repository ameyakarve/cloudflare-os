import { RpcTarget } from 'cloudflare:workers';
import { validateRpc } from 'capnweb-validate';
import type { DeploymentSpecialists, SpecialistProfile } from '@gadgets/workshop-shared/specialists';

const name = /^[A-Za-z][A-Za-z0-9_]{0,63}$/;
const id = /^[a-zA-Z0-9][a-zA-Z0-9_-]{0,63}$/;
const forbidden = new Set(['constructor', 'prototype', '__proto__', 'then', 'dup', 'fetch',
  'connect', 'getSession', 'getAgentCatalog', 'spawn', 'spawnCallable', 'restore']);

/** Parse trusted optional deployment JSON once per turn; malformed configuration fails closed. */
export function parseSpecialists(raw?: string, env: object = {}): DeploymentSpecialists {
  if (raw?.startsWith('@chunks:')) {
    if (!/^@chunks:([1-9]|1[0-6])$/.test(raw)) throw new Error('Invalid specialist chunk count');
    const count = Number(raw.slice(8));
    for (const key of Object.keys(env)) {
      if (key.startsWith('DEPLOYMENT_SPECIALISTS_') &&
          !Array.from({length: count}, (_, i) => `DEPLOYMENT_SPECIALISTS_${i}`).includes(key)) {
        throw new Error('Invalid specialist chunk index');
      }
    }
    const chunks: string[] = [];
    for (let i = 0; i < count; i++) {
      const chunk = Object.getOwnPropertyDescriptor(env, `DEPLOYMENT_SPECIALISTS_${i}`)?.value;
      if (typeof chunk !== 'string' || !chunk || new TextEncoder().encode(chunk).length > 4000) {
        throw new Error('Missing or oversized specialist chunk');
      }
      chunks.push(chunk);
    }
    raw = chunks.join('');
  }
  if (raw === undefined || raw === '') return {version: 1, profiles: []};
  if (raw.length > 100_000) throw new Error('Specialist configuration too large');
  const value = JSON.parse(raw);
  if (value?.version !== 1 || !Array.isArray(value.profiles) || value.profiles.length > 8) {
    throw new Error('Invalid specialist configuration');
  }
  const ids = new Set<string>();
  for (const p of value.profiles) {
    if (!p || typeof p.id !== 'string' || !id.test(p.id) || ids.has(p.id) ||
        typeof p.name !== 'string' || !p.name || p.name.length > 120 ||
        typeof p.instructions !== 'string' || !p.instructions || p.instructions.length > 24_000 ||
        !Number.isInteger(p.maxTurns) || p.maxTurns < 1 || p.maxTurns > 12 ||
        !Array.isArray(p.intents) || !p.intents.length || p.intents.length > 16) {
      throw new Error('Invalid specialist profile');
    }
    ids.add(p.id);
    const intents = new Set<string>();
    for (const intent of p.intents) {
      if (!intent || typeof intent.id !== 'string' || !id.test(intent.id) || intents.has(intent.id) ||
          typeof intent.description !== 'string' || !intent.description || intent.description.length > 2000 ||
          !intent.bindings || Array.isArray(intent.bindings) || typeof intent.bindings !== 'object' ||
          Object.keys(intent.bindings).length > 8) throw new Error('Invalid specialist intent');
      intents.add(intent.id);
      for (const [binding, methods] of Object.entries(intent.bindings)) {
        if (!name.test(binding) || forbidden.has(binding) || !Array.isArray(methods) ||
            !methods.length || methods.length > 16 || new Set(methods).size !== methods.length ||
            methods.some(m => typeof m !== 'string' || !name.test(m) || forbidden.has(m))) {
          throw new Error('Invalid specialist capability');
        }
      }
    }
  }
  return value as DeploymentSpecialists;
}

/** Bounded data-only RPC values. Reject capabilities, accessors, cycles, and non-JSON classes. */
export function specialistData(value: unknown): unknown {
  let nodes = 0;
  const visit = (v: unknown, depth: number): unknown => {
    if (++nodes > 10_000 || depth > 24) throw new Error('Specialist data too complex');
    if (v === null || typeof v === 'boolean' || typeof v === 'string') return v;
    if (typeof v === 'number' && Number.isFinite(v)) return v;
    if (v === undefined) return null;
    if (typeof v !== 'object') throw new Error('Specialist methods must return data, not capabilities');
    const proto = Object.getPrototypeOf(v);
    if (Array.isArray(v)) {
      if (proto !== Array.prototype || v.length > 10_000) throw new Error('Specialist array too complex');
      const descriptors = Object.getOwnPropertyDescriptors(v);
      if (Object.keys(descriptors).some(key => key !== 'length' &&
          (!/^(0|[1-9][0-9]*)$/.test(key) || Number(key) >= v.length))) {
        throw new Error('Invalid specialist array property');
      }
      const result: unknown[] = [];
      for (let index = 0; index < v.length; index++) {
        const descriptor = descriptors[String(index)];
        if (descriptor && !('value' in descriptor)) throw new Error('Invalid specialist array accessor');
        result.push(visit(descriptor?.value, depth + 1));
      }
      return result;
    }
    if (proto !== Object.prototype && proto !== null) throw new Error('Specialist methods must return plain data');
    const result: Record<string, unknown> = {};
    for (const [key, desc] of Object.entries(Object.getOwnPropertyDescriptors(v))) {
      if (!('value' in desc) || key === '__proto__') throw new Error('Invalid specialist data property');
      Object.defineProperty(result, key, {value: visit(desc.value, depth + 1), enumerable: true});
    }
    return result;
  };
  const result = visit(value, 0);
  if (JSON.stringify(result).length > 32_768) throw new Error('Specialist data too large; request a bounded projection');
  return result;
}

/** Race the entire operation, including lazy Worker startup, against inherited cancellation. */
export async function specialistOperation<T>(signal: AbortSignal, operation: () => Promise<T>): Promise<T> {
  signal.throwIfAborted();
  let onAbort: () => void = () => {};
  const cancelled = new Promise<never>((_resolve, reject) => {
    onAbort = () => reject(signal.reason);
    signal.addEventListener('abort', onAbort, {once: true});
  });
  try { return await Promise.race([operation(), cancelled]); }
  finally { signal.removeEventListener('abort', onAbort); }
}

/** RPC membrane: its private callback never crosses RPC; every call rechecks authority/liveness. */
@validateRpc()
export class SpecialistDispatcher extends RpcTarget {
  #dispatch: (binding: string, method: string, args: unknown[], assertLive: () => void) => Promise<unknown>;
  #allowed: Record<string, string[]>;
  #signal: AbortSignal;
  #closed = false;
  #calls = 0;
  #busy = false;
  constructor(allowed: Record<string, string[]>, signal: AbortSignal,
      dispatch: (binding: string, method: string, args: unknown[], assertLive: () => void) => Promise<unknown>) {
    super(); this.#allowed = allowed; this.#signal = signal; this.#dispatch = dispatch;
  }
  /** Sole RPC entry point. Even a stolen dispatcher can call only its frozen intent methods. */
  async invoke(binding: string, method: string, args: unknown[]): Promise<unknown> {
    this.#signal.throwIfAborted();
    if (this.#closed || this.#busy || ++this.#calls > 32 ||
        !Object.hasOwn(this.#allowed, binding) || !this.#allowed[binding].includes(method)) {
      throw new Error('Specialist capability denied');
    }
    specialistData(args);
    this.#busy = true;
    try {
      const assertLive = () => {
        this.#signal.throwIfAborted();
        if (this.#closed) throw new Error('Specialist capability denied: execution ended');
      };
      const result = await this.#dispatch(binding, method, args, assertLive);
      assertLive();
      return specialistData(result);
    } finally { this.#busy = false; }
  }
  /** Revokes retained stubs when the code execution ends. */
  [Symbol.dispose]() { this.#closed = true; }
}

/** In-process coordinator tools, never exported as a capability to child code. */
export interface SpecialistTools {
  profiles: SpecialistProfile[];
  /** Validate before SDK schema validation, without allocating work or authority. */
  validateSelection(profileId: unknown, intentId: unknown): {profileId: string; intentId: string};
  /** Two invalid selections end the originating run, including after a resume. */
  readonly selectionExhausted: boolean;
  delegate(profileId: string, intentId: string, task: string,
    bindings: Record<string, import('./agent').ChatBindingEntry>): Promise<string>;
  list(before?: string): string;
  read(id: string): string;
}
