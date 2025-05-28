import { FeathersKoaContext } from './declarations';
export declare const errorHandler: () => (ctx: FeathersKoaContext, next: () => Promise<any>) => Promise<void>;
