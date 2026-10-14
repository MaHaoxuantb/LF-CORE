import {parseProject} from './project.js';
import {searchWorkspaceSources} from './source-index.js';
import {getSourceTextIndex} from './source-store.js';
export async function runCompute(job) {
 if (job.type === 'import') return parseProject(await job.file.text());
 if (job.type === 'search') return searchWorkspaceSources(job.workspace, job.query, {...job.options, ensurePdfIndex: source => getSourceTextIndex(source.id)});
 throw new Error('Unsupported background computation.');
}
