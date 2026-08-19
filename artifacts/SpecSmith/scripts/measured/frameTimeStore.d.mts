// Types for the node-side frame-time blob store.
//
// frameTimeStore.mjs stays plain JavaScript because it is node-only tooling
// with its own passing tests; this declares its surface so the TypeScript
// collector can import it without an implicit `any` crossing that boundary.

import type { FrameTimeRef } from '../../src/lib/measured/types';

export function canonicalFrameTimeBytes(frameTimesMs: readonly number[]): string;
export function sha256Hex(input: string): string;
export function frameTimeRoot(): string;
export function writeFrameTimes(frameTimesMs: readonly number[]): Promise<FrameTimeRef>;
export function readFrameTimes(ref: FrameTimeRef): Promise<number[]>;
