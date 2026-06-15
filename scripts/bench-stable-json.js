#!/usr/bin/env node
import { performance } from 'node:perf_hooks';
import { stableStringify } from '../dist/index.js';

const sample = Array.from({ length: 120 }, (_, index) => ({
  id: `item_${index}`,
  profile: {
    displayName: `User ${index}`,
    flags: { beta: index % 2 === 0, admin: index % 17 === 0 },
    scores: [index, index * 2, index * 3],
  },
  tags: ['json', 'stable', String(index % 5)],
}));

const iterations = 2_000;
const fastMs = measure(() => stableStringify(sample));
const richMs = measure(() => stableStringify(sample, { replacer: (_key, value) => value }));
const ratio = richMs === 0 ? Number.POSITIVE_INFINITY : fastMs / richMs;

console.log(JSON.stringify({
  iterations,
  fastMs: Number(fastMs.toFixed(2)),
  richMs: Number(richMs.toFixed(2)),
  ratio: Number(ratio.toFixed(2)),
}, null, 2));

function measure(run) {
  const start = performance.now();
  for (let index = 0; index < iterations; index += 1) {
    run();
  }
  return performance.now() - start;
}
