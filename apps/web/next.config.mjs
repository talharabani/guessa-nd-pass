import { PHASE_DEVELOPMENT_SERVER } from 'next/constants.js';

/**
 * @param {string} phase
 * @returns {import('next').NextConfig}
 */
export default function config(phase) {
  const dev = phase === PHASE_DEVELOPMENT_SERVER;

  return {
    reactStrictMode: true,
    eslint: { ignoreDuringBuilds: true },

    experimental: {
      /*
       * Dev only, and deliberately not applied to `next build`.
       *
       * Rendering a dynamic route (/lobby/[code], /game/[code]) makes the dev
       * server fork a jest-worker child to work out its static paths. On a
       * machine that refuses child-process creation from that process, the fork
       * fails and every such route 500s with `spawn EPERM`. Turning worker
       * threads on makes jest-worker use worker_threads instead, so nothing is
       * spawned and the routes render.
       *
       * The build cannot use it: `next build` passes functions to its workers,
       * and functions cannot be structured-cloned across a thread boundary
       * (DataCloneError). Leaving the build on stock behaviour also keeps CI
       * identical to plain Next.
       */
      workerThreads: dev,
      webpackBuildWorker: false
    }
  };
}
