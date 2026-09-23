declare module 'private:initial-csv' {
  const gzipBase64: string;
  export default gzipBase64;
}
declare module 'private:season-csv' {
  const seasons: Record<string, string[]>;
  export default seasons;
}
