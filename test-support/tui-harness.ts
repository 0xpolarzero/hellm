import { renderTuiFrame, type TuiProjection } from "@hellm/tui";

export class VirtualTerminalHarness {
  private frame: string[] = [];

  constructor(public width = 80, public height = 24) {}

  render(projection: TuiProjection): string[] {
    this.frame = renderTuiFrame(projection, {
      width: this.width,
      height: this.height,
    });
    return this.frame;
  }

  resize(width: number, height: number): void {
    this.width = width;
    this.height = height;
  }

  viewport(): string[] {
    return [...this.frame];
  }

  snapshot(): string {
    return this.frame.join("\n");
  }
}
