/** Cache satu snapshot, menggabungkan request serentak dan menolak hasil lama setelah invalidasi. */
export class VersionedCache<T extends { version: string }> {
  private value?: T
  private flight?: Promise<T>
  private checking?: Promise<T>
  private generation = 0
  constructor(private load: () => Promise<T>, private version: () => Promise<string>) {}
  clear() { this.generation++; this.value = undefined; this.flight = undefined; this.checking = undefined }
  get(): Promise<T> {
    if (this.value) return Promise.resolve(this.value)
    if (this.flight) return this.flight
    const generation = this.generation
    const flight = this.load().then(value => {
      if (generation !== this.generation) return this.get()
      this.value = value
      return value
    }).finally(() => { if (this.flight === flight) this.flight = undefined })
    this.flight = flight
    return flight
  }
  check(): Promise<T> {
    if (!this.value) return this.get()
    if (this.checking) return this.checking
    const generation = this.generation
    const checking = this.version().then(version => {
      if (generation === this.generation && version !== this.value?.version) this.clear()
      return this.get()
    }).finally(() => { if (this.checking === checking) this.checking = undefined })
    this.checking = checking
    return checking
  }
}
