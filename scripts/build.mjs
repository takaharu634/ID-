import fs from 'node:fs/promises';
await fs.rm('dist',{recursive:true,force:true});
await fs.mkdir('dist/vendor',{recursive:true});
await fs.cp('public','dist',{recursive:true});
await fs.cp('src','dist',{recursive:true});
for(const name of ['three.module.js','three.core.js']) await fs.copyFile(`node_modules/three/build/${name}`,`dist/vendor/${name}`);
await fs.copyFile('node_modules/three/LICENSE','dist/vendor/THREE-LICENSE.txt');
console.log('Static VR viewer built in dist');
