import fs from 'node:fs/promises';
const core=(await fs.readFile('src/domain.js','utf8')).replace(/^export /gm,'');
const backend=await fs.readFile('apps-script/backend.template.js','utf8');
const wms=await fs.readFile('apps-script/wms.template.js','utf8');
await fs.writeFile('apps-script/Code.gs','// Generado por npm run build:apps-script. No pegar secretos aquí.\n'+core+'\n'+backend+'\n'+wms);
console.log('apps-script/Code.gs preparado');
