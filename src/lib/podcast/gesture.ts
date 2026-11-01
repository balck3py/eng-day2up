/** Selection gestures must never become a synthesized subtitle click. */
export class SubtitleGesture {
  private started = 0
  private x = 0
  private y = 0
  private blocked = false
  private active = false
  start(x: number, y: number, hasSelection: boolean) {
    this.started = Date.now(); this.x = x; this.y = y
    this.blocked = hasSelection; this.active = true
  }
  move(x: number, y: number) {
    if (this.active && Math.hypot(x - this.x, y - this.y) > 8) this.blocked = true
  }
  block() { this.blocked = true }
  allowClick(hasSelection: boolean) {
    const allowed = this.active && !this.blocked && !hasSelection && Date.now() - this.started < 450
    this.active = false
    return allowed
  }
}
