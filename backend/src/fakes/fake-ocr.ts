import type { Ocr } from '../ports/ocr.ts'

export class FakeOcr implements Ocr {
  textByPage = new Map<string, string>()
  pages: string[] = []
  async read(pagePicture: string): Promise<string> {
    this.pages.push(pagePicture)
    return this.textByPage.get(pagePicture) ?? ''
  }
}
