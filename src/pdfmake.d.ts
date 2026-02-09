declare module 'pdfmake' {
	interface PdfMakeInstance {
		virtualfs: { writeFileSync: (path: string, data: Uint8Array) => void };
		setFonts: (fonts: Record<string, { normal?: string; bold?: string; italics?: string; bolditalics?: string }>) => void;
		createPdf: (docDefinition: unknown) => { getBuffer: () => Promise<Buffer> };
	}
	const pdfmake: PdfMakeInstance;
	export default pdfmake;
}
