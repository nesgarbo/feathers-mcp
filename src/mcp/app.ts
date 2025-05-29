import type { Application as KoaApplication } from '@feathersjs/koa'

import type { Application as ExpressApplication } from '@feathersjs/express'
export type McpApplication = KoaApplication | ExpressApplication;

export function isKoaApp(app: any): app is KoaApplication {
  return 'context' in app;
}