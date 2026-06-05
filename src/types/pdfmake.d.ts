declare module "pdfmake" {
  type PdfMakeDocument = {
    getBuffer: () => Promise<Buffer>;
  };

  type PdfMakeInstance = {
    createPdf: (definition: unknown) => PdfMakeDocument;
    addFonts: (fonts: unknown) => void;
    setLocalAccessPolicy: (callback: (filePath: string) => boolean) => void;
    setUrlAccessPolicy: (callback: (url: URL) => boolean) => void;
  };

  const pdfMake: PdfMakeInstance;
  export default pdfMake;
}
