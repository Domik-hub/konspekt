import { mkdir, copyFile } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';

const root=fileURLToPath(new URL('../',import.meta.url));
const npmCLI=process.env.npm_execpath;
if(!npmCLI)throw new Error('Run this installer with npm run clients:install.');
const destination=resolve(root,'.local-tools');
await mkdir(destination,{recursive:true});
await copyFile(resolve(root,'local/provider-packages.json'),resolve(destination,'package.json'));
const child=spawn(process.execPath,[npmCLI,'install','--prefix',destination,'--no-audit','--no-fund'],{cwd:root,stdio:'inherit',shell:false,windowsHide:true});
child.on('error',()=>{console.error('Could not start npm. Check your Node.js installation.');process.exitCode=1;});
child.on('exit',code=>{process.exitCode=code??1;});
