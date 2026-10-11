export interface Ocr {
  read(pagePicture: string): Promise<string>
}
