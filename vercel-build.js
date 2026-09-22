import { cp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';

const outputDirectory = '.vercel-static';

await rm(outputDirectory, { recursive: true, force: true });
await mkdir(outputDirectory, { recursive: true });
await cp('dist', `${outputDirectory}/dist`, { recursive: true });
await writeFile(`${outputDirectory}/index.html`, await readFile('index.html'));
