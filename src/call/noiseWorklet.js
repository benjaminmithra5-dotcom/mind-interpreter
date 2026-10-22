// RNNoise (open-source noise suppression, compiled to WebAssembly) in an
// AudioWorklet, from @sapphi-red/web-noise-suppressor (MIT). This module and
// its files are only downloaded when a Talk now page asks for them.
import { RnnoiseWorkletNode, loadRnnoise } from "@sapphi-red/web-noise-suppressor";
import workletUrl from "@sapphi-red/web-noise-suppressor/rnnoiseWorklet.js?url";
// The package ships two identical builds; one file serves both.
import wasmUrl from "@sapphi-red/web-noise-suppressor/rnnoise.wasm?url";

let wasm = null;

/** Adds the RNNoise processor to an AudioContext and returns a node. */
export async function createRnnoiseNode(ctx) {
  if (!wasm) wasm = await loadRnnoise({ url: wasmUrl, simdUrl: wasmUrl });
  await ctx.audioWorklet.addModule(workletUrl);
  return new RnnoiseWorkletNode(ctx, { maxChannels: 1, wasmBinary: wasm });
}
