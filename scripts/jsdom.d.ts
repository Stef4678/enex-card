/**
 * Minimal ambient types for jsdom (used only by the Node smoke test).
 */
declare module "jsdom" {
  export class JSDOM {
    constructor(html?: string, options?: unknown);
    window: any;
  }
}
