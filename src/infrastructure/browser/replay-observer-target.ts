import { EventEmitter } from 'node:events';
import type { ObserverTarget } from './observer-target.js';

// Synthetic/replay driver. It never opens a browser, logs a body or assigns capture mode.
export class ReplayObserverTarget implements ObserverTarget {
  private events = new EventEmitter();
  private attached = false;
  private destroyed = false;
  private toolsOpened = false;
  private bodies = new Map<string, unknown | Promise<unknown>>();
  readonly commands: { method: string; requestId?: string }[] = [];
  enableResult: unknown | Promise<unknown> = {};
  constructor(readonly id: number) {}
  isDestroyed() { return this.destroyed; }
  debuggerAttached() { return this.attached; }
  devToolsOpened() { return this.toolsOpened; }
  attachDebugger() { if (this.attached || this.destroyed) throw new Error('ATTACH_UNAVAILABLE'); this.attached = true; }
  detachDebugger() { this.attached = false; this.events.emit('detach'); }
  async command(method: string, params: Record<string, unknown>) {
    if (!this.attached) throw new Error('NO_DEBUGGER');
    const id = typeof params.requestId === 'string' ? params.requestId : undefined;
    if (this.commands.length < 1024) this.commands.push({ method, ...(id ? { requestId: id } : {}) });
    if (method === 'Network.enable') return this.enableResult;
    if (!id || !this.bodies.has(id)) throw new Error('BODY_NOT_IN_REPLAY');
    return await this.bodies.get(id);
  }
  setBody(id: string, body: unknown | Promise<unknown>) { this.bodies.set(id, body); }
  emitMessage(method: string, params: unknown, child = false) { this.events.emit('message', method, params, child); }
  navigate() { this.events.emit('navigation'); }
  openDevTools() { this.toolsOpened = true; this.events.emit('tools'); }
  closeDevTools() { this.toolsOpened = false; }
  externalDetach() { this.attached = false; this.events.emit('detach'); }
  destroy() { this.destroyed = true; this.events.emit('destroyed'); this.attached = false; }
  listenerCount() { return this.events.eventNames().reduce((sum, name) => sum + this.events.listenerCount(name), 0); }
  private bind(name: string, listener: (...args: any[]) => void) { this.events.on(name, listener); return () => { this.events.removeListener(name, listener); }; }
  onMessage(callback: (method: string, params: unknown, child: boolean) => void) { return this.bind('message', callback); }
  onDetach(callback: () => void) { return this.bind('detach', callback); }
  onDestroyed(callback: () => void) { return this.bind('destroyed', callback); }
  onNavigation(callback: () => void) { return this.bind('navigation', callback); }
  onDevTools(callback: () => void) { return this.bind('tools', callback); }
}
