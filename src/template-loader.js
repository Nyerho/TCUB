import templateModule from './templates.generated.js';

export const templates = templateModule.templates || templateModule.default?.templates || templateModule.default || templateModule;
