import { PROTOCOL_VERSION, type ClientMsg, type ServerMsg } from './protocol';

type Handler = (msg: ServerMsg) => void;

/** Thin WebSocket wrapper: JSON messages, one message handler, latency probe. */
export class NetClient {
  private ws: WebSocket;
  private handler: Handler | null = null;
  private pingTimer: ReturnType<typeof setInterval> | null = null;
  /** player id assigned by the server */
  you = 0;
  code = '';
  /** round-trip time in ms (smoothed) */
  rtt = 0;
  onClose: ((reason: string) => void) | null = null;
  private closedByUs = false;

  private constructor(ws: WebSocket) {
    this.ws = ws;
    ws.onmessage = (ev) => {
      let msg: ServerMsg;
      try {
        msg = JSON.parse(ev.data as string);
      } catch {
        return;
      }
      if (msg.t === 'pong') {
        const sample = performance.now() - msg.c;
        this.rtt = this.rtt ? this.rtt * 0.8 + sample * 0.2 : sample;
        return;
      }
      if (msg.t === 'welcome') {
        this.you = msg.you;
        this.code = msg.code;
      }
      this.handler?.(msg);
    };
    ws.onclose = () => {
      if (this.pingTimer) clearInterval(this.pingTimer);
      if (!this.closedByUs) this.onClose?.('Connection to the server was lost.');
    };
    this.pingTimer = setInterval(() => this.send({ t: 'ping', c: performance.now() }), 2000);
  }

  static connect(url: string): Promise<NetClient> {
    return new Promise((resolve, reject) => {
      let ws: WebSocket;
      try {
        ws = new WebSocket(url);
      } catch {
        reject(new Error('Invalid server address.'));
        return;
      }
      const timeout = setTimeout(() => {
        ws.close();
        reject(new Error('Server did not answer (timeout).'));
      }, 6000);
      ws.onopen = () => {
        clearTimeout(timeout);
        resolve(new NetClient(ws));
      };
      ws.onerror = () => {
        clearTimeout(timeout);
        reject(new Error('Could not connect to the server.'));
      };
    });
  }

  setHandler(h: Handler | null): void {
    this.handler = h;
  }

  send(msg: ClientMsg): void {
    if (this.ws.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify(msg));
  }

  create(name: string): void {
    this.send({ t: 'create', v: PROTOCOL_VERSION, name });
  }

  join(code: string, name: string): void {
    this.send({ t: 'join', v: PROTOCOL_VERSION, name, code: code.toUpperCase() });
  }

  close(): void {
    this.closedByUs = true;
    if (this.pingTimer) clearInterval(this.pingTimer);
    this.ws.close();
  }
}
