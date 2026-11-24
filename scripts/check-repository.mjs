// Check the Git index and the history being published, never local account files.
// Diagnostics contain file names and rule names only, never matched secret values.
import { execFileSync } from 'node:child_process';

const cwd=process.cwd().replaceAll('\\','/');
const git=(...args)=>execFileSync('git',['-c',`safe.directory=${cwd}`,...args],{maxBuffer:32*1024*1024});
const objects=new Map();const problems=new Set();
const prohibitedPath=/(?:^|\/)(?:\.local-data|\.local-tools|node_modules|dist-local|\.sites-runtime|\.wrangler|\.codex|outputs|\.env(?:\..*)?|\.dev\.vars(?:\..*)?|credentials\.json|auth\.json|accounts\.(?:json|dpapi))(?:\/|$)|\.openai\/hosting\.json$|\.(?:pem|key|p12|pfx|dpapi|log)$/i;
const rules=[
  ['private key',/-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/],
  ['provider token',/\b(?:sk-(?:proj-|ant-)[A-Za-z0-9_-]{20,}|gh[pousr]_[A-Za-z0-9]{25,}|github_pat_[A-Za-z0-9_]{25,})\b/],
  ['stored JWT',/\beyJ[A-Za-z0-9_-]{25,}\.eyJ[A-Za-z0-9_-]{25,}\.[A-Za-z0-9_-]{20,}\b/],
  ['personal email',/[a-zA-Z0-9._%+-]+@(?:gmail|hotmail|outlook|yahoo|icloud)\.com\b/i],
  ['personal Windows path',/C:[\\/]Users[\\/](?!Public[\\/]|Default[\\/])[a-zA-Z0-9._-]+[\\/]/i],
  ['personal hosting project',/\bappgprj_[a-zA-Z0-9]{20,}\b/],
];
function add(sha,path){
  if(path&&path!=='.env.example'&&prohibitedPath.test(path))problems.add(`${path}: local/private file`);
  if(!objects.has(sha))objects.set(sha,path||'(Git object)');
}
for(const entry of git('ls-files','--stage','-z').toString('utf8').split('\0').filter(Boolean)){
  const match=/^\d+ ([a-f0-9]+) \d\t([\s\S]+)$/.exec(entry);if(match)add(match[1],match[2]);
}
for(const line of git('rev-list','--objects','HEAD').toString('utf8').trim().split('\n')){
  const space=line.indexOf(' ');add(space<0?line:line.slice(0,space),space<0?'':line.slice(space+1));
}
const blobData=execFileSync('git',['-c',`safe.directory=${cwd}`,'cat-file','--batch'],{input:[...objects.keys()].join('\n')+'\n',maxBuffer:32*1024*1024});
let offset=0,blobs=0;
while(offset<blobData.length){
  const end=blobData.indexOf(10,offset);if(end<0)throw new Error('Incomplete Git object stream');
  const [sha,type,length]=blobData.subarray(offset,end).toString().split(' ');const size=Number(length);
  if(!Number.isSafeInteger(size))throw new Error('Unreadable Git object');
  offset=end+1;const content=blobData.subarray(offset,offset+size).toString('utf8');offset+=size+1;
  if(type!=='blob')continue;blobs++;
  for(const [name,pattern] of rules)if(pattern.test(content))problems.add(`${objects.get(sha)}: ${name}`);
}
const authors=git('log','--format=%ae%n%ce','HEAD').toString('utf8');
if(rules.find(([name])=>name==='personal email')[1].test(authors))problems.add('commit metadata: personal email');
if(problems.size){console.error('Repository privacy check failed:\n'+[...problems].join('\n'));process.exitCode=1;}
else console.log(`Repository privacy check passed (${blobs} source blobs and commit metadata).`);
