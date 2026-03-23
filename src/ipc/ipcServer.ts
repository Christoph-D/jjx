// Adapted from
// https://github.com/microsoft/vscode/blob/551308fdbca0849eb9f215eec5428f719fac1193/extensions/git/src/ipc/ipcServer.ts

import { Disposable } from "vscode";
import { toDisposable } from "../utils";
import { logger } from "../logger";
import * as path from "path";
import * as http from "http";
import * as os from "os";
import * as fs from "fs";
import * as crypto from "crypto";

function getIPCHandlePath(id: string): string {
  if (process.platform === "win32") {
    return `\\\\.\\pipe\\vscode-jj-${id}-sock`;
  }

  if (process.platform !== "darwin") {
    const xdgRuntimeDir = process.env["XDG_RUNTIME_DIR"];
    if (xdgRuntimeDir) {
      return path.join(xdgRuntimeDir, `vscode-jj-${id}.sock`);
    }
  }

  return path.join(os.tmpdir(), `vscode-jj-${id}.sock`);
}

export interface IIPCHandler {
  handle(request: unknown): Promise<unknown>;
}

export async function createIPCServer(context?: string): Promise<IPCServer> {
  const server = http.createServer();
  const hash = crypto.createHash("sha256");

  if (!context) {
    const buffer = await new Promise<Buffer>((c, e) => crypto.randomBytes(20, (err, buf) => (err ? e(err) : c(buf))));
    hash.update(buffer);
  } else {
    hash.update(context);
  }

  const ipcHandlePath = getIPCHandlePath(hash.digest("hex").substring(0, 10));

  if (process.platform !== "win32") {
    try {
      await fs.promises.unlink(ipcHandlePath);
    } catch {
      // noop
    }
  }

  return new Promise((c, e) => {
    try {
      server.on("error", (err) => e(err));
      server.listen(ipcHandlePath);
      c(new IPCServer(server, ipcHandlePath));
    } catch (err) {
      e(err);
    }
  });
}

export interface IIPCServer extends Disposable {
  readonly ipcHandlePath: string;
  registerHandler(name: string, handler: IIPCHandler): Disposable;
}

export class IPCServer implements IIPCServer, Disposable {
  private handlers = new Map<string, IIPCHandler>();
  get ipcHandlePath(): string {
    return this._ipcHandlePath;
  }

  constructor(
    private server: http.Server,
    private _ipcHandlePath: string,
  ) {
    this.server.on("request", this.onRequest.bind(this));
  }

  registerHandler(name: string, handler: IIPCHandler): Disposable {
    this.handlers.set(`/${name}`, handler);
    return toDisposable(() => this.handlers.delete(name));
  }

  private onRequest(req: http.IncomingMessage, res: http.ServerResponse): void {
    if (!req.url) {
      logger.warn(`Request lacks url`);
      return;
    }

    const handler = this.handlers.get(req.url);

    if (!handler) {
      logger.warn(
        `IPC handler for ${req.url} not found. Available handlers: ${Array.from(this.handlers.keys()).join(", ")}`,
      );
      return;
    }

    const chunks: Buffer[] = [];
    req.on("data", (d: Buffer) => chunks.push(d));
    req.on("end", () => {
      const request: unknown = JSON.parse(Buffer.concat(chunks).toString("utf8"));
      handler.handle(request).then(
        (result) => {
          res.writeHead(200);
          res.end(JSON.stringify(result));
        },
        (err) => {
          logger.error(`IPC handler error: ${err}`);
          res.writeHead(500);
          res.end();
        },
      );
    });
  }

  dispose(): void {
    this.handlers.clear();
    this.server.close();

    if (this._ipcHandlePath && process.platform !== "win32") {
      fs.unlinkSync(this._ipcHandlePath);
    }
  }
}
