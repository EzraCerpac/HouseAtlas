// Vite asset queries used by the SYNTHETIC visual fixture only.
declare module '*?raw' {
  const text: string;
  export default text;
}
declare module '*?url&inline' {
  const dataUrl: string;
  export default dataUrl;
}
