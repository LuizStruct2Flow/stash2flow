import type { Clock } from '../ports/clock.ts'

export class FakeClock implements Clock {
  value = '2026-01-01T00:00:00.000Z'
  now(): string {
    return this.value
  }
}
