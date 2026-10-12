declare module "*.css";
declare module "pdfjs-dist/build/pdf.worker.min.mjs?url" {
  const url: string;
  export default url;
}
declare module "virtual:houseatlas-pdfjs-resources" {
  export const pdfjsDecoderUrl: string;
  export class HouseAtlasPdfBinaryDataFactory {
    fetch(options: { kind: string; filename: string }): Promise<Uint8Array>;
  }
}
