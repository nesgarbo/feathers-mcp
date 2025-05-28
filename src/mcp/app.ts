import type { Application as KoaApplication } from '@feathersjs/koa'

import type { Application as ExpressApplication } from '@feathersjs/express'
export type McpApplication = KoaApplication | ExpressApplication;

export function isKoaApplication(app: McpApplication): app is KoaApplication {
  return typeof (app as any).callback === 'function' && Array.isArray((app as any).middleware);
}