import type { Hono } from 'hono';
import {
  onRequestPost as probeDeletePost,
  type ResilienceProbeEnv
} from '../functions/api/resilience/probe-delete';
import type { KVNamespace } from './kvAdapter';
import { createBaseLabApp, verifyRouterSecret, type BaseCloudRunEnv } from './runtime';

export { verifyRouterSecret };

export interface CloudRunEnv extends ResilienceProbeEnv, BaseCloudRunEnv {}

export function createCloudRunApp(options?: {
  env?: CloudRunEnv;
  kv?: KVNamespace;
}): Hono {
  return createBaseLabApp<CloudRunEnv>({
    labSlug: 'resilience-tabletop',
    env: options?.env,
    kv: options?.kv,
    registerRoutes: (app, wrap) => {
      // Note: Lab 9 route exception — lab-router maps /api/resilience/* (not /api/resilience-tabletop/*)
      app.post('/api/resilience/probe-delete', wrap(probeDeletePost));
    }
  });
}
