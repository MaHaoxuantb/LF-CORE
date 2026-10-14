export function projectExportBytes(defaultName, contents) {
  if (typeof defaultName !== 'string' || !(contents instanceof ArrayBuffer)) throw new TypeError('Project exports require a filename and an ArrayBuffer.');
  return Buffer.from(contents);
}
