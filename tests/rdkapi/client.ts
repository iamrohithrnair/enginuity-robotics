// Provides a TCP test client for API handshakes, wire messages, items, and statuses.
import net from "node:net";
import { WireReader, WireWriter } from "@/server/rdkapi/codec";

export class TestClient {
  readonly r = new WireReader();
  private constructor(readonly sock: net.Socket) {
    sock.on("data", (d: Buffer) => this.r.push(d));
    sock.on("close", () => this.r.close());
    sock.on("error", (e) => this.r.close(e));
  }

  static connect(port: number): Promise<TestClient> {
    return new Promise((resolve, reject) => {
      const sock = net.connect(port, "127.0.0.1", () => resolve(new TestClient(sock)));
      sock.once("error", reject);
    });
  }

  send(build: (w: WireWriter) => void) {
    const w = new WireWriter();
    build(w);
    this.sock.write(w.toBuffer());
  }

   
  async handshake(flags = [1, 0, 0]): Promise<[string, number, number, number]> {
    this.send((w) => w.line("RDK_API").array(flags));
    return [await this.r.line(), await this.r.int(), await this.r.int(), await this.r.int()];
  }

  async status(): Promise<{ code: number; msg?: string }> {
    const code = await this.r.int();
    if (code === 2 || code === 3 || (code >= 10 && code < 100)) return { code, msg: await this.r.line() };
    return { code };
  }

  async item(): Promise<{ handle: number; type: number }> {
    const handle = await this.r.handle();
    const type = await this.r.int();
    return { handle, type };
  }

   
  async itemCmd(name: string, build: (w: WireWriter) => void) {
    this.send((w) => {
      w.line(name);
      build(w);
    });
    const it = await this.item();
    const st = await this.status();
    return { ...it, status: st.code };
  }

  close() {
    this.sock.destroy();
  }
}

export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
