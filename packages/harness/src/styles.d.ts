declare module 'harness:input-style' {
  const classes: Record<string, string>;
  export default classes;
}

declare module 'virtual:harness-theme.css';
declare module '*.css';

declare module 'pdfjs-dist/build/pdf.worker.mjs' {
  export const WorkerMessageHandler: unknown;
}
